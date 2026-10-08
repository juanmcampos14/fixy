/** Propiedades (hogares, oficinas) y organizaciones con sus sedes y miembros. */
import { z } from "zod";
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { assert, orgRole } from "./authz";
import { storeFile, readStoredFile } from "@/server/storage";
import { interpretAccessRules, accessRulesAvailable, type RulesSource } from "@/server/assistant/access-rules";

export const propertySchema = z.object({
  kind: z.enum(["home", "office", "site", "other"]),
  label: z.string().trim().min(1, "Poné un nombre para identificarla (ej.: Casa, Oficina Centro).").max(120),
  addressLine: z.string().trim().min(5, "Ingresá la dirección.").max(200),
  addressExtra: z.string().trim().max(120).optional().or(z.literal("")),
  zoneId: z.string().uuid("Elegí la zona."),
  contactName: z.string().trim().max(120).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  accessNotes: z.string().trim().max(1000).optional().or(z.literal("")),
  lat: z.coerce.number().min(-90).max(90).optional().or(z.literal("").transform(() => undefined)),
  lng: z.coerce.number().min(-180).max(180).optional().or(z.literal("").transform(() => undefined)),
  placeId: z.string().trim().max(300).optional().or(z.literal("")),
  formattedAddress: z.string().trim().max(300).optional().or(z.literal("")),
  gatedCommunity: z.preprocess((v) => v === true || v === "on" || v === "true", z.boolean()).optional(),
  gatedName: z.string().trim().max(120).optional().or(z.literal("")),
});
export type PropertyInput = z.infer<typeof propertySchema>;

/** Crea una propiedad. La pertenencia la decide el servidor: el usuario, o una organización donde es admin. */
export async function createProperty(actor: Actor, input: PropertyInput, organizationId?: string | null) {
  const d = propertySchema.parse(input);
  return systemTx(async (tx) => {
    if (organizationId) {
      if ((await orgRole(tx, actor, organizationId)) !== "admin") throw forbidden("Solo administradores de la organización pueden crear sedes.");
    }
    const [{ ok }] = await tx<{ ok: boolean }[]>`select exists (select 1 from zones where id = ${d.zoneId} and active) as ok`;
    if (!ok) throw invalid("Zona fuera de cobertura.");
    const [p] = await tx<{ id: string }[]>`
      insert into properties (owner_user_id, organization_id, kind, label, address_line, address_extra, zone_id, contact_name, contact_phone, access_notes,
        lat, lng, place_id, formatted_address, gated_community, gated_name)
      values (${organizationId ? null : actor.id}, ${organizationId ?? null}, ${d.kind}, ${d.label}, ${d.addressLine}, ${d.addressExtra || null},
        ${d.zoneId}, ${d.contactName || null}, ${d.contactPhone || null}, ${d.accessNotes || null},
        ${d.lat ?? null}, ${d.lng ?? null}, ${d.placeId || null}, ${d.formattedAddress || null}, ${!!d.gatedCommunity}, ${d.gatedCommunity ? d.gatedName || null : null})
      returning id`;
    return p.id;
  });
}

export async function updateProperty(actor: Actor, propertyId: string, input: PropertyInput) {
  const d = propertySchema.parse(input);
  return systemTx(async (tx) => {
    await assert(tx, "can_manage_property", actor, propertyId);
    await tx`update properties set kind = ${d.kind}, label = ${d.label}, address_line = ${d.addressLine}, address_extra = ${d.addressExtra || null},
      zone_id = ${d.zoneId}, contact_name = ${d.contactName || null}, contact_phone = ${d.contactPhone || null}, access_notes = ${d.accessNotes || null},
      lat = ${d.lat ?? null}, lng = ${d.lng ?? null}, place_id = ${d.placeId || null}, formatted_address = ${d.formattedAddress || null},
      gated_community = ${!!d.gatedCommunity}, gated_name = ${d.gatedCommunity ? d.gatedName || null : null}
      where id = ${propertyId}`;
  });
}

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "Ingresá el nombre de la organización.").max(160),
  taxId: z.string().trim().max(20).optional().or(z.literal("")),
  billingEmail: z.string().trim().email("Email inválido.").optional().or(z.literal("")),
  billingAddress: z.string().trim().max(200).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function createOrganization(actor: Actor, input: z.infer<typeof organizationSchema>) {
  const d = organizationSchema.parse(input);
  return systemTx(async (tx) => {
    const [o] = await tx<{ id: string }[]>`
      insert into organizations (name, tax_id, billing_email, billing_address, contact_phone, created_by)
      values (${d.name}, ${d.taxId || null}, ${d.billingEmail || null}, ${d.billingAddress || null}, ${d.contactPhone || null}, ${actor.id})
      returning id`;
    await tx`insert into organization_members (organization_id, user_id, role) values (${o.id}, ${actor.id}, 'admin')`;
    return o.id;
  });
}

export async function updateOrganization(actor: Actor, orgId: string, input: z.infer<typeof organizationSchema>) {
  const d = organizationSchema.parse(input);
  return systemTx(async (tx) => {
    if ((await orgRole(tx, actor, orgId)) !== "admin") throw forbidden();
    await tx`update organizations set name = ${d.name}, tax_id = ${d.taxId || null}, billing_email = ${d.billingEmail || null},
      billing_address = ${d.billingAddress || null}, contact_phone = ${d.contactPhone || null} where id = ${orgId}`;
  });
}

