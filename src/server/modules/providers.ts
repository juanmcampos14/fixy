/**
 * Proveedores: registro abierto, perfil, cobertura, documentación, configuración de cobros
 * y revisión administrativa. Estados separados: operativo, identidad, credenciales, cobros.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { audit, recordEvent } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { assertTransition, providerMachine, type ProviderStatus } from "@/server/domain/state-machines";
import { assertProviderAdmin } from "./authz";
import { notify, providerRecipients, staffRecipients } from "@/server/notifications";
import { activeGateway } from "@/server/payments";
import { storeFile } from "@/server/storage";
import { profileStrength, type ProfileFacts } from "@/lib/profile-strength";

export const providerProfileSchema = z.object({
  kind: z.enum(["individual", "company"]),
  displayName: z.string().trim().min(2, "Ingresá un nombre comercial.").max(120),
  legalName: z.string().trim().max(160).optional().or(z.literal("")),
  taxId: z
    .string()
    .trim()
    .regex(/^(\d{2}-?\d{8}-?\d)?$/, "El CUIT debe tener 11 dígitos.")
    .optional()
    .or(z.literal("")),
  responsibleName: z.string().trim().min(2, "Ingresá el nombre del responsable.").max(120),
  contactEmail: z.string().trim().email("Email inválido."),
  contactPhone: z.string().trim().min(6, "Ingresá un teléfono de contacto.").max(40),
  description: z.string().trim().min(30, "Contá un poco más sobre tu servicio (mínimo 30 caracteres).").max(2000),
  yearsExperience: z.coerce.number().int().min(0).max(80).optional(),
  billingInfo: z.string().trim().max(500).optional().or(z.literal("")),
});
export type ProviderProfileInput = z.infer<typeof providerProfileSchema>;

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);
}

/** Paso 1-3 del alta: crea el proveedor con el usuario como administrador. */
export async function createProvider(actor: Actor, input: ProviderProfileInput, origin: { source?: string | null; referrerSlug?: string | null } = {}) {
  const data = providerProfileSchema.parse(input);
  return systemTx((tx) => createProviderTx(tx, actor, data, origin));
}

async function createProviderTx(tx: Tx, actor: Actor, data: z.infer<typeof providerProfileSchema>, origin: { source?: string | null; referrerSlug?: string | null }) {
  {
    const [existing] = await tx<{ provider_id: string }[]>`
      select provider_id from provider_members where user_id = ${actor.id} and role = 'admin' limit 1`;
    if (existing) return existing.provider_id; // un alta por usuario en el MVP
    const slug = `${slugify(data.displayName)}-${randomUUID().slice(0, 4)}`;
    const [referrer] = origin.referrerSlug ? await tx<{ id: string }[]>`select id from providers where slug = ${origin.referrerSlug} and status = 'approved'` : [];
    const [p] = await tx<{ id: string }[]>`
      insert into providers (kind, slug, display_name, legal_name, tax_id, responsible_name, contact_email, contact_phone,
        description, years_experience, billing_info, created_by, signup_source, referred_by_provider_id)
      values (${data.kind}, ${slug}, ${data.displayName}, ${data.legalName || null}, ${data.taxId?.replace(/-/g, "") || null},
        ${data.responsibleName}, ${data.contactEmail}, ${data.contactPhone}, ${data.description},
        ${data.yearsExperience ?? null}, ${data.billingInfo || null}, ${actor.id}, ${origin.source?.slice(0, 120) || null}, ${referrer?.id ?? null})
      returning id`;
    await tx`insert into provider_members (provider_id, user_id, role) values (${p.id}, ${actor.id}, 'admin')`;
    await recordEvent(tx, { entityType: "provider", entityId: p.id, action: "created", to: "pending", actorId: actor.id });
    return p.id;
  }
}

