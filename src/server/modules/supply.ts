/**
 * Captación de profesionales: dos vías, un solo backend.
 *  - Research (planilla, cargas manuales): candidatos comerciales que se contactan e invitan.
 *  - Altas espontáneas (web, campañas, WhatsApp): al crearse el perfil se busca el candidato (por código de invitación,
 *    teléfono o email) y se vincula; si no existe, se crea uno con el origen de la campaña.
 * Etapas: candidate → contacted → interested las marca el equipo; registered → verified → active salen del perfil real.
 * Nunca se pisa lo que el equipo trabajó (etapa, notas, responsable, "no contactar") al sincronizar.
 */
import { z } from "zod";
import { sql, systemTx, type Tx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { env } from "@/server/env";
import { normalizeArPhone, phoneKey } from "@/lib/phone-ar";
import { tradeSlugsFromText } from "@/lib/trades";
import { guessZoneFromText, type MatchZone } from "@/lib/zone-match";

export const LEAD_STAGES = ["candidate", "contacted", "interested", "registered", "verified", "active", "discarded"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];
export const LEAD_STAGE_LABEL: Record<LeadStage, string> = {
  candidate: "Candidato", contacted: "Contactado", interested: "Interesado", registered: "Registrado", verified: "Verificado", active: "Activo", discarded: "Descartado",
};
export const LEAD_SOURCE_LABEL: Record<string, string> = {
  research: "Research", ads: "Campañas", organic: "Alta espontánea", whatsapp: "WhatsApp", referral: "Referido", manual: "Carga manual",
};
const LEAD_CODE = /^[A-Z]{2,4}-[0-9]{1,6}$/;
export const isLeadCode = (s: string | null | undefined) => !!s && LEAD_CODE.test(s.toUpperCase());

// ───────── Normalización de filas (research) ─────────

export type LeadInput = {
  code: string; businessName: string; trades: string; locality: string; phone: string; email: string; website: string;
  contactName?: string; sourceDetail?: string; sourceUrl?: string; raw: Record<string, string>;
};
export type SyncIssue = { code: string; problem: string };

/** Lee filas de planilla por nombre de columna (el orden puede cambiar). La primera fila son los encabezados. */
export function parseResearchRows(rows: string[][]): { inputs: LeadInput[]; issues: SyncIssue[] } {
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const ix = {
    code: col("id fixy", "id"), name: col("nombre comercial", "nombre"), trades: col("oficio", "rubro principal", "rubro"),
    locality: col("localidad base", "localidad"), phone: col("teléfono comercial", "telefono comercial", "teléfono", "telefono"),
    email: col("email comercial", "email"), website: col("sitio / perfil", "sitio", "perfil", "web"), contact: col("contacto", "nombre de contacto"),
    source: col("fuente", "url fuente", "link fuente", "canal", "origen"),
  };
  const issues: SyncIssue[] = [];
  // Sin columna ID (por ejemplo, una base externa) se asignan códigos AL- y no se duplica por teléfono o email.
  if (ix.name < 0) return { inputs: [], issues: [{ code: "-", problem: "Falta la columna Nombre (o Nombre comercial)" }] };
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").toString().trim() : "");
  const inputs: LeadInput[] = [];
  for (const r of rows.slice(1)) {
    const code = get(r, ix.code).toUpperCase();
    if (!code && !get(r, ix.name)) continue; // fila vacía
    if (code && !LEAD_CODE.test(code)) {
      issues.push({ code: code || "(sin ID)", problem: "ID con formato inválido (se espera FX-001)" });
      continue;
    }
    inputs.push({
      code, businessName: get(r, ix.name), trades: get(r, ix.trades), locality: get(r, ix.locality), phone: get(r, ix.phone),
      email: get(r, ix.email), website: get(r, ix.website), contactName: get(r, ix.contact) || undefined,
      // «Fuente»: la URL de donde salió el contacto (directorio, sitio, red); si no es URL, es una descripción.
      ...(cleanUrl(get(r, ix.source)) ? { sourceUrl: get(r, ix.source) } : { sourceDetail: get(r, ix.source) || undefined }),
      raw: Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").toString()]).filter(([h, v]) => h && v)),
    });
  }
  return { inputs, issues };
}

type Ctx = { catBySlug: Map<string, string>; zones: (MatchZone & { id: string; region: string })[] };
async function loadCtx(db: Tx): Promise<Ctx> {
  const cats = await db<{ id: string; slug: string }[]>`select id, slug from categories where active`;
  const zones = await db<(MatchZone & { id: string; region: string })[]>`select id, code, name, region, match_names, province, catch_all from zones where active`;
  return { catBySlug: new Map(cats.map((c) => [c.slug, c.id])), zones: [...zones] };
}

/** Localidad base → zona de Fixy (primero en el AMBA, que es donde se hizo el research) y región. */
function locateBase(locality: string, ctx: Ctx): { zoneId: string | null; region: string | null } {
  if (!locality) return { zoneId: null, region: null };
  const z = guessZoneFromText(`${locality}, Buenos Aires`, ctx.zones) ?? guessZoneFromText(`${locality}, Ciudad de Buenos Aires`, ctx.zones) ?? guessZoneFromText(locality, ctx.zones);
  if (z && !z.catch_all) return { zoneId: z.id, region: z.region };
  const t = locality.toLowerCase();
  if (/\bcaba\b|capital federal|ciudad de buenos aires/.test(t)) return { zoneId: null, region: "CABA" };
  if (/zona norte|gba norte|corredor norte/.test(t)) return { zoneId: null, region: "GBA_NORTE" };
  return { zoneId: null, region: null };
}

const cleanEmail = (e: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) ? e.trim().toLowerCase() : null);
// "plomeros.com.ar" o "instagram.com/x" sin https:// también valen.
const cleanUrl = (u: string) => {
  const v = u.trim();
  if (/^https?:\/\/\S+\.\S+$/i.test(v)) return v.slice(0, 500);
  return /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) ? `https://${v}`.slice(0, 500) : null;
};

