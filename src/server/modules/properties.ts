/** Propiedades (hogares, oficinas) y organizaciones con sus sedes y miembros. */
import { z } from "zod";
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { assert, orgRole } from "./authz";

export const propertySchema = z.object({
  kind: z.enum(["home", "office", "site", "other"]),
  label: z.string().trim().min(1, "Poné un nombre para identificarla (ej.: Casa, Oficina Centro).").max(120),
  addressLine: z.string().trim().min(5, "Ingresá la dirección.").max(200),
  addressExtra: z.string().trim().max(120).optional().or(z.literal("")),
  zoneId: z.string().uuid("Elegí la zona."),
  contactName: z.string().trim().max(120).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  accessNotes: z.string().trim().max(1000).optional().or(z.literal("")),
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
      insert into properties (owner_user_id, organization_id, kind, label, address_line, address_extra, zone_id, contact_name, contact_phone, access_notes)
      values (${organizationId ? null : actor.id}, ${organizationId ?? null}, ${d.kind}, ${d.label}, ${d.addressLine}, ${d.addressExtra || null},
        ${d.zoneId}, ${d.contactName || null}, ${d.contactPhone || null}, ${d.accessNotes || null})
      returning id`;
    return p.id;
  });
}

export async function updateProperty(actor: Actor, propertyId: string, input: PropertyInput) {
  const d = propertySchema.parse(input);
  return systemTx(async (tx) => {
    await assert(tx, "can_manage_property", actor, propertyId);
    await tx`update properties set kind = ${d.kind}, label = ${d.label}, address_line = ${d.addressLine}, address_extra = ${d.addressExtra || null},
      zone_id = ${d.zoneId}, contact_name = ${d.contactName || null}, contact_phone = ${d.contactPhone || null}, access_notes = ${d.accessNotes || null}
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