export async function updateProviderProfile(actor: Actor, providerId: string, input: ProviderProfileInput) {
  const data = providerProfileSchema.parse(input);
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    await tx`update providers set kind = ${data.kind}, display_name = ${data.displayName}, legal_name = ${data.legalName || null},
      tax_id = ${data.taxId?.replace(/-/g, "") || null}, responsible_name = ${data.responsibleName}, contact_email = ${data.contactEmail},
      contact_phone = ${data.contactPhone}, description = ${data.description}, years_experience = ${data.yearsExperience ?? null},
      billing_info = ${data.billingInfo || null}
      where id = ${providerId}`;
  });
}

export const coverageSchema = z.object({
  categoryIds: z.array(z.string().uuid()).min(1, "Elegí al menos una especialidad."),
  zoneIds: z.array(z.string().uuid()).min(1, "Elegí al menos una zona."),
  baseZoneId: z.string().uuid().optional().or(z.literal("")),
  acceptingJobs: z.boolean(),
  maxActiveJobs: z.coerce.number().int().min(1).max(500),
  availability: z
    .array(z.object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) }))
    .min(1, "Indicá al menos una franja de disponibilidad.")
    .refine((a) => a.every((s) => s.endMinute > s.startMinute), "Las franjas deben terminar después de empezar."),
});

export async function updateCoverage(actor: Actor, providerId: string, input: z.infer<typeof coverageSchema>) {
  const data = coverageSchema.parse(input);
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    const validCats = await tx<{ id: string }[]>`select id from categories where active and id in ${tx(data.categoryIds)}`;
    const validZones = await tx<{ id: string }[]>`select id from zones where active and id in ${tx(data.zoneIds)}`;
    if (validCats.length !== data.categoryIds.length || validZones.length !== data.zoneIds.length) throw invalid("Selección inválida.");
    await tx`delete from provider_categories where provider_id = ${providerId}`;
    await tx`delete from provider_zones where provider_id = ${providerId}`;
    await tx`delete from provider_availability where provider_id = ${providerId}`;
    for (const c of data.categoryIds) await tx`insert into provider_categories values (${providerId}, ${c})`;
    for (const z of data.zoneIds) await tx`insert into provider_zones values (${providerId}, ${z})`;
    for (const s of data.availability)
      await tx`insert into provider_availability (provider_id, weekday, start_minute, end_minute) values (${providerId}, ${s.weekday}, ${s.startMinute}, ${s.endMinute})`;
    await tx`update providers set accepting_jobs = ${data.acceptingJobs}, max_active_jobs = ${data.maxActiveJobs},
      base_zone_id = ${data.baseZoneId || data.zoneIds[0]} where id = ${providerId}`;
  });
}