type Normalized = {
  code: string; business_name: string; contact_name: string | null; phone_raw: string | null; phone_key: string | null; whatsapp_e164: string | null;
  email: string | null; website: string | null; trades_raw: string | null; category_ids: string[]; primary_category_id: string | null;
  base_locality: string | null; base_zone_id: string | null; base_region: string | null; source_detail: string | null; source_url: string | null; research_data: Record<string, string>;
};

function normalize(i: LeadInput, ctx: Ctx, issues: SyncIssue[]): Normalized | null {
  if (!i.businessName) {
    issues.push({ code: i.code, problem: "Sin nombre comercial" });
    return null;
  }
  const phone = normalizeArPhone(i.phone);
  if (i.phone && !phone) issues.push({ code: i.code, problem: `Teléfono que no se pudo interpretar: «${i.phone}»` });
  const catIds = tradeSlugsFromText(i.trades).map((s) => ctx.catBySlug.get(s)).filter((x): x is string => !!x);
  if (i.trades && !catIds.length) issues.push({ code: i.code, problem: `Oficio sin rubro de Fixy: «${i.trades}»` });
  const base = locateBase(i.locality, ctx);
  if (i.locality && !base.zoneId && !base.region) issues.push({ code: i.code, problem: `Localidad sin zona: «${i.locality}»` });
  return {
    code: i.code, business_name: i.businessName.slice(0, 200), contact_name: i.contactName?.slice(0, 120) ?? null,
    phone_raw: i.phone ? i.phone.slice(0, 60) : null, phone_key: phone?.key ?? null, whatsapp_e164: phone?.whatsapp ?? null,
    email: cleanEmail(i.email), website: cleanUrl(i.website), trades_raw: i.trades ? i.trades.slice(0, 200) : null,
    category_ids: catIds, primary_category_id: catIds[0] ?? null, base_locality: i.locality ? i.locality.slice(0, 120) : null,
    base_zone_id: base.zoneId, base_region: base.region, source_detail: i.sourceDetail?.slice(0, 200) ?? null, source_url: i.sourceUrl ? cleanUrl(i.sourceUrl) : null, research_data: i.raw,
  };
}

