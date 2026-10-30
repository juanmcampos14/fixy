/**
 * Campañas de captación sobre los candidatos de supply_leads (no es un CRM aparte).
 *  - Se arma la tanda por oficio, región o zona y canal; se revisa en borrador y se activa solo si están los
 *    requisitos de cumplimiento (número comercial, base inscripta, textos revisados).
 *  - WhatsApp: el primer mensaje lo manda una persona desde el número comercial (cola en el panel, un toque por
 *    candidato, tope diario). Meta no permite mensajes automáticos a quien no dio su consentimiento.
 *  - Email: sale solo, con tope diario, remitente identificado y link de baja (Ley 25.326, art. 27).
 *  - Seguimiento: recordatorio a los N días, hasta el máximo de intentos; después «sin respuesta».
 *  - Clics en la invitación, registro y activación salen del mismo candidato.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { sql, systemTx, type Tx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { env } from "@/server/env";
import { emailAdapter, type EmailAdapter } from "@/server/notifications";
import { getSetting } from "./catalog";
import { waParam } from "@/server/whatsapp/templates";
import { createSupplyTemplates, sendSupplyTemplate, SUPPLY_FOOTER, SUPPLY_TEMPLATES, supplyNumberConfigured, supplyNumberStatus, supplyTemplatesStatus } from "@/server/whatsapp/supply-number";
import { kommoConfigured, kommoOutcomes, markRegisteredInKommo, registerInvitation, setupKommoPipeline } from "@/server/integrations/kommo";

/** whatsapp: envío asistido (lo manda una persona); whatsapp_api: automático por la API de Meta, con Kommo como bandeja; email: automático. */
export type Channel = "whatsapp" | "whatsapp_api" | "email";
export const CHANNEL_LABEL: Record<Channel, string> = { whatsapp: "WhatsApp asistido", whatsapp_api: "WhatsApp automático", email: "Email automático" };

const assertManage = (actor: Actor) => {
  if (!can(actor, "captacion", "manage")) throw forbidden();
};

// ───────── Requisitos de cumplimiento ─────────

export type Compliance = {
  commercialNumber: string;   // WhatsApp Business comercial, distinto del bot
  aaipRegistration: string;   // número o constancia de inscripción de la base ante la AAIP
  metaPolicyReviewed: boolean;
  emailPolicyReviewed: boolean;
  updatedAt?: string;
  updatedBy?: string;
};
const EMPTY_COMPLIANCE: Compliance = { commercialNumber: "", aaipRegistration: "", metaPolicyReviewed: false, emailPolicyReviewed: false };

export async function getCompliance(): Promise<Compliance> {
  return { ...EMPTY_COMPLIANCE, ...(await getSetting<Partial<Compliance>>(sql(), "supply.compliance", {})) };
}

/** Qué falta para activar una campaña por ese canal (vacío = se puede). */
export function complianceGaps(
  c: Compliance, channel: Channel, emailConfigured = env().EMAIL_ADAPTER === "resend", api = { number: supplyNumberConfigured(), kommo: kommoConfigured() },
): string[] {
  const gaps: string[] = [];
  // La inscripción ante la AAIP es recomendada (ver docs/captacion.md), pero la decide el dueño: no bloquea.
  if (channel === "whatsapp_api") {
    if (!api.number) gaps.push("Número comercial conectado a la API de WhatsApp (SUPPLY_WHATSAPP_PHONE_NUMBER_ID y token)");
    if (!api.kommo) gaps.push("Kommo conectado (KOMMO_TOKEN y KOMMO_SUBDOMINIO): ahí llegan las respuestas");
    if (!c.metaPolicyReviewed) gaps.push("Revisión de las políticas de WhatsApp Business");
  } else if (channel === "whatsapp") {
    if (!c.commercialNumber.trim()) gaps.push("Número de WhatsApp comercial (separado del bot)");
    if (!c.metaPolicyReviewed) gaps.push("Revisión de las políticas de WhatsApp Business");
  } else {
    if (!c.emailPolicyReviewed) gaps.push("Revisión de los envíos por email (remitente, baja, frecuencia)");
    if (!emailConfigured) gaps.push("Envío de emails configurado (Resend)");
  }
  return gaps;
}

export const complianceSchema = z.object({
  commercialNumber: z.string().trim().max(30).regex(/^[+\d\s()-]*$/, "Revisá el número."),
  aaipRegistration: z.string().trim().max(120),
  metaPolicyReviewed: z.boolean(),
  emailPolicyReviewed: z.boolean(),
});