export async function addPortfolioItem(actor: Actor, providerId: string, file: { data: Buffer; name: string }, caption: string) {
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from provider_portfolio where provider_id = ${providerId}`;
    if (n >= 12) throw invalid("Podés cargar hasta 12 fotos de trabajos.");
    const fileId = await storeFile(tx, {
      data: file.data,
      originalName: file.name,
      uploadedBy: actor.id,
      purpose: "portfolio",
      ownerType: "provider",
      ownerId: providerId,
      visibility: "public",
      allowPdf: false,
    });
    await tx`insert into provider_portfolio (provider_id, file_id, caption) values (${providerId}, ${fileId}, ${caption.slice(0, 200)})`;
  });
}

export async function removePortfolioItem(actor: Actor, providerId: string, itemId: string) {
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    await tx`delete from provider_portfolio where id = ${itemId} and provider_id = ${providerId}`;
  });
}

export const documentSchema = z.object({
  kind: z.enum(["identity", "credential", "tax", "other"]),
  credentialTypeId: z.string().uuid().optional().or(z.literal("")),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
});

export async function uploadProviderDocument(
  actor: Actor,
  providerId: string,
  input: z.infer<typeof documentSchema>,
  file: { data: Buffer; name: string },
) {
  const data = documentSchema.parse(input);
  if (data.kind === "credential" && !data.credentialTypeId) throw invalid("Elegí el tipo de credencial.");
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    const fileId = await storeFile(tx, {
      data: file.data,
      originalName: file.name,
      uploadedBy: actor.id,
      purpose: "provider_document",
      ownerType: "provider",
      ownerId: providerId,
    });
    await tx`insert into provider_documents (provider_id, kind, credential_type_id, file_id, expires_on)
      values (${providerId}, ${data.kind}, ${data.credentialTypeId || null}, ${fileId}, ${data.expiresOn || null})`;
    if (data.kind === "identity") {
      await tx`update providers set identity_status = 'pending' where id = ${providerId} and identity_status in ('unverified','rejected')`;
    }
  });
}

/** Paso 8: configuración de cobros mediante el proceso de la pasarela (simulado en modo de prueba). */
export async function setupPayouts(actor: Actor, providerId: string) {
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    const gw = activeGateway();
    const { accountRef, onboardingUrl } = await gw.createPayoutAccount(tx, providerId);
    await tx`update providers set payout_account_ref = ${accountRef}, payout_provider = ${gw.name},
      payouts_status = ${onboardingUrl ? "pending" : "enabled"} where id = ${providerId}`;
    await audit(tx, actor, "provider.payouts_setup", "provider", providerId, null, { gateway: gw.name, test: gw.isTest });
    return { onboardingUrl };
  });
}

export type OnboardingChecklist = {
  profile: boolean;
  coverage: boolean;
  availability: boolean;
  portfolio: boolean;
  identityDocument: boolean;
  requiredCredentials: { categoryName: string; credentialName: string; credentialTypeId: string; uploaded: boolean }[];
  payouts: boolean;
  termsAccepted: boolean;
};

export async function onboardingChecklist(db: Db, providerId: string): Promise<OnboardingChecklist> {
  const [p] = await db<{ description: string; contact_phone: string | null; payouts_status: string; created_by: string }[]>`
    select description, contact_phone, payouts_status, created_by from providers where id = ${providerId}`;
  const [{ cats, zones, slots, photos, ids }] = await db<{ cats: number; zones: number; slots: number; photos: number; ids: number }[]>`
    select (select count(*)::int from provider_categories where provider_id = ${providerId}) as cats,
           (select count(*)::int from provider_zones where provider_id = ${providerId}) as zones,
           (select count(*)::int from provider_availability where provider_id = ${providerId}) as slots,
           (select count(*)::int from provider_portfolio where provider_id = ${providerId}) as photos,
           (select count(*)::int from provider_documents where provider_id = ${providerId} and kind = 'identity' and status <> 'rejected') as ids`;
  const required = await db<{ category_name: string; credential_name: string; credential_type_id: string; uploaded: boolean }[]>`
    select c.name as category_name, ct.name as credential_name, ct.id as credential_type_id,
      exists (select 1 from provider_documents d where d.provider_id = ${providerId} and d.credential_type_id = ct.id and d.status <> 'rejected') as uploaded
    from provider_categories pc join categories c on c.id = pc.category_id
    join category_required_credentials rc on rc.category_id = c.id
    join credential_types ct on ct.id = rc.credential_type_id
    where pc.provider_id = ${providerId}`;
  const [{ accepted }] = await db<{ accepted: boolean }[]>`
    select exists (select 1 from policy_acceptances a join policy_documents d on d.id = a.policy_id
      join provider_members m on m.user_id = a.user_id and m.provider_id = ${providerId} and m.role = 'admin' and m.active
      where d.kind = 'provider_terms') as accepted`;
  return {
    profile: p.description.length >= 30 && !!p.contact_phone,
    coverage: cats > 0 && zones > 0,
    availability: slots > 0,
    portfolio: photos > 0,
    identityDocument: ids > 0,
    requiredCredentials: required.map((r) => ({
      categoryName: r.category_name,
      credentialName: r.credential_name,
      credentialTypeId: r.credential_type_id,
      uploaded: r.uploaded,
    })),
    payouts: p.payouts_status === "enabled" || p.payouts_status === "pending",
    termsAccepted: accepted,
  };
}

export async function acceptProviderTerms(actor: Actor) {
  return systemTx(async (tx) => {
    const [doc] = await tx<{ id: string }[]>`select id from policy_documents where kind = 'provider_terms' order by published_at desc limit 1`;
    if (!doc) throw notFound("No hay términos para proveedores publicados.");
    await tx`insert into policy_acceptances (user_id, policy_id) values (${actor.id}, ${doc.id}) on conflict do nothing`;
  });
}

/** Paso 9: enviar a revisión. El portfolio es recomendable pero no obligatorio. */
export async function submitForReview(actor: Actor, providerId: string) {
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    const [p] = await tx<{ status: ProviderStatus }[]>`select status from providers where id = ${providerId} for update`;
    const c = await onboardingChecklist(tx, providerId);
    const missing: string[] = [];
    if (!c.profile) missing.push("perfil");
    if (!c.coverage) missing.push("servicios y zonas");
    if (!c.availability) missing.push("disponibilidad");
    if (!c.identityDocument) missing.push("documento de identidad");
    if (c.requiredCredentials.some((r) => !r.uploaded)) missing.push("credenciales obligatorias");
    if (!c.termsAccepted) missing.push("aceptación de términos");
    if (missing.length) throw invalid(`Para enviar a revisión falta completar: ${missing.join(", ")}.`);
    let from = p.status;
    if (from === "rejected") {
      assertTransition(providerMachine, from, "pending", "provider");
      await tx`update providers set status = 'pending' where id = ${providerId}`;
      from = "pending";
    }
    assertTransition(providerMachine, from, "in_review", "provider");
    await tx`update providers set status = 'in_review', submitted_at = now() where id = ${providerId}`;
    await recordEvent(tx, { entityType: "provider", entityId: providerId, action: "submitted", from, to: "in_review", actorId: actor.id });
    await notify(tx, await staffRecipients(tx), {
      type: "provider_review",
      title: "Nuevo proveedor para revisar",
      link: `/admin/proveedores/${providerId}`,
      email: false,
    });
  });
}

// ───────────────────────── Revisión administrativa ─────────────────────────

export type ReviewAction = "approve" | "observe" | "reject" | "suspend" | "reinstate";

export async function reviewProvider(actor: Actor, providerId: string, action: ReviewAction, note: string) {
  if (!can(actor, "proveedores", "manage")) throw forbidden();
  if (!note || note.trim().length < 5) throw invalid("Indicá el motivo o la observación (mínimo 5 caracteres).");
  return systemTx(async (tx) => {
    const [p] = await tx<{ status: ProviderStatus; identity_status: string; payouts_status: string; display_name: string }[]>`
      select status, identity_status, payouts_status, display_name from providers where id = ${providerId} for update`;
    if (!p) throw notFound();
    const to: ProviderStatus = { approve: "approved", observe: "pending", reject: "rejected", suspend: "suspended", reinstate: "approved" }[action] as ProviderStatus;
    assertTransition(providerMachine, p.status, to, "staff");
    if (action === "approve") {
      if (p.identity_status !== "verified") throw invalid("Antes de aprobar, verificá el documento de identidad.");
      const [{ pendingCreds }] = await tx<{ pendingCreds: number }[]>`
        select count(*)::int as "pendingCreds" from provider_categories pc
        join category_required_credentials rc on rc.category_id = pc.category_id
        where pc.provider_id = ${providerId} and not exists (
          select 1 from provider_documents d where d.provider_id = ${providerId} and d.credential_type_id = rc.credential_type_id
            and d.status = 'approved' and (d.expires_on is null or d.expires_on >= current_date))`;
      if (pendingCreds > 0) throw invalid("Hay credenciales obligatorias sin aprobar o vencidas. Revisalas o quitá esas especialidades.");
    }
    await tx`update providers set status = ${to}, review_note = ${note},
      approved_at = case when ${to} = 'approved' then coalesce(approved_at, now()) else approved_at end where id = ${providerId}`;
    await recordEvent(tx, { entityType: "provider", entityId: providerId, action: `review_${action}`, from: p.status, to, actorId: actor.id, actorRole: actor.platformRole, reason: note });
    await audit(tx, actor, `provider.${action}`, "provider", providerId, note);
    const titles: Record<ReviewAction, string> = {
      approve: "¡Tu perfil fue aprobado!",
      observe: "Tu perfil tiene observaciones",
      reject: "Tu solicitud de alta fue rechazada",
      suspend: "Tu cuenta de proveedor fue suspendida",
      reinstate: "Tu cuenta de proveedor fue rehabilitada",
    };
    await notify(tx, await providerRecipients(tx, providerId), {
      type: "provider_review",
      title: titles[action],
      body: note,
      link: "/proveedor",
    });
  });
}

export async function reviewDocument(actor: Actor, documentId: string, decision: "approved" | "rejected", note: string, expiresOn?: string | null) {
  if (!can(actor, "proveedores", "manage")) throw forbidden();
  if (decision === "rejected" && (!note || note.trim().length < 5)) throw invalid("Indicá el motivo del rechazo.");
  return systemTx(async (tx) => {
    const [d] = await tx<{ provider_id: string; kind: string }[]>`select provider_id, kind from provider_documents where id = ${documentId} for update`;
    if (!d) throw notFound();
    await tx`update provider_documents set status = ${decision}, review_note = ${note || null}, reviewed_by = ${actor.id}, reviewed_at = now(),
      expires_on = coalesce(${expiresOn || null}::date, expires_on) where id = ${documentId}`;
    if (d.kind === "identity") {
      await tx`update providers set identity_status = ${decision === "approved" ? "verified" : "rejected"} where id = ${d.provider_id}`;
    }
    await audit(tx, actor, `provider_document.${decision}`, "provider", d.provider_id, note || null, { documentId, kind: d.kind });
  });
}

/** Datos que habilitan recibir oportunidades (también usados por el matching). */
export async function providerEligibility(db: Db | Tx, providerId: string) {
  const [p] = await db<{ status: string; identity_status: string; payouts_status: string; accepting_jobs: boolean }[]>`
    select status, identity_status, payouts_status, accepting_jobs from providers where id = ${providerId}`;
  const expired = await db<{ name: string; expires_on: string }[]>`
    select ct.name, d.expires_on from provider_documents d join credential_types ct on ct.id = d.credential_type_id
    where d.provider_id = ${providerId} and d.status = 'approved' and d.expires_on < current_date`;
  const reasons: string[] = [];
  if (p.status !== "approved") reasons.push("El perfil todavía no está aprobado.");
  if (p.identity_status !== "verified") reasons.push("Falta verificar la identidad.");
  if (!p.accepting_jobs) reasons.push("Pausaste la recepción de trabajos.");
  for (const e of expired) reasons.push(`Credencial vencida: ${e.name}.`);
  return { eligible: reasons.length === 0, reasons };
}

/** Agrega a un integrante del equipo (cuenta existente) como técnico o administrador. */
export async function addProviderMember(actor: Actor, providerId: string, email: string, role: "admin" | "technician") {
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    const [p] = await tx<{ kind: string }[]>`select kind from providers where id = ${providerId}`;
    if (p.kind !== "company" && role === "technician") throw invalid("Los equipos de técnicos están disponibles para empresas.");
    const [u] = await tx<{ id: string }[]>`select id from users where lower(email) = lower(${email.trim()}) and disabled_at is null`;
    if (!u) throw notFound("No hay una cuenta con ese email. Pedile que se registre primero.");
    await tx`insert into provider_members (provider_id, user_id, role) values (${providerId}, ${u.id}, ${role})
      on conflict (provider_id, user_id) do update set role = excluded.role, active = true`;
    await audit(tx, actor, "provider.member_upsert", "provider", providerId, null, { userId: u.id, role });
  });
}

export async function deactivateProviderMember(actor: Actor, providerId: string, userId: string) {
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    if (userId === actor.id) throw invalid("No podés quitarte a vos mismo.");
    await tx`update provider_members set active = false where provider_id = ${providerId} and user_id = ${userId}`;
    await tx`update jobs set assigned_user_id = null where provider_id = ${providerId} and assigned_user_id = ${userId} and status not in ('completed','cancelled')`;
    await audit(tx, actor, "provider.member_deactivate", "provider", providerId, null, { userId });
  });
}

// ───────── Visita y precios de referencia (modelo "elegí a tu profesional") ─────────

export const visitSettingsSchema = z.object({
  visitFeeMinor: z.coerce.number().int().min(0).max(100_000_000),
  visitFeeCredited: z.boolean(),
});

export async function updateVisitSettings(actor: Actor, providerId: string, input: z.infer<typeof visitSettingsSchema>) {
  const d = visitSettingsSchema.parse(input);
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    await tx`update providers set visit_fee_minor = ${d.visitFeeMinor}, visit_fee_credited = ${d.visitFeeCredited}, visit_configured_at = now() where id = ${providerId}`;
  });
}

export const priceRefSchema = z.object({
  categoryId: z.string().uuid("Elegí el rubro."),
  title: z.string().trim().min(3, "Describí el servicio.").max(120),
  fromMinor: z.coerce.number().int().min(1, "Indicá un precio de referencia."),
  note: z.string().trim().max(300).default(""),
});

export async function addPriceRef(actor: Actor, providerId: string, input: z.input<typeof priceRefSchema>) {
  const d = priceRefSchema.parse(input);
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    const [{ ok }] = await tx<{ ok: boolean }[]>`select exists (select 1 from provider_categories where provider_id = ${providerId} and category_id = ${d.categoryId}) as ok`;
    if (!ok) throw invalid("Solo podés publicar precios de rubros que ofrecés.");
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from provider_price_refs where provider_id = ${providerId}`;
    if (n >= 30) throw invalid("Podés publicar hasta 30 precios de referencia.");
    await tx`insert into provider_price_refs (provider_id, category_id, title, from_minor, note, sort) values (${providerId}, ${d.categoryId}, ${d.title}, ${d.fromMinor}, ${d.note}, ${n})`;
  });
}