/** Profesional ya registrado con ese teléfono o email (para vincular en vez de tratarlo como candidato nuevo). */
async function findProviderFor(tx: Tx, key: string | null, email: string | null) {
  if (!key && !email) return null;
  const rows = await tx<{ provider_id: string; user_id: string | null; contact_phone: string | null; whatsapp_phone: string | null; phone: string | null; email: string | null }[]>`
    select p.id as provider_id, m.user_id, p.contact_phone, u.whatsapp_phone, u.phone, case when u.email_placeholder then null else lower(u.email) end as email
    from providers p left join provider_members m on m.provider_id = p.id and m.role = 'admin' left join users u on u.id = m.user_id
    where p.status <> 'rejected' and not exists (select 1 from supply_leads l where l.provider_id = p.id)`;
  return rows.find((r) => (key && [r.contact_phone, r.whatsapp_phone, r.phone].some((p) => phoneKey(p) === key)) || (email && r.email === email)) ?? null;
}

// ───────── Importación / sincronización incremental ─────────

export type SyncResult = { runId: string; inserted: number; updated: number; unchanged: number; skipped: number; issues: SyncIssue[] };

/**
 * Incorpora candidatos de una fuente de research. Idempotente por código (FX-001): los nuevos se agregan; de los
 * existentes solo se completan datos que en Fixy estaban vacíos y se guarda la fila original como respaldo.
 * No duplica: un código nuevo con el teléfono o email de otro candidato se informa y se saltea.
 */