export async function setCompliance(actor: Actor, input: z.input<typeof complianceSchema>) {
  assertManage(actor);
  const d = complianceSchema.parse(input);
  const value: Compliance = { ...d, updatedAt: new Date().toISOString(), updatedBy: actor.fullName };
  await systemTx(async (tx) => {
    await tx`insert into platform_settings (key, value, updated_by) values ('supply.compliance', ${tx.json(value as never)}, ${actor.id})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
    await audit(tx, actor, "supply.compliance", "platform_settings", null, "Requisitos de captación", { ...d });
  });
}

// ───────── Textos ─────────

export const PLACEHOLDERS = ["{nombre}", "{negocio}", "{oficio}", "{zona}", "{link}", "{web}", "{baja}"] as const;

export const DEFAULT_WHATSAPP_FIRST =
  "Hola {nombre}! Soy de Fixy, una plataforma que conecta a vecinos que necesitan arreglos con profesionales de su zona. " +
  "Vimos tu trabajo de {oficio} en {zona} y nos gustaría que te sumes: te llegan pedidos, elegís cuáles tomar y cobrás seguro. " +
  "Es gratis y no cobramos comisión.\n\nPara anotarte tocá este link y mandá el mensaje que aparece (son 3 preguntas): {link}\n\n{baja}";
export const DEFAULT_WHATSAPP_FOLLOWUP =
  "Hola {nombre}, te escribí hace unos días de Fixy. ¿Te interesa recibir pedidos de {oficio} en {zona}? " +
  "Anotarte lleva 2 minutos: {link}\n\n{baja}";
export const DEFAULT_EMAIL_SUBJECT = "Pedidos de {oficio} en {zona}: sumate a Fixy";
export const DEFAULT_EMAIL_FIRST =
  "Hola {nombre}:\n\nTe escribimos de Fixy, una plataforma que conecta a vecinos que necesitan arreglos con profesionales de su zona. " +
  "Vimos tu trabajo de {oficio} en {zona} y nos gustaría que te sumes.\n\n" +
  "- Te llegan pedidos de clientes de tu zona y elegís cuáles tomar.\n- Cobrás seguro dentro de la plataforma.\n- Sumarte es gratis y no cobramos comisión.\n\n" +
  "Anotarte por WhatsApp (3 preguntas): {link}\nO desde la web: {web}\n\nSaludos,\nEquipo Fixy";
export const DEFAULT_EMAIL_FOLLOWUP =
  "Hola {nombre}:\n\nTe escribimos hace unos días de Fixy. Si te interesa recibir pedidos de {oficio} en {zona}, anotarte lleva 2 minutos:\n{link}\n\nSaludos,\nEquipo Fixy";

const WA_OPT_OUT = "Si no querés que te escribamos más, respondé BAJA.";

type RenderLead = { id: string; code: string; business_name: string; contact_name: string | null; trade: string | null; place: string | null };

function baseUrl() {
  return env().APP_URL.replace(/\/$/, "");
}

/** Firma del link de baja (sin tabla: el id del candidato firmado con un secreto del servidor). */
export function optOutToken(leadId: string) {
  return `${leadId}.${createHmac("sha256", env().FILE_SIGNING_SECRET).update(`supply-optout:${leadId}`).digest("base64url").slice(0, 32)}`;
}
export function verifyOptOutToken(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const expected = optOutToken(id).split(".")[1];
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? id : null;
}

export function renderMessage(template: string, lead: RenderLead, campaign: { slug: string; channel: Channel }) {
  const ref = lead.code.toLowerCase();
  // Con nombre de contacto, el nombre de pila; si no, el del negocio completo ("Hola Plomeros Norte!").
  const first = lead.contact_name ? lead.contact_name.split(/\s+/)[0] : lead.business_name.split(/\s+[—–|-]\s+/)[0].slice(0, 60);
  const utm = `utm_source=captacion-${campaign.channel}&utm_campaign=${campaign.slug}`;
  const values: Record<string, string> = {
    "{nombre}": first,
    "{negocio}": lead.business_name,
    "{oficio}": (lead.trade ?? "tu oficio").toLowerCase(),
    "{zona}": lead.place ?? "tu zona",
    "{link}": `${baseUrl()}/alta?ref=${ref}`,
    "{web}": `${baseUrl()}/sumate/registrarme?origen=captacion&ref=${ref}&${utm}`,
    "{baja}": campaign.channel === "whatsapp" ? WA_OPT_OUT : "",
  };
  return template.replace(/\{(nombre|negocio|oficio|zona|link|web|baja)\}/g, (m) => values[m] ?? m).replace(/\n{3,}/g, "\n\n").trim();
}

/** Pie obligatorio de los emails: quién escribe, de dónde salió el dato y cómo darse de baja. */
export function emailFooter(leadId: string) {
  return `\n\n—\nFixy es un servicio de FLIPS S.R.L. Te escribimos porque tu contacto comercial figura públicamente en internet. ` +
    `Si no querés recibir más emails de Fixy, entrá acá y confirmá la baja: ${baseUrl()}/captacion/baja?t=${optOutToken(leadId)}`;
}

// ───────── Armado de campañas ─────────

export const campaignSchema = z.object({
  name: z.string().trim().min(3, "Poné un nombre.").max(120),
  channel: z.enum(["whatsapp", "whatsapp_api", "email"]),
  categoryIds: z.array(z.string().uuid()).max(20).default([]),
  regions: z.array(z.string().regex(/^[A-Z_]{2,20}$/)).max(10).default([]),
  zoneIds: z.array(z.string().uuid()).max(40).default([]),
  size: z.coerce.number().int().min(1).max(500),
  firstMessage: z.string().trim().min(40, "El mensaje es muy corto.").max(1500),
  followupMessage: z.string().trim().max(1500).optional().or(z.literal("")),
  emailSubject: z.string().trim().max(150).optional().or(z.literal("")),
  followupDays: z.coerce.number().int().min(1).max(30).default(4),
  maxAttempts: z.coerce.number().int().min(1).max(3).default(2),
  dailyCap: z.coerce.number().int().min(1).max(100).default(20),
  /** Solo contactos que dieron consentimiento para recibir WhatsApp de Fixy (bases cargadas con ese dato). */
  onlyConsented: z.boolean().default(false),
});

function checkTexts(d: z.infer<typeof campaignSchema>) {
  for (const t of [d.firstMessage, d.followupMessage ?? ""]) {
    if (t && !t.includes("{link}") && !t.includes("{web}")) throw invalid("Cada mensaje tiene que incluir {link} o {web}: es lo que vincula la respuesta con el candidato.");
    if (t && d.channel === "whatsapp" && !t.includes("{baja}") && !/\bBAJA\b/.test(t)) throw invalid("El mensaje de WhatsApp tiene que incluir {baja}: la forma de pedir que no le escribamos más.");
  }
  if (d.channel === "email" && !d.emailSubject) throw invalid("Poné el asunto del email.");
  if (d.maxAttempts > 1 && !d.followupMessage) throw invalid("Escribí el mensaje de seguimiento (o dejá un solo intento).");
}

const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "campana";

/** Candidatos que puede tomar una campaña: sin registrarse, sin «no contactar», sin otra campaña abierta y con el canal. */
async function eligibleLeads(tx: Tx, c: { channel: string; category_ids: string[]; regions: string[]; zone_ids: string[]; size: number; id?: string; only_consented?: boolean }) {
  return tx<{ id: string }[]>`
    select l.id from supply_leads l
    where l.provider_id is null and not l.do_not_contact and l.stage = 'candidate'
      and ${c.channel === "email" ? tx`l.email is not null` : tx`l.whatsapp_e164 is not null`}
      ${c.only_consented ? tx`and l.wa_consent_at is not null` : tx``}
      ${c.category_ids.length ? tx`and l.category_ids && ${c.category_ids}::uuid[]` : tx``}
      ${c.regions.length || c.zone_ids.length
        ? tx`and (${c.regions.length ? tx`l.base_region = any(${c.regions}::text[])` : tx`false`} or ${c.zone_ids.length ? tx`l.base_zone_id = any(${c.zone_ids}::uuid[])` : tx`false`})`
        : tx``}
      and not exists (select 1 from supply_campaign_leads cl join supply_campaigns k on k.id = cl.campaign_id
        where cl.lead_id = l.id and (k.status <> 'closed' or cl.last_sent_at > now() - interval '60 days') ${c.id ? tx`and k.id <> ${c.id}` : tx``})
    order by (l.website is not null) desc, l.code
    limit ${c.size}`;
}

/** Cuántos candidatos hay disponibles con esos filtros (para elegir el tamaño antes de crear). */
export async function countEligible(input: { channel: Channel; categoryIds: string[]; regions: string[]; zoneIds: string[]; onlyConsented?: boolean }) {
  return systemTx(async (tx) => (await eligibleLeads(tx, { channel: input.channel, category_ids: input.categoryIds, regions: input.regions, zone_ids: input.zoneIds, size: 500, only_consented: input.onlyConsented })).length);
}

export async function createCampaign(actor: Actor, input: z.input<typeof campaignSchema>) {
  assertManage(actor);
  const d = campaignSchema.parse(input);
  if (d.channel === "whatsapp_api") {
    // Los textos son las plantillas aprobadas por Meta: no se cambian campaña por campaña.
    Object.assign(d, { firstMessage: SUPPLY_TEMPLATES.first.body, followupMessage: d.maxAttempts > 1 ? SUPPLY_TEMPLATES.followup.body : "", emailSubject: "" });
  } else checkTexts(d);
  return systemTx(async (tx) => {
    let slug = slugify(d.name);
    if ((await tx`select 1 from supply_campaigns where slug = ${slug}`).length) slug = `${slug.slice(0, 40)}-${Date.now().toString(36).slice(-5)}`;
    const [c] = await tx<{ id: string }[]>`
      insert into supply_campaigns (name, slug, channel, category_ids, regions, zone_ids, size, first_message, followup_message, email_subject,
        followup_days, max_attempts, daily_cap, only_consented, created_by)
      values (${d.name}, ${slug}, ${d.channel}, ${d.categoryIds}, ${d.regions}, ${d.zoneIds}, ${d.size}, ${d.firstMessage}, ${d.followupMessage || null},
        ${d.emailSubject || null}, ${d.followupDays}, ${d.maxAttempts}, ${d.dailyCap}, ${d.onlyConsented}, ${actor.id})
      returning id`;
    const leads = await eligibleLeads(tx, { channel: d.channel, category_ids: d.categoryIds, regions: d.regions, zone_ids: d.zoneIds, size: d.size, id: c.id, only_consented: d.onlyConsented });
    if (!leads.length) throw invalid(d.onlyConsented
      ? "No hay contactos con consentimiento con esos filtros. Cargá la base marcando el consentimiento en «Cargar y sincronizar»."
      : "No hay candidatos disponibles con esos filtros (sin registrarse, sin otra campaña y con ese canal).");
    await tx`insert into supply_campaign_leads (campaign_id, lead_id) select ${c.id}, unnest(${leads.map((l) => l.id)}::uuid[])`;
    await audit(tx, actor, "supply.campaign_create", "supply_campaign", c.id, d.name, { channel: d.channel, leads: leads.length, onlyConsented: d.onlyConsented });
    return { id: c.id, leads: leads.length };
  });
}

async function lockCampaign(tx: Tx, id: string) {
  const [c] = await tx<{ id: string; name: string; status: string; channel: Channel }[]>`select id, name, status, channel from supply_campaigns where id = ${id} for update`;
  if (!c) throw notFound("Campaña inexistente.");
  return c;
}

/** Sacar un candidato de la tanda mientras está en borrador (no corresponde invitarlo). */
export async function removeFromCampaign(actor: Actor, campaignLeadId: string) {
  assertManage(actor);
  return systemTx(async (tx) => {
    const [cl] = await tx<{ campaign_id: string }[]>`select campaign_id from supply_campaign_leads where id = ${campaignLeadId}`;
    if (!cl) throw notFound();
    const c = await lockCampaign(tx, cl.campaign_id);
    if (c.status !== "draft") throw invalid("Solo se puede sacar candidatos mientras la campaña está en borrador.");
    await tx`delete from supply_campaign_leads where id = ${campaignLeadId}`;
  });
}

export async function setCampaignStatus(actor: Actor, id: string, to: "active" | "paused" | "closed") {
  assertManage(actor);
  const compliance = to === "active" ? await getCompliance() : null;
  // La consulta a Meta va antes de abrir la transacción (nunca una llamada externa con la base bloqueada).
  const [pre] = await sql()<{ channel: Channel }[]>`select channel from supply_campaigns where id = ${id}`;
  const templates = to === "active" && pre?.channel === "whatsapp_api" ? await supplyTemplatesStatus() : null;
  return systemTx(async (tx) => {
    const c = await lockCampaign(tx, id);
    const allowed: Record<string, string[]> = { draft: ["active", "closed"], active: ["paused", "closed"], paused: ["active", "closed"], closed: [] };
    if (!allowed[c.status].includes(to)) throw invalid("Ese cambio no corresponde al estado de la campaña.");
    if (to === "active") {
      const gaps = complianceGaps(compliance!, c.channel);
      if (c.channel === "whatsapp_api" && templates?.first !== "APPROVED") gaps.push("Plantilla de invitación aprobada por Meta (Requisitos › Crear plantillas)");
      if (gaps.length) throw invalid(`Antes de activar falta: ${gaps.join("; ")}.`);
    }
    await tx`update supply_campaigns set status = ${to}, activated_at = case when ${to} = 'active' then coalesce(activated_at, now()) else activated_at end,
      closed_at = case when ${to} = 'closed' then now() else closed_at end where id = ${id}`;
    await audit(tx, actor, `supply.campaign_${to}`, "supply_campaign", id, c.name);
  });
}

// ───────── Cola de WhatsApp (envío asistido) ─────────

async function campaignRow(tx: Tx, id: string) {
  const [c] = await tx<{ id: string; slug: string; name: string; status: string; channel: Channel; first_message: string; followup_message: string | null;
    email_subject: string | null; followup_days: number; max_attempts: number; daily_cap: number }[]>`
    select id, slug, name, status, channel, first_message, followup_message, email_subject, followup_days, max_attempts, daily_cap from supply_campaigns where id = ${id}`;
  if (!c) throw notFound("Campaña inexistente.");
  return c;
}

const leadForRender = (tx: Tx, leadId: string) => tx<(RenderLead & { whatsapp_e164: string | null; email: string | null; do_not_contact: boolean; provider_id: string | null })[]>`
  select l.id, l.code, l.business_name, l.contact_name, l.whatsapp_e164, l.email, l.do_not_contact, l.provider_id,
    (select c.name from categories c where c.id = l.primary_category_id) as trade, coalesce(z.name, l.base_locality) as place
  from supply_leads l left join zones z on z.id = l.base_zone_id where l.id = ${leadId}`.then((r) => r[0]);

export async function sentToday(db: Tx | ReturnType<typeof sql>, campaignId: string) {
  const [{ n }] = await db<{ n: number }[]>`
    select count(*)::int as n from supply_lead_events e where e.kind = 'campaign' and e.detail->>'campaign' = ${campaignId}
      and e.detail->>'action' = 'sent' and e.created_at >= date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') at time zone 'America/Argentina/Buenos_Aires'`;
  return n;
}

export type QueueItem = {
  campaignLeadId: string; leadId: string; code: string; businessName: string; trade: string | null; place: string | null;
  attempt: number; followup: boolean; message: string; waUrl: string | null;
};

/** Próximo candidato para enviar (primero los seguimientos vencidos). Respeta el tope diario. */
export async function nextInQueue(campaignId: string): Promise<{ item: QueueItem | null; sentToday: number; dailyCap: number; capReached: boolean; status: string }> {
  return systemTx(async (tx) => {
    const c = await campaignRow(tx, campaignId);
    const today = await sentToday(tx, campaignId);
    const base = { sentToday: today, dailyCap: c.daily_cap, capReached: today >= c.daily_cap, status: c.status };
    if (c.channel !== "whatsapp" || c.status !== "active" || base.capReached) return { item: null, ...base };
    const [next] = await tx<{ id: string; lead_id: string; attempts: number }[]>`
      select cl.id, cl.lead_id, cl.attempts from supply_campaign_leads cl join supply_leads l on l.id = cl.lead_id
      where cl.campaign_id = ${campaignId} and not l.do_not_contact and l.provider_id is null
        and (cl.status = 'queued' or (cl.status = 'sent' and cl.attempts < ${c.max_attempts} and cl.next_followup_at <= now()))
      order by (cl.status = 'sent') desc, cl.next_followup_at nulls last, cl.created_at, l.code limit 1`;
    if (!next) return { item: null, ...base };
    const lead = await leadForRender(tx, next.lead_id);
    const followup = next.attempts > 0;
    const message = renderMessage(followup ? c.followup_message ?? c.first_message : c.first_message, lead, c);
    return {
      item: {
        campaignLeadId: next.id, leadId: lead.id, code: lead.code, businessName: lead.business_name, trade: lead.trade, place: lead.place,
        attempt: next.attempts + 1, followup, message,
        waUrl: lead.whatsapp_e164 ? `https://wa.me/${lead.whatsapp_e164}?text=${encodeURIComponent(message)}` : null,
      },
      ...base,
    };
  });
}

async function lockCampaignLead(tx: Tx, campaignLeadId: string) {
  const [cl] = await tx<{ id: string; campaign_id: string; lead_id: string; status: string; attempts: number }[]>`
    select id, campaign_id, lead_id, status, attempts from supply_campaign_leads where id = ${campaignLeadId} for update`;
  if (!cl) throw notFound();
  return cl;
}

/** Quedó registrado el envío (WhatsApp asistido o email): historial, etapa Contactado y próximo seguimiento. */
async function recordSendTx(tx: Tx, c: { id: string; name: string; channel: string; followup_days: number; max_attempts: number }, cl: { id: string; lead_id: string; attempts: number }, actorId: string | null) {
  const attempt = cl.attempts + 1;
  await tx`update supply_campaign_leads set status = 'sent', attempts = ${attempt}, last_sent_at = now(), lease_until = null, last_error = null,
    -- Después del último intento, la fecha marca cuándo pasa a «sin respuesta».
    next_followup_at = now() + make_interval(days => ${c.followup_days})
    where id = ${cl.id}`;
  await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${cl.lead_id}, 'campaign',
    ${tx.json({ campaign: c.id, name: c.name, action: "sent", channel: c.channel, attempt } as never)}, ${actorId})`;
  const [l] = await tx<{ stage: string }[]>`select stage from supply_leads where id = ${cl.lead_id} for update`;
  if (l.stage === "candidate") {
    await tx`update supply_leads set stage = 'contacted', contacted_at = coalesce(contacted_at, now()), owner_id = coalesce(owner_id, ${actorId}) where id = ${cl.lead_id}`;
    await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${cl.lead_id}, 'stage', ${tx.json({ from: "candidate", to: "contacted", campaign: c.id } as never)}, ${actorId})`;
  }
}