/** Agrega un miembro existente por email. Las invitaciones por email a no registrados quedan para la segunda etapa. */
export async function addOrganizationMember(actor: Actor, orgId: string, email: string, role: "admin" | "member") {
  return systemTx(async (tx) => {
    if ((await orgRole(tx, actor, orgId)) !== "admin") throw forbidden();
    const [u] = await tx<{ id: string }[]>`select id from users where lower(email) = lower(${email.trim()}) and disabled_at is null`;
    if (!u) throw notFound("No hay una cuenta con ese email. Pedile que se registre primero.");
    await tx`insert into organization_members (organization_id, user_id, role) values (${orgId}, ${u.id}, ${role})
      on conflict (organization_id, user_id) do update set role = excluded.role`;
    await audit(tx, actor, "organization.member_upsert", "organization", orgId, null, { userId: u.id, role });
  });
}

export async function removeOrganizationMember(actor: Actor, orgId: string, userId: string) {
  return systemTx(async (tx) => {
    if ((await orgRole(tx, actor, orgId)) !== "admin") throw forbidden();
    const [{ admins }] = await tx<{ admins: number }[]>`
      select count(*)::int as admins from organization_members where organization_id = ${orgId} and role = 'admin' and user_id <> ${userId}`;
    if (admins === 0) throw invalid("La organización debe conservar al menos un administrador.");
    await tx`delete from organization_members where organization_id = ${orgId} and user_id = ${userId}`;
    await audit(tx, actor, "organization.member_remove", "organization", orgId, null, { userId });
  });
}

// ───────── Barrios cerrados: requisitos de ingreso ─────────

export const gatedRulesSchema = z.object({
  url: z.string().trim().max(500).url("Link inválido.").refine((u) => u.startsWith("https://"), "El link tiene que empezar con https://").optional().or(z.literal("")),
  text: z.string().trim().max(20000).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

/**
 * Guarda el reglamento del barrio (archivo, link o texto) y lo interpreta con IA.
 * El archivo y el link quedan privados (cliente, operación y profesional con visita confirmada);
 * los requisitos extraídos los ven los profesionales invitados, sin datos de ubicación.
 */
export async function saveGatedRules(actor: Actor, propertyId: string, input: z.infer<typeof gatedRulesSchema>, file?: { data: Buffer; name: string } | null) {
  const d = gatedRulesSchema.parse(input);
  const prev = await systemTx(async (tx) => {
    await assert(tx, "can_manage_property", actor, propertyId);
    const [p] = await tx<{ gated_community: boolean; gated_rules_file_id: string | null }[]>`select gated_community, gated_rules_file_id from properties where id = ${propertyId}`;
    if (!p.gated_community) throw invalid("Primero marcá la propiedad como barrio cerrado.");
    const fileId = file ? await storeFile(tx, { data: file.data, originalName: file.name, uploadedBy: actor.id, purpose: "property_document", ownerType: "property", ownerId: propertyId }) : p.gated_rules_file_id;
    if (!fileId && !d.url && !d.text) throw invalid("Subí el reglamento, pegá un link o escribí los requisitos.");
    await tx`update properties set gated_rules_file_id = ${fileId}, gated_rules_url = ${d.url || null}, gated_rules_text = ${d.text || null},
      gated_client_notes = ${d.notes || null} where id = ${propertyId}`;
    await audit(tx, actor, "property.gated_rules_saved", "property", propertyId, null, { file: !!fileId, url: !!d.url, text: !!d.text });
    const [f] = fileId ? await tx<{ storage_key: string; mime_type: string }[]>`select storage_key, mime_type from files where id = ${fileId}` : [];
    return { file: f ?? null };
  });

  if (!accessRulesAvailable()) return { interpreted: false as const, reason: "La interpretación con IA no está disponible en este momento. Guardamos tu reglamento (el profesional lo recibe cuando se confirma la visita); probá interpretarlo de nuevo más tarde." };

  const sources: RulesSource[] = [];
  if (file) sources.push({ kind: "file", data: file.data, mime: prev.file!.mime_type });
  else if (prev.file) sources.push({ kind: "file", data: await readStoredFile(prev.file.storage_key), mime: prev.file.mime_type });
  if (d.url) sources.push({ kind: "url", url: d.url });
  if (d.text) sources.push({ kind: "text", text: d.text });
  // Prioridad: archivo > texto > link (el link depende de que la página sea accesible).
  const source = sources.find((s) => s.kind === "file") ?? sources.find((s) => s.kind === "text") ?? sources[0];
  const result = await interpretAccessRules(source, d.notes || undefined);

  await systemTx(async (tx) => {
    await tx`update properties set gated_requirements = ${result ? tx.json(result) : null}, gated_requirements_status = ${result ? "ready" : "failed"},
      gated_requirements_updated_at = now() where id = ${propertyId}`;
  });
  return result ? { interpreted: true as const, requirements: result } : { interpreted: false as const, reason: "No pudimos interpretar el reglamento. Probá con otro archivo, pegá el texto o escribí los requisitos a mano." };
}

/** Actualiza solo las aclaraciones del propietario (visibles para el profesional invitado). */
export async function updateGatedNotes(actor: Actor, propertyId: string, notes: string) {
  const n = z.string().trim().max(2000).parse(notes);
  return systemTx(async (tx) => {
    await assert(tx, "can_manage_property", actor, propertyId);
    await tx`update properties set gated_client_notes = ${n || null} where id = ${propertyId}`;
  });
}