export async function importLeads(
  inputs: LeadInput[],
  opts: {
    source?: "research" | "manual"; sourceDetail: string; trigger: "cron" | "manual" | "upload" | "initial"; actor?: Actor | null; preIssues?: SyncIssue[];
    /** La base trae consentimiento para recibir WhatsApp de Fixy: de dónde sale (se guarda en cada contacto). */
    consent?: { source: string };
  },
): Promise<SyncResult> {
  return systemTx(async (tx) => {
    const ctx = await loadCtx(tx);
    const issues: SyncIssue[] = [...(opts.preIssues ?? [])];
    const [run] = await tx<{ id: string }[]>`insert into supply_sync_runs (source, trigger, actor_id) values (${opts.sourceDetail}, ${opts.trigger}, ${opts.actor?.id ?? null}) returning id`;
    let inserted = 0, updated = 0, unchanged = 0, skipped = 0;
    const seen = new Set<string>();
    // Consentimiento: se registra en el contacto (nuevo, existente o duplicado por teléfono) salvo que haya pedido la baja.
    const consent = async (leadId: string) => {
      if (!opts.consent) return;
      const r = await tx`update supply_leads set wa_consent_at = now(), wa_consent_source = ${opts.consent.source.slice(0, 300)}
        where id = ${leadId} and wa_consent_at is null and not do_not_contact`;
      if (r.count) await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${leadId}, 'consent', ${tx.json({ source: opts.consent.source, run: run.id } as never)}, ${opts.actor?.id ?? null})`;
    };
    for (const input of inputs) {
      if (!input.code) {
        const [{ n }] = await tx<{ n: number }[]>`select nextval('supply_lead_al_seq')::int as n`;
        input.code = `AL-${String(n).padStart(4, "0")}`;
      }
      if (seen.has(input.code)) {
        issues.push({ code: input.code, problem: "ID repetido en la fuente" });
        skipped++;
        continue;
      }
      seen.add(input.code);
      const n = normalize(input, ctx, issues);
      if (!n) { skipped++; continue; }
      const [existing] = await tx<{ id: string; business_name: string; phone_key: string | null; email: string | null; website: string | null; trades_raw: string | null; category_ids: string[]; base_locality: string | null; contact_name: string | null; source_url: string | null }[]>`
        select id, business_name, phone_key, email, website, trades_raw, category_ids, base_locality, contact_name, source_url from supply_leads where code = ${n.code} for update`;
      if (existing) {
        // Solo lo nuevo: completa vacíos; lo que el equipo trabajó no se toca.
        const patch: Partial<Normalized> = {};
        if (!existing.phone_key && n.phone_key) Object.assign(patch, { phone_raw: n.phone_raw, phone_key: n.phone_key, whatsapp_e164: n.whatsapp_e164 });
        if (!existing.email && n.email) patch.email = n.email;
        if (!existing.website && n.website) patch.website = n.website;
        if (!existing.contact_name && n.contact_name) patch.contact_name = n.contact_name;
        if (!existing.source_url && n.source_url) patch.source_url = n.source_url;
        if (!existing.category_ids.length && n.category_ids.length) Object.assign(patch, { category_ids: n.category_ids, primary_category_id: n.primary_category_id, trades_raw: n.trades_raw });
        if (!existing.base_locality && n.base_locality) Object.assign(patch, { base_locality: n.base_locality, base_zone_id: n.base_zone_id, base_region: n.base_region });
        // Respaldo de la fila: se suman columnas nuevas, pero lo que ya se había levantado no se pisa.
        await tx`update supply_leads set research_data = ${tx.json(n.research_data as never)} || research_data, synced_at = now() where id = ${existing.id}`;
        await consent(existing.id);
        if (Object.keys(patch).length) {
          await tx`update supply_leads set ${tx(patch as Record<string, unknown>, ...Object.keys(patch))} where id = ${existing.id}`;
          await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${existing.id}, 'sync_update', ${tx.json({ fields: Object.keys(patch), run: run.id } as never)}, ${opts.actor?.id ?? null})`;
          updated++;
        } else unchanged++;
        continue;
      }
      const [dup] = n.phone_key || n.email
        ? await tx<{ id: string; code: string }[]>`select id, code from supply_leads where (${n.phone_key}::text is not null and phone_key = ${n.phone_key}) or (${n.email}::text is not null and lower(email) = ${n.email}) limit 1`
        : [];
      if (dup) {
        await consent(dup.id);
        issues.push({ code: n.code, problem: `Duplicado de ${dup.code} (mismo teléfono o email): no se cargó${opts.consent ? "; se registró el consentimiento en el existente" : ""}` });
        skipped++;
        continue;
      }
      const match = await findProviderFor(tx, n.phone_key, n.email);
      const [lead] = await tx<{ id: string }[]>`
        insert into supply_leads (code, source, source_detail, source_url, business_name, contact_name, phone_raw, phone_key, whatsapp_e164, email, website, trades_raw,
          category_ids, primary_category_id, base_locality, base_zone_id, base_region, research_data, synced_at, provider_id, user_id, stage, registered_at)
        values (${n.code}, ${opts.source ?? "research"}, ${n.source_detail ?? opts.sourceDetail}, ${n.source_url}, ${n.business_name}, ${n.contact_name}, ${n.phone_raw}, ${n.phone_key},
          ${n.whatsapp_e164}, ${n.email}, ${n.website}, ${n.trades_raw}, ${n.category_ids}, ${n.primary_category_id}, ${n.base_locality}, ${n.base_zone_id},
          ${n.base_region}, ${tx.json(n.research_data as never)}, now(), ${match?.provider_id ?? null}, ${match?.user_id ?? null},
          ${match ? "registered" : "candidate"}, ${match ? new Date() : null})
        returning id`;
      await consent(lead.id);
      await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${lead.id}, 'import', ${tx.json({ run: run.id, source: opts.sourceDetail, linkedProvider: match?.provider_id ?? null } as never)}, ${opts.actor?.id ?? null})`;
      inserted++;
    }
    await tx`update supply_sync_runs set finished_at = now(), ok = true, inserted = ${inserted}, updated = ${updated}, unchanged = ${unchanged}, skipped = ${skipped},
      issues = ${tx.json(issues.slice(0, 500) as never)} where id = ${run.id}`;
    await refreshLeadStagesTx(tx);
    if (opts.actor) await audit(tx, opts.actor, "supply.import", "supply_sync_run", run.id, opts.sourceDetail, { inserted, updated, skipped });
    return { runId: run.id, inserted, updated, unchanged, skipped, issues };
  });
}

/** Sincronización con la planilla de research (cron diario o botón del panel). Sin acceso, queda la corrida fallida con el motivo. */
export async function syncSupplySheet(trigger: "cron" | "manual", actor?: Actor | null): Promise<SyncResult | { error: string }> {
  const { readSheet, SheetAccessError } = await import("@/server/integrations/google-sheets");
  const label = `Planilla ${env().SUPPLY_SHEET_TAB}`;
  try {
    const { rows } = await readSheet();
    const parsed = parseResearchRows(rows);
    // En la planilla cada fila lleva su ID (FX-001): sin ID se saltea (si no, se duplicaría en cada sincronización).
    const inputs = parsed.inputs.filter((i) => i.code);
    const issues = [...parsed.issues, ...parsed.inputs.filter((i) => !i.code).map((i) => ({ code: "(sin ID)", problem: `«${i.businessName}» no tiene ID en la planilla` }))];
    if (!inputs.length) throw new SheetAccessError(issues[0]?.problem ?? "La planilla no tiene filas.");
    return await importLeads(inputs, { source: "research", sourceDetail: label, trigger, actor, preIssues: issues });
  } catch (e) {
    const problem = (e instanceof Error ? e.message : "error").slice(0, 300);
    await sql()`insert into supply_sync_runs (source, trigger, actor_id, finished_at, ok, issues) values (${label}, ${trigger}, ${actor?.id ?? null}, now(), false, ${sql().json([{ code: "-", problem }] as never)})`;
    if (e instanceof SheetAccessError) return { error: problem };
    throw e;
  }
}

/**
 * Barrios cerrados de referencia (partido, localidad, barrio, lotes): ubican la demanda potencial por zona.
 * Idempotente por nombre del barrio.
 */
export async function importGatedCommunities(rows: string[][]) {
  return systemTx(async (tx) => {
    const ctx = await loadCtx(tx);
    const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
    const ix = (n: string) => header.findIndex((h) => h.startsWith(n));
    const [p, l, b, lots] = [ix("partido"), ix("localidad"), ix("barrio"), ix("lotes")];
    if (p < 0 || b < 0) throw invalid("Faltan las columnas Partido y Barrio.");
    let n = 0;
    for (const r of rows.slice(1)) {
      const name = (r[b] ?? "").trim();
      if (!name) continue;
      const partido = (r[p] ?? "").trim();
      const locality = (l >= 0 ? r[l] ?? "" : "").trim() || partido;
      const zone = locateBase(locality, ctx).zoneId ?? locateBase(partido, ctx).zoneId;
      const lotCount = Math.round(Number(String(r[lots] ?? "").replace(",", "."))) || null;
      await tx`insert into gated_community_refs (partido, locality, name, lots, zone_id) values (${partido}, ${locality}, ${name.slice(0, 200)}, ${lotCount}, ${zone})
        on conflict (name) do update set partido = excluded.partido, locality = excluded.locality, lots = excluded.lots, zone_id = excluded.zone_id`;
      n++;
    }
    return n;
  });
}

// ───────── Vínculo con las altas ─────────

/**
 * Al crearse un perfil profesional (web, campaña o WhatsApp): busca el candidato por código de invitación, teléfono o
 * email y lo vincula; si no hay, crea uno con el origen. Así las dos vías terminan en el mismo seguimiento.
 */
export async function attachLeadOnSignupTx(
  tx: Tx,
  p: { providerId: string; userId: string; ref?: string | null; source?: string | null; utm?: Record<string, string> },
) {
  const [info] = await tx<{ display_name: string; contact_phone: string | null; phone: string | null; whatsapp_phone: string | null; email: string | null }[]>`
    select p.display_name, p.contact_phone, u.phone, u.whatsapp_phone, case when u.email_placeholder then null else lower(u.email) end as email
    from providers p join users u on u.id = ${p.userId} where p.id = ${p.providerId}`;
  if (!info) return null;
  const keys = [info.contact_phone, info.whatsapp_phone, info.phone].map(phoneKey).filter((k): k is string => !!k);
  const code = isLeadCode(p.ref) ? p.ref!.toUpperCase() : null;
  const [lead] = await tx<{ id: string; code: string }[]>`
    select id, code from supply_leads where provider_id is null and (
      (${code}::text is not null and code = ${code})
      or (cardinality(${keys}::text[]) > 0 and phone_key = any(${keys}::text[]))
      or (${info.email}::text is not null and lower(email) = ${info.email}))
    order by (code = ${code ?? ""}) desc, created_at limit 1 for update`;
  const utm = p.utm ?? {};
  if (lead) {
    await tx`update supply_leads set provider_id = ${p.providerId}, user_id = ${p.userId}, stage = 'registered', registered_at = coalesce(registered_at, now()),
      utm = utm || ${tx.json(utm as never)} where id = ${lead.id}`;
    await tx`insert into supply_lead_events (lead_id, kind, detail) values (${lead.id}, 'link', ${tx.json({ providerId: p.providerId, by: code ? "código" : "teléfono o email", source: p.source ?? null } as never)})`;
    return lead.code;
  }
  const source = p.source === "whatsapp" ? "whatsapp" : utm.utm_source || /ads|meta|google|facebook|instagram/.test(p.source ?? "") ? "ads" : p.source?.startsWith("referido") ? "referral" : "organic";
  const [{ n }] = await tx<{ n: number }[]>`select nextval('supply_lead_al_seq')::int as n`;
  const newCode = `AL-${String(n).padStart(4, "0")}`;
  const [created] = await tx<{ id: string }[]>`
    insert into supply_leads (code, source, source_detail, business_name, phone_raw, phone_key, whatsapp_e164, email, provider_id, user_id, stage, registered_at, utm)
    values (${newCode}, ${source}, ${p.source ?? null}, ${info.display_name}, ${info.contact_phone ?? info.phone}, ${keys[0] ?? null}, ${keys[0] ? `549${keys[0]}` : null},
      ${info.email}, ${p.providerId}, ${p.userId}, 'registered', now(), ${tx.json(utm as never)})
    returning id`;
  await tx`insert into supply_lead_events (lead_id, kind, detail) values (${created.id}, 'link', ${tx.json({ providerId: p.providerId, by: "alta nueva", source: p.source ?? null } as never)})`;
  return newCode;
}

/**
 * Registrado → Verificado → Activo según el perfil real (identidad verificada; aprobado y aceptando trabajos), y
 * rubros / zona base del perfil. Idempotente: corre en el cron diario, al importar y al vincular.
 */
export async function refreshLeadStagesTx(tx: Tx) {
  const changed = await tx<{ id: string; from: string; to: string }[]>`
    with s as (
      select l.id, l.stage as from_stage,
        case when p.status = 'approved' and p.accepting_jobs then 'active' when p.identity_status = 'verified' then 'verified' else 'registered' end as to_stage
      from supply_leads l join providers p on p.id = l.provider_id)
    update supply_leads l set stage = s.to_stage,
      registered_at = coalesce(l.registered_at, now()),
      verified_at = case when s.to_stage in ('verified','active') then coalesce(l.verified_at, now()) else l.verified_at end,
      active_at = case when s.to_stage = 'active' then coalesce(l.active_at, now()) else l.active_at end
    from s where s.id = l.id and l.stage <> s.to_stage
    returning l.id, s.from_stage as from, s.to_stage as to`;
  for (const c of changed) await tx`insert into supply_lead_events (lead_id, kind, detail) values (${c.id}, 'stage', ${tx.json({ from: c.from, to: c.to, auto: true } as never)})`;
  // Rubros y zona base del perfil (lo que declaró el profesional manda sobre lo investigado). Solo si cambiaron.
  await tx`with p as (
      select l.id,
        coalesce((select array_agg(pc.category_id order by pc.is_primary desc, pc.category_id) from provider_categories pc where pc.provider_id = l.provider_id), l.category_ids) as cats,
        coalesce((select pc.category_id from provider_categories pc where pc.provider_id = l.provider_id and pc.is_primary), l.primary_category_id) as primary_id,
        coalesce(pr.base_zone_id, l.base_zone_id) as zone_id
      from supply_leads l join providers pr on pr.id = l.provider_id)
    update supply_leads l set category_ids = p.cats, primary_category_id = p.primary_id, base_zone_id = p.zone_id,
      base_region = coalesce((select z.region from zones z where z.id = p.zone_id), l.base_region)
    from p where p.id = l.id and (l.category_ids is distinct from p.cats or l.primary_category_id is distinct from p.primary_id or l.base_zone_id is distinct from p.zone_id)`;
  return changed.length;
}

export async function refreshLeadStages() {
  return systemTx((tx) => refreshLeadStagesTx(tx));
}

// ───────── Acciones del equipo comercial ─────────

const assertManage = (actor: Actor) => {
  if (!can(actor, "captacion", "manage")) throw forbidden();
};

async function lockLead(tx: Tx, id: string) {
  const [l] = await tx<{ id: string; stage: LeadStage; provider_id: string | null; do_not_contact: boolean; code: string }[]>`select id, stage, provider_id, do_not_contact, code from supply_leads where id = ${id} for update`;
  if (!l) throw notFound("Candidato inexistente.");
  return l;
}

/** Contacto hecho (WhatsApp, llamada, Instagram…): queda en el historial y pasa a "Contactado" si era candidato. */
export async function recordContact(actor: Actor, leadId: string, input: { channel: string; note?: string }) {
  assertManage(actor);
  return systemTx(async (tx) => {
    const l = await lockLead(tx, leadId);
    if (l.do_not_contact) throw invalid("Este candidato pidió que no lo contactemos.");
    await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${l.id}, 'contact', ${tx.json({ channel: input.channel.slice(0, 40), note: (input.note ?? "").slice(0, 500) } as never)}, ${actor.id})`;
    if (l.stage === "candidate") {
      await tx`update supply_leads set stage = 'contacted', contacted_at = now(), owner_id = coalesce(owner_id, ${actor.id}) where id = ${l.id}`;
      await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${l.id}, 'stage', ${tx.json({ from: "candidate", to: "contacted" } as never)}, ${actor.id})`;
    }
  });
}

/** Etapas comerciales (las de registro las define el perfil y no se tocan a mano). */
export async function setLeadStage(actor: Actor, leadId: string, stage: "candidate" | "contacted" | "interested" | "discarded", reason?: string) {
  assertManage(actor);
  return systemTx(async (tx) => {
    const l = await lockLead(tx, leadId);
    if (l.provider_id) throw invalid("Ya se registró: su etapa sale del perfil (registrado, verificado o activo).");
    if (stage === "discarded" && (reason ?? "").trim().length < 3) throw invalid("Contá por qué se descarta.");
    const ts = stage === "contacted" ? "contacted_at" : stage === "interested" ? "interested_at" : stage === "discarded" ? "discarded_at" : null;
    await tx`update supply_leads set stage = ${stage}, ${ts ? tx`${tx(ts)} = coalesce(${tx(ts)}, now()),` : tx``}
      discard_reason = ${stage === "discarded" ? (reason ?? "").trim().slice(0, 300) : null} where id = ${l.id}`;
    await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${l.id}, 'stage', ${tx.json({ from: l.stage, to: stage, reason: reason ?? null } as never)}, ${actor.id})`;
  });
}