export type QueueOutcome = "sent" | "skip" | "interested" | "not_interested" | "opt_out";

/** Lo que pasó con un candidato de la cola: se mandó, se salteó, respondió (interesado / no) o pidió la baja. */
export async function resolveQueueItem(actor: Actor, campaignLeadId: string, outcome: QueueOutcome, note?: string) {
  assertManage(actor);
  return systemTx(async (tx) => {
    const cl = await lockCampaignLead(tx, campaignLeadId);
    const c = await campaignRow(tx, cl.campaign_id);
    const ev = (action: string, extra: Record<string, unknown> = {}) =>
      tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${cl.lead_id}, 'campaign', ${tx.json({ campaign: c.id, name: c.name, action, ...extra } as never)}, ${actor.id})`;
    if (outcome === "sent") {
      if (c.status !== "active") throw invalid("La campaña no está activa.");
      if (c.channel !== "whatsapp") throw invalid("Esta campaña manda sola: no hay que marcar envíos.");
      if (!["queued", "sent"].includes(cl.status)) throw invalid("Este candidato ya no está en la cola.");
      if ((await sentToday(tx, c.id)) >= c.daily_cap) throw invalid(`Ya se mandaron los ${c.daily_cap} del día. Seguí mañana: mandar muchos seguidos desde un número nuevo hace que WhatsApp lo bloquee.`);
      const [dnc] = await tx<{ do_not_contact: boolean }[]>`select do_not_contact from supply_leads where id = ${cl.lead_id}`;
      if (dnc.do_not_contact) throw invalid("Este candidato pidió que no lo contactemos.");
      await recordSendTx(tx, c, cl, actor.id);
      return;
    }
    if (outcome === "skip") {
      await tx`update supply_campaign_leads set status = 'skipped', skip_reason = ${(note ?? "Salteado").slice(0, 200)}, next_followup_at = null where id = ${cl.id}`;
      await ev("skipped", { reason: note ?? null });
      return;
    }
    if (outcome === "opt_out") {
      await tx`update supply_campaign_leads set status = 'opted_out', next_followup_at = null where id = ${cl.id}`;
      await optOutTx(tx, cl.lead_id, note || "Respondió BAJA a la campaña", actor.id);
      await ev("opted_out");
      return;
    }
    await tx`update supply_campaign_leads set status = 'replied', replied_at = now(), next_followup_at = null where id = ${cl.id}`;
    await ev(outcome === "interested" ? "replied_interested" : "replied_not_interested", { note: note ?? null });
    const [l] = await tx<{ stage: string; provider_id: string | null }[]>`select stage, provider_id from supply_leads where id = ${cl.lead_id} for update`;
    if (!l.provider_id) {
      const to = outcome === "interested" ? "interested" : "discarded";
      await tx`update supply_leads set stage = ${to}, ${to === "interested" ? tx`interested_at = coalesce(interested_at, now())` : tx`discarded_at = now(), discard_reason = ${(note || "No le interesa").slice(0, 300)}`}
        where id = ${cl.lead_id}`;
      await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${cl.lead_id}, 'stage', ${tx.json({ from: l.stage, to, campaign: c.id } as never)}, ${actor.id})`;
    }
  });
}