export async function removePriceRef(actor: Actor, providerId: string, id: string) {
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    await tx`delete from provider_price_refs where id = ${id} and provider_id = ${providerId}`;
  });
}

// ───────── Fuerza del perfil ─────────

/** Datos para calcular la fuerza del perfil de varios profesionales en una consulta. */
export async function profileFacts(db: Db | Tx, providerIds: string[]): Promise<Map<string, ProfileFacts>> {
  if (!providerIds.length) return new Map();
  const rows = await db<{
    id: string; dlen: number; phone: boolean; years: boolean; cats: number; zones: number; base: boolean; slots: number; photos: number;
    identity_status: string; id_docs: number; creds_missing: number; refs: number; visit: boolean; payouts: boolean;
  }[]>`
    select p.id, length(p.description)::int as dlen, coalesce(p.contact_phone, '') <> '' as phone, p.years_experience is not null as years,
      (select count(*)::int from provider_categories c where c.provider_id = p.id) as cats,
      (select count(*)::int from provider_zones z where z.provider_id = p.id) as zones,
      p.base_zone_id is not null as base,
      (select count(*)::int from provider_availability a where a.provider_id = p.id) as slots,
      (select count(*)::int from provider_portfolio f where f.provider_id = p.id) as photos,
      p.identity_status,
      (select count(*)::int from provider_documents d where d.provider_id = p.id and d.kind = 'identity' and d.status <> 'rejected') as id_docs,
      (select count(*)::int from provider_categories pc join category_required_credentials rc on rc.category_id = pc.category_id
        where pc.provider_id = p.id and not exists (select 1 from provider_documents d where d.provider_id = p.id
          and d.credential_type_id = rc.credential_type_id and d.status <> 'rejected')) as creds_missing,
      (select count(*)::int from provider_price_refs r where r.provider_id = p.id) as refs,
      p.visit_configured_at is not null as visit,
      exists (select 1 from provider_bank_accounts b where b.provider_id = p.id) as payouts
    from providers p where p.id in ${db(providerIds)}`;
  return new Map(rows.map((r) => [r.id, {
    descriptionLength: r.dlen, hasPhone: r.phone, hasYears: r.years, categories: r.cats, zones: r.zones, hasBaseZone: r.base,
    availabilitySlots: r.slots, photos: r.photos,
    identity: r.identity_status === "verified" ? "verified" : r.id_docs > 0 ? "uploaded" : "none",
    credentialsComplete: r.cats > 0 && r.creds_missing === 0, priceRefs: r.refs, visitConfigured: r.visit, payoutsEnabled: r.payouts,
  } satisfies ProfileFacts]));
}