export async function addLeadNote(actor: Actor, leadId: string, note: string) {
  assertManage(actor);
  const text = note.trim();
  if (text.length < 2) throw invalid("Escribí la nota.");
  return systemTx(async (tx) => {
    const l = await lockLead(tx, leadId);
    await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${l.id}, 'note', ${tx.json({ note: text.slice(0, 1000) } as never)}, ${actor.id})`;
  });
}

/** Pidió no ser contactado: queda marcado para siempre (derecho de supresión / oposición). */
export async function setDoNotContact(actor: Actor, leadId: string, reason: string) {
  assertManage(actor);
  return systemTx(async (tx) => {
    const l = await lockLead(tx, leadId);
    await tx`update supply_leads set do_not_contact = true, opt_out_at = now(), stage = case when provider_id is null then 'discarded' else stage end,
      discarded_at = case when provider_id is null then coalesce(discarded_at, now()) else discarded_at end,
      discard_reason = case when provider_id is null then 'Pidió no ser contactado' else discard_reason end where id = ${l.id}`;
    await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${l.id}, 'opt_out', ${tx.json({ reason: reason.slice(0, 300) } as never)}, ${actor.id})`;
    await audit(tx, actor, "supply.opt_out", "supply_lead", l.id, reason.slice(0, 300));
  });
}