async function optOutTx(tx: Tx, leadId: string, reason: string, actorId: string | null) {
  await tx`update supply_leads set do_not_contact = true, opt_out_at = coalesce(opt_out_at, now()),
    stage = case when provider_id is null then 'discarded' else stage end,
    discarded_at = case when provider_id is null then coalesce(discarded_at, now()) else discarded_at end,
    discard_reason = case when provider_id is null then 'Pidió no ser contactado' else discard_reason end where id = ${leadId}`;
  await tx`update supply_campaign_leads set status = 'opted_out', next_followup_at = null where lead_id = ${leadId} and status in ('queued','sent')`;
  await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${leadId}, 'opt_out', ${tx.json({ reason: reason.slice(0, 300) } as never)}, ${actorId})`;
}

/** Baja desde el link del email (la persona confirma con un botón; los lectores de links no la disparan). */
export async function optOutByToken(token: string) {
  const id = verifyOptOutToken(token);
  if (!id) return false;
  await systemTx(async (tx) => {
    const [l] = await tx<{ do_not_contact: boolean }[]>`select do_not_contact from supply_leads where id = ${id} for update`;
    if (l && !l.do_not_contact) await optOutTx(tx, id, "Pidió la baja desde el email", null);
  });
  return true;
}

// ───────── Clics en la invitación ─────────

/** Alguien abrió el link de invitación (/alta?ref=fx-001 o el de la web): queda en el historial y en su campaña. */
export async function recordInviteClick(ref: string | null | undefined, via: "whatsapp" | "web") {
  const code = (ref ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2,4}-[0-9]{1,6}$/.test(code)) return;
  try {
    await systemTx(async (tx) => {
      const [l] = await tx<{ id: string }[]>`select id from supply_leads where code = ${code}`;
      if (!l) return;
      // Un clic por día alcanza para medir (se abre varias veces el mismo link).
      const [recent] = await tx`select 1 from supply_lead_events where lead_id = ${l.id} and kind = 'click' and created_at > now() - interval '1 day'`;
      if (!recent) await tx`insert into supply_lead_events (lead_id, kind, detail) values (${l.id}, 'click', ${tx.json({ via } as never)})`;
      await tx`update supply_campaign_leads set clicked_at = coalesce(clicked_at, now()) where lead_id = ${l.id} and status in ('sent','replied','queued')`;
    });
  } catch (e) {
    console.error("[captacion] no se pudo registrar el clic", e instanceof Error ? e.message : e);
  }
}

// ───────── Tarea programada: emails y vencimientos ─────────

/** Envía los emails de campañas activas (tope diario por campaña) y cierra los seguimientos agotados. */
export async function runSupplyOutreach(limit = 50, adapter: EmailAdapter = emailAdapter(), now = new Date()) {
  let sent = 0, failed = 0;
  const notes: string[] = [];
  // Deja listo lo que falte en Meta (plantillas) y en Kommo (embudo), sin que nadie tenga que entrar al panel.
  const setup = await ensureSupplySetup().catch((e: Error) => [`Preparación: ${e.message.slice(0, 200)}`]);
  notes.push(...setup);
  // Primero lo que el equipo movió en Kommo (respondió, interesado, baja): corta recordatorios antes de mandar.
  const kommo = await syncKommo().catch((e: Error) => { notes.push(`Kommo: ${e.message.slice(0, 200)}`); return null; });
  // Solo en horario comercial (lunes a sábado, 9 a 19 de Argentina).
  const ar = new Date(now.getTime() - 3 * 3600_000);
  const businessHours = ar.getUTCDay() !== 0 && ar.getUTCHours() >= 9 && ar.getUTCHours() < 19;
  const campaigns = businessHours
    ? await sql()<{ id: string; channel: Channel }[]>`select id, channel from supply_campaigns where status = 'active' and channel in ('email','whatsapp_api') order by activated_at`
    : [];
  const compliance = await getCompliance();
  // WhatsApp automático: plantilla aprobada y número en buena calidad (si Meta lo marca en amarillo o rojo, se frena).
  let waReady = false;
  if (campaigns.some((c) => c.channel === "whatsapp_api") && !complianceGaps(compliance, "whatsapp_api").length) {
    const [templates, number] = await Promise.all([supplyTemplatesStatus(), supplyNumberStatus()]);
    waReady = templates?.first === "APPROVED" && (!number?.quality || number.quality === "GREEN" || number.quality === "UNKNOWN") && number?.canSend !== "BLOCKED";
    if (!waReady) notes.push(`WhatsApp frenado: plantilla ${templates?.first ?? "?"}, calidad del número ${number?.quality ?? "?"}, envío ${number?.canSend ?? "?"}${number?.problems.length ? ` · ${number.problems.join(" · ")}` : ""}`);
  }
  for (const { id, channel } of campaigns) {
    if (channel === "email" && complianceGaps(compliance, "email", adapter.name !== "console").length) continue;
    if (channel === "whatsapp_api" && !waReady) continue;
    const c = await systemTx((tx) => campaignRow(tx, id));
    const room = Math.min(limit - sent - failed, c.daily_cap - (await sentToday(sql(), id)));
    if (room <= 0) continue;
    const claimed = await sql()<{ id: string; lead_id: string; attempts: number }[]>`
      update supply_campaign_leads set lease_until = now() + interval '5 minutes'
      where id in (
        select cl.id from supply_campaign_leads cl join supply_leads l on l.id = cl.lead_id
        where cl.campaign_id = ${id} and not l.do_not_contact and l.provider_id is null
          and ${channel === "email" ? sql()`l.email is not null` : sql()`l.whatsapp_e164 is not null`}
          and (cl.lease_until is null or cl.lease_until < now())
          and (cl.status = 'queued' or (cl.status = 'sent' and cl.attempts < ${c.max_attempts} and cl.next_followup_at <= now()))
        order by (cl.status = 'sent') desc, cl.created_at limit ${room} for update of cl skip locked)
      returning id, lead_id, attempts`;
    for (const cl of claimed) {
      const lead = await systemTx((tx) => leadForRender(tx, cl.lead_id));
      const followup = cl.attempts > 0;
      // Envío sin transacción abierta.
      let error: string | null = null, permanent = false, messageId: string | null = null;
      if (channel === "email") {
        try {
          await adapter.send({
            to: lead.email!, subject: renderMessage(c.email_subject ?? DEFAULT_EMAIL_SUBJECT, lead, c),
            text: renderMessage(followup ? c.followup_message ?? c.first_message : c.first_message, lead, c) + emailFooter(lead.id), link: null,
            headers: { "List-Unsubscribe": `<${baseUrl()}/captacion/baja?t=${optOutToken(lead.id)}>` },
          }, { idempotencyKey: `supply-${cl.id}-${cl.attempts + 1}` });
        } catch (e) {
          error = (e instanceof Error ? e.message : "error").slice(0, 300);
        }
      } else {
        const r = await sendSupplyTemplate(lead.whatsapp_e164!, followup ? "followup" : "first", templateParams(lead), lead.code.toLowerCase());
        if (r.ok) messageId = r.id;
        else ({ error, permanent } = r);
      }
      if (error) {
        // Rechazos definitivos (no tiene WhatsApp, no acepta marketing): se saltea; el resto se reintenta en la próxima vuelta.
        await sql()`update supply_campaign_leads set lease_until = null, last_error = ${error},
          status = case when ${permanent} then 'skipped' else status end, skip_reason = case when ${permanent} then ${error.slice(0, 200)} else skip_reason end
          where id = ${cl.id}`;
        failed++;
        continue;
      }
      await systemTx(async (tx) => {
        await recordSendTx(tx, c, cl, null);
        if (messageId) await tx`update supply_campaign_leads set last_message_id = ${messageId} where id = ${cl.id}`;
      });
      sent++;
      if (channel === "whatsapp_api" && kommoConfigured()) {
        // Kommo es la bandeja: si falla, el envío ya salió; queda anotado y se reintenta en el próximo mensaje.
        try {
          const [{ kommo_lead_id }] = await sql()<{ kommo_lead_id: number | null }[]>`select kommo_lead_id from supply_leads where id = ${lead.id}`;
          const kommoId = await registerInvitation({
            kommoLeadId: kommo_lead_id, code: lead.code, name: templateParams(lead)[0], phoneE164: lead.whatsapp_e164!, trade: lead.trade, place: lead.place,
            followup, text: fillTemplate(SUPPLY_TEMPLATES[followup ? "followup" : "first"].body, templateParams(lead)),
          });
          if (kommoId !== kommo_lead_id) await sql()`update supply_leads set kommo_lead_id = ${kommoId} where id = ${lead.id}`;
        } catch (e) {
          await sql()`update supply_campaign_leads set last_error = ${`Kommo: ${(e as Error).message}`.slice(0, 300)} where id = ${cl.id}`;
        }
      }
    }
  }
  // Seguimientos agotados: pasó el plazo del último intento sin respuesta.
  const closed = await sql()`
    update supply_campaign_leads cl set status = 'no_response', next_followup_at = null
    from supply_campaigns c where c.id = cl.campaign_id and cl.status = 'sent' and cl.attempts >= c.max_attempts and cl.next_followup_at <= now()`;
  return { sent, failed, noResponse: closed.count, kommo, notes };
}

/**
 * Con el número comercial y Kommo conectados: manda a revisión de Meta las plantillas que falten y arma el embudo
 * «Captación Fixy» si no existe. Como mucho una vez por hora (lo que ya está, no se toca).
 */
export async function ensureSupplySetup(): Promise<string[]> {
  const out: string[] = [];
  const [last] = await sql()<{ at: string }[]>`select value->>'at' as at from platform_settings where key = 'supply.setup'`;
  if (last?.at && Date.now() - new Date(last.at).getTime() < 55 * 60_000) return out;
  // Cada paso por separado: si uno falla, el otro igual se hace y queda anotado.
  if (!supplyNumberConfigured()) out.push("Meta: número comercial sin configurar (SUPPLY_WHATSAPP_PHONE_NUMBER_ID y token)");
  else {
    try {
      const st = await supplyTemplatesStatus();
      if (!st) out.push("Meta: no se pudo consultar la cuenta (revisar SUPPLY_WHATSAPP_WABA_ID y que el token tenga asignada esa cuenta)");
      else if (Object.values(st).includes("NO_CREADA")) out.push(...(await createSupplyTemplates()).map((r) => `Meta: ${r}`));
      else out.push(`Meta: plantillas ${Object.values(st).join(" / ")}`);
      const n = await supplyNumberStatus();
      out.push(n ? `Meta: número ${n.display} · ${n.name ?? "sin nombre"} · calidad ${n.quality ?? "—"} · límite ${n.tier ?? "—"} · estado ${n.status ?? "—"} · modo ${n.mode ?? "—"} · envío ${n.canSend ?? "—"}` : "Meta: no se pudo leer el número (revisar SUPPLY_WHATSAPP_PHONE_NUMBER_ID)");
      for (const p of n?.problems ?? []) out.push(`Meta: problema — ${p}`);
    } catch (e) {
      out.push(`Meta: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  if (!kommoConfigured()) out.push("Kommo: sin configurar (KOMMO_TOKEN y KOMMO_SUBDOMINIO)");
  else {
    try {
      out.push(...(await setupKommoPipeline()).map((r) => `Kommo: ${r}`));
    } catch (e) {
      out.push(`Kommo: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  // Si algo falló, se reintenta en la próxima vuelta (no se guarda la marca de «hecho»).
  if (out.some((r) => /no se pudo|sin configurar|Kommo \d{3}|Meta \d{3}|rechaz|error/i.test(r))) return out;
  if (out.length) {
    await sql()`insert into platform_settings (key, value) values ('supply.setup', ${sql().json({ at: new Date().toISOString(), results: out } as never)})
      on conflict (key) do update set value = excluded.value, updated_at = now()`;
  }
  return out;
}

/** Parámetros de las plantillas de invitación: nombre, oficio, zona. */
export function templateParams(lead: RenderLead) {
  const name = lead.contact_name ? lead.contact_name.split(/\s+/)[0] : lead.business_name.split(/\s+[—–|-]\s+/)[0];
  return [waParam(name, 40), waParam((lead.trade ?? "tu oficio").toLowerCase(), 40), waParam(lead.place ?? "tu zona", 40)];
}
const fillTemplate = (body: string, params: string[]) => body.replace(/\{\{(\d)\}\}/g, (_, n) => params[Number(n) - 1] ?? "");

/**
 * Lee de Kommo lo que el equipo hizo con cada respuesta y lo aplica en Fixy: «Respondió» o «Interesado» cortan los
 * recordatorios (e «Interesado» pasa la etapa); «No le interesa / Baja» lo marca para no volver a contactarlo.
 * Además mueve a «Se registró» en Kommo a quienes ya crearon su perfil.
 */
export async function syncKommo() {
  if (!kommoConfigured()) return null;
  const outcomes = await kommoOutcomes();
  let replied = 0, optedOut = 0;
  for (const o of outcomes) {
    const changed = await systemTx(async (tx) => {
      const [l] = await tx<{ id: string; stage: string; provider_id: string | null; do_not_contact: boolean }[]>`
        select id, stage, provider_id, do_not_contact from supply_leads where kommo_lead_id = ${o.leadId} for update`;
      if (!l) return null;
      if (o.meaning === "opt_out") {
        if (l.do_not_contact) return null;
        await optOutTx(tx, l.id, "Pidió no recibir más mensajes (Kommo)", null);
        return "opt_out";
      }
      const r = await tx`update supply_campaign_leads set status = 'replied', replied_at = coalesce(replied_at, now()), next_followup_at = null
        where lead_id = ${l.id} and status in ('queued','sent','no_response')`;
      if (o.meaning === "interested" && !l.provider_id && !["interested", "discarded"].includes(l.stage)) {
        await tx`update supply_leads set stage = 'interested', interested_at = coalesce(interested_at, now()) where id = ${l.id}`;
        await tx`insert into supply_lead_events (lead_id, kind, detail) values (${l.id}, 'stage', ${tx.json({ from: l.stage, to: "interested", via: "kommo" } as never)})`;
      }
      return r.count ? "replied" : null;
    });
    if (changed === "opt_out") optedOut++;
    else if (changed === "replied") replied++;
  }
  // Registrados que todavía no figuran así en Kommo.
  const registered = await sql()<{ id: string; kommo_lead_id: number }[]>`
    select l.id, l.kommo_lead_id from supply_leads l where l.kommo_lead_id is not null and l.provider_id is not null
      and not exists (select 1 from supply_lead_events e where e.lead_id = l.id and e.kind = 'campaign' and e.detail->>'action' = 'kommo_registered')`;
  if (registered.length) {
    await markRegisteredInKommo(registered.map((r) => r.kommo_lead_id));
    await sql()`insert into supply_lead_events (lead_id, kind, detail) select unnest(${registered.map((r) => r.id)}::uuid[]), 'campaign', '{"action":"kommo_registered"}'::jsonb`;
  }
  return { replied, optedOut, registered: registered.length };
}

/** Cómo le llega el mensaje al primer candidato de la tanda (para revisar antes de activar). */
export async function previewCampaign(campaignId: string) {
  return systemTx(async (tx) => {
    const c = await campaignRow(tx, campaignId);
    const [first] = await tx<{ lead_id: string }[]>`select lead_id from supply_campaign_leads where campaign_id = ${campaignId} order by created_at limit 1`;
    if (!first) return null;
    const lead = await leadForRender(tx, first.lead_id);
    if (c.channel === "whatsapp_api") {
      const extra = `\n\n${SUPPLY_FOOTER}\n[Quiero sumarme] [No me interesa]`;
      return {
        to: lead.business_name, subject: null,
        first: fillTemplate(SUPPLY_TEMPLATES.first.body, templateParams(lead)) + extra,
        followup: c.followup_message ? fillTemplate(SUPPLY_TEMPLATES.followup.body, templateParams(lead)) + extra : null,
      };
    }
    return {
      to: lead.business_name,
      subject: c.channel === "email" ? renderMessage(c.email_subject ?? DEFAULT_EMAIL_SUBJECT, lead, c) : null,
      first: renderMessage(c.first_message, lead, c) + (c.channel === "email" ? emailFooter(lead.id) : ""),
      followup: c.followup_message ? renderMessage(c.followup_message, lead, c) : null,
    };
  });
}