export async function getProfileStrength(db: Db | Tx, providerId: string) {
  const facts = (await profileFacts(db, [providerId])).get(providerId);
  return facts ? profileStrength(facts) : null;
}

// ───────── Alta rápida (con o sin IA) ─────────

export const quickStartSchema = z.object({
  kind: z.enum(["individual", "company"]),
  displayName: z.string().trim().min(2, "Ingresá tu nombre o el de tu negocio.").max(120),
  contactPhone: z.string().trim().min(6, "Ingresá un celular para avisarte de pedidos.").max(40),
  description: z.string().trim().min(30, "Contá un poco más sobre tu servicio (mínimo 30 caracteres).").max(2000),
  yearsExperience: z.coerce.number().int().min(0).max(80).optional(),
  categoryIds: z.array(z.string().uuid()).min(1, "Elegí al menos un rubro."),
  zoneIds: z.array(z.string().uuid()).min(1, "Elegí al menos una zona."),
  baseZoneId: z.string().uuid().optional().or(z.literal("")),
  availability: z.array(z.object({ weekday: z.number().int().min(0).max(6), startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440) })).default([]),
  priceRefs: z.array(z.object({ categoryId: z.string().uuid(), title: z.string().trim().min(3).max(120), fromMinor: z.number().int().min(1) })).max(10).default([]),
  aiAssisted: z.boolean().default(false),
});