export async function assignLeadOwner(actor: Actor, leadId: string, ownerId: string | null) {
  assertManage(actor);
  return systemTx(async (tx) => {
    const l = await lockLead(tx, leadId);
    if (ownerId) {
      const [ok] = await tx`select 1 from users where id = ${ownerId} and platform_role is not null and disabled_at is null`;
      if (!ok) throw invalid("Solo se puede asignar a alguien del equipo.");
    }
    await tx`update supply_leads set owner_id = ${ownerId} where id = ${l.id}`;
    await tx`insert into supply_lead_events (lead_id, kind, detail, actor_id) values (${l.id}, 'assign', ${tx.json({ ownerId } as never)}, ${actor.id})`;
  });
}

export const manualLeadSchema = z.object({
  businessName: z.string().trim().min(2, "Escribí el nombre.").max(200),
  trades: z.string().trim().min(2, "Escribí el oficio.").max(200),
  locality: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(60).optional().or(z.literal("")),
  email: z.string().trim().max(200).optional().or(z.literal("")),
  website: z.string().trim().max(500).optional().or(z.literal("")),
  sourceDetail: z.string().trim().max(200).optional().or(z.literal("")),
});

/** Carga manual de un candidato (por ejemplo, uno que recomendó un ferretero). */
export async function createManualLead(actor: Actor, input: z.input<typeof manualLeadSchema>) {
  assertManage(actor);
  const d = manualLeadSchema.parse(input);
  const [{ n }] = await sql()<{ n: number }[]>`select nextval('supply_lead_al_seq')::int as n`;
  const code = `AL-${String(n).padStart(4, "0")}`;
  const r = await importLeads([{ code, businessName: d.businessName, trades: d.trades, locality: d.locality ?? "", phone: d.phone ?? "", email: d.email ?? "", website: d.website ?? "", raw: {} }],
    { source: "manual", sourceDetail: d.sourceDetail || "Carga manual", trigger: "manual", actor });
  if (!r.inserted) throw invalid(r.issues[0]?.problem ?? "No se pudo cargar.");
  return code;
}