/** Crea el perfil con rubros, zonas, disponibilidad y precios en una sola operación (todo o nada). */
export async function quickStartProvider(actor: Actor, input: z.input<typeof quickStartSchema>, origin: { source?: string | null; referrerSlug?: string | null } = {}) {
  const d = quickStartSchema.parse(input);
  return systemTx(async (tx) => {
    const providerId = await createProviderTx(tx, actor, {
      kind: d.kind, displayName: d.displayName, legalName: "", taxId: "", responsibleName: actor.fullName, contactEmail: actor.email,
      contactPhone: d.contactPhone, description: d.description, yearsExperience: d.yearsExperience, billingInfo: "",
    }, origin);
    const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from provider_categories where provider_id = ${providerId}`;
    if (n > 0) return providerId; // ya tenía un perfil armado: no pisamos nada
    const validCats = await tx<{ id: string }[]>`select id from categories where active and id in ${tx(d.categoryIds)}`;
    const validZones = await tx<{ id: string }[]>`select id from zones where active and id in ${tx(d.zoneIds)}`;
    if (validCats.length !== new Set(d.categoryIds).size || validZones.length !== new Set(d.zoneIds).size) throw invalid("Selección inválida.");
    for (const c of new Set(d.categoryIds)) await tx`insert into provider_categories values (${providerId}, ${c})`;
    for (const z of new Set(d.zoneIds)) await tx`insert into provider_zones values (${providerId}, ${z})`;
    for (const s of d.availability.filter((a) => a.endMinute > a.startMinute))
      await tx`insert into provider_availability (provider_id, weekday, start_minute, end_minute) values (${providerId}, ${s.weekday}, ${s.startMinute}, ${s.endMinute})`;
    const base = d.baseZoneId && d.zoneIds.includes(d.baseZoneId) ? d.baseZoneId : null;
    await tx`update providers set base_zone_id = ${base}, profile_ai_assisted = ${d.aiAssisted} where id = ${providerId}`;
    let i = 0;
    for (const r of d.priceRefs.filter((r) => d.categoryIds.includes(r.categoryId)))
      await tx`insert into provider_price_refs (provider_id, category_id, title, from_minor, note, sort) values (${providerId}, ${r.categoryId}, ${r.title}, ${r.fromMinor}, '', ${i++})`;
    await audit(tx, actor, "provider.quickstart", "provider", providerId, null, { aiAssisted: d.aiAssisted, categories: d.categoryIds.length, zones: d.zoneIds.length, priceRefs: i });
    return providerId;
  });
}