/** Gasto mensual en captación por canal (para costo por registrado / activo). */
export async function setMarketingSpend(actor: Actor, input: { channel: string; month: string; amountMinor: number; note?: string }) {
  assertManage(actor);
  const channel = input.channel.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40);
  if (!/^[a-z0-9-]{2,40}$/.test(channel)) throw invalid("Elegí el canal.");
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw invalid("Elegí el mes.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 0) throw invalid("Importe inválido.");
  return systemTx(async (tx) => {
    await tx`insert into marketing_spend (channel, month, amount_minor, note, created_by) values (${channel}, ${`${input.month}-01`}, ${input.amountMinor}, ${input.note ?? null}, ${actor.id})
      on conflict (channel, month) do update set amount_minor = excluded.amount_minor, note = excluded.note, created_by = excluded.created_by`;
    await audit(tx, actor, "supply.spend", "marketing_spend", null, `${channel} ${input.month}`, { amountMinor: input.amountMinor });
  });
}

/** Texto de invitación para el primer contacto humano (desde un WhatsApp comercial, no desde el bot). */
export function invitationText(lead: { code: string; business_name: string; contact_name: string | null }) {
  const base = env().APP_URL.replace(/\/$/, "");
  const first = (lead.contact_name || lead.business_name).split(/[\s—-]+/)[0];
  return `Hola ${first}! Te escribo de Fixy, una plataforma que conecta a gente que necesita arreglos con profesionales de su zona. ` +
    `Te llegan pedidos de trabajo, vos elegís cuáles tomar y cobrás seguro. Sumarte es gratis y Fixy no te cobra comisión.\n\n` +
    `Para anotarte tocá este link y mandá el mensaje que ya aparece escrito (son 3 preguntas por WhatsApp):\n${base}/alta?ref=${lead.code.toLowerCase()}\n\n` +
    `Si preferís la web: ${base}/sumate/registrarme?origen=research&ref=${lead.code.toLowerCase()}`;
}
