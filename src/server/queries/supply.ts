/**
 * Lecturas del CRM de captación (/admin/captacion). Las tablas supply_* no tienen políticas para fixy_app: las lee
 * el servidor después de requireSection("captacion").
 */
import "server-only";
import { sql } from "@/server/db/client";
import { LEAD_STAGES, type LeadStage } from "@/server/modules/supply";

export type LeadFilters = { stage?: LeadStage; source?: string; category?: string; region?: string; q?: string; owner?: string; page?: number };
const PAGE = 50;

export async function supplyFunnel() {
  const rows = await sql()<{ stage: LeadStage; n: number }[]>`select stage, count(*)::int as n from supply_leads group by stage`;
  const by = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<LeadStage, number>;
  for (const r of rows) by[r.stage] = r.n;
  const [extra] = await sql()<{ total: number; dnc: number; no_phone: number; new7: number; registered30: number }[]>`
    select count(*)::int as total, count(*) filter (where do_not_contact)::int as dnc, count(*) filter (where phone_key is null)::int as no_phone,
      count(*) filter (where created_at > now() - interval '7 days')::int as new7,
      count(*) filter (where registered_at > now() - interval '30 days')::int as registered30
    from supply_leads`;
  return { by, ...extra };
}

export type LeadRow = {
  id: string; code: string; source: string; source_detail: string | null; business_name: string; contact_name: string | null; phone_raw: string | null;
  whatsapp_e164: string | null; email: string | null; trades_raw: string | null; categories: string[]; base_locality: string | null; zone: string | null;
  base_region: string | null; stage: LeadStage; do_not_contact: boolean; owner: string | null; provider_id: string | null; created_at: Date; last_event_at: Date | null;
};

export async function listLeads(f: LeadFilters) {
  const db = sql();
  const page = Math.max(1, f.page ?? 1);
  const q = f.q?.trim() ? `%${f.q.trim().toLowerCase()}%` : null;
  const digits = f.q?.replace(/\D/g, "") ?? "";
  const rows = await db<LeadRow[]>`
    select l.id, l.code, l.source, l.source_detail, l.business_name, l.contact_name, l.phone_raw, l.whatsapp_e164, l.email, l.trades_raw,
      coalesce((select array_agg(c.name order by c.id = l.primary_category_id desc, c.sort) from categories c where c.id = any(l.category_ids)), '{}') as categories,
      l.base_locality, z.name as zone, l.base_region, l.stage, l.do_not_contact, u.full_name as owner, l.provider_id, l.created_at,
      (select max(e.created_at) from supply_lead_events e where e.lead_id = l.id and e.kind in ('contact','note','stage')) as last_event_at
    from supply_leads l left join zones z on z.id = l.base_zone_id left join users u on u.id = l.owner_id
    where true
      ${f.stage ? db`and l.stage = ${f.stage}` : db``}
      ${f.source ? db`and l.source = ${f.source}` : db``}
      ${f.category ? db`and exists (select 1 from categories c where c.slug = ${f.category} and c.id = any(l.category_ids))` : db``}
      ${f.region ? db`and l.base_region = ${f.region}` : db``}
      ${f.owner === "none" ? db`and l.owner_id is null` : f.owner ? db`and l.owner_id = ${f.owner}` : db``}
      ${q ? db`and (lower(l.business_name) like ${q} or lower(l.code) like ${q} or lower(coalesce(l.base_locality,'')) like ${q}
        or lower(coalesce(l.email,'')) like ${q} ${digits.length >= 6 ? db`or l.phone_key like ${`%${digits.slice(-8)}%`}` : db``})` : db``}
    order by case l.stage when 'interested' then 0 when 'contacted' then 1 when 'candidate' then 2 when 'registered' then 3 when 'verified' then 4 when 'active' then 5 else 6 end,
      l.code
    limit ${PAGE + 1} offset ${(page - 1) * PAGE}`;
  return { rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE, page };
}

export async function leadDetail(id: string) {
  const db = sql();
  const [lead] = await db<(LeadRow & {
    phone_key: string | null; website: string | null; source_url: string | null; research_data: Record<string, string>; utm: Record<string, string>;
    owner_id: string | null; notes: string | null; discard_reason: string | null; provider_name: string | null; provider_status: string | null;
    contacted_at: Date | null; interested_at: Date | null; registered_at: Date | null; verified_at: Date | null; active_at: Date | null; synced_at: Date | null; opt_out_at: Date | null;
  })[]>`
    select l.*, z.name as zone, u.full_name as owner, p.display_name as provider_name, p.status as provider_status,
      coalesce((select array_agg(c.name order by c.id = l.primary_category_id desc, c.sort) from categories c where c.id = any(l.category_ids)), '{}') as categories,
      null::timestamptz as last_event_at
    from supply_leads l left join zones z on z.id = l.base_zone_id left join users u on u.id = l.owner_id left join providers p on p.id = l.provider_id
    where l.id = ${id}`;
  if (!lead) return null;
  const events = await db<{ id: number; kind: string; detail: Record<string, unknown>; created_at: Date; actor_name: string | null; actor_role: string | null }[]>`
    select e.id, e.kind, e.detail, e.created_at, u.full_name as actor_name, u.platform_role as actor_role
    from supply_lead_events e left join users u on u.id = e.actor_id where e.lead_id = ${id} order by e.created_at desc, e.id desc limit 200`;
  return { lead, events };
}

/** Personas del equipo que pueden tener candidatos asignados. */
export async function supplyOwners() {
  return sql()<{ id: string; full_name: string }[]>`select id, full_name from users where platform_role is not null and disabled_at is null order by full_name`;
}

export async function leadFacets() {
  const db = sql();
  const [categories, sources, regions] = await Promise.all([
    db<{ slug: string; name: string }[]>`select c.slug, c.name from categories c where exists (select 1 from supply_leads l where c.id = any(l.category_ids)) order by c.sort, c.name`,
    db<{ source: string }[]>`select distinct source from supply_leads order by source`,
    db<{ region: string }[]>`select distinct base_region as region from supply_leads where base_region is not null order by 1`,
  ]);
  return { categories, sources: sources.map((s) => s.source), regions: regions.map((r) => r.region) };
}

// ───────── Métricas ─────────

/** Por oficio: candidatos, registrados, profesionales activos y pedidos de clientes (30 días). Los de menos oferta, arriba. */
export async function supplyByTrade() {
  return sql()<{ slug: string; name: string; leads: number; contacted: number; registered: number; active_providers: number; demand30d: number; ratio: number | null }[]>`
    with leads as (
      select unnest(category_ids) as category_id, stage from supply_leads
    ), act as (
      select pc.category_id, count(distinct p.id)::int as n from provider_categories pc join providers p on p.id = pc.provider_id
      where p.status = 'approved' and p.accepting_jobs and not p.is_demo group by pc.category_id
    ), dem as (
      select category_id, count(*)::int as n from service_requests where status <> 'draft' and created_at > now() - interval '30 days' group by category_id
    )
    select c.slug, c.name,
      count(l.*)::int as leads,
      count(l.*) filter (where l.stage in ('contacted','interested'))::int as contacted,
      count(l.*) filter (where l.stage in ('registered','verified','active'))::int as registered,
      coalesce(max(act.n), 0) as active_providers, coalesce(max(dem.n), 0) as demand30d,
      case when coalesce(max(act.n), 0) = 0 then null else round(coalesce(max(dem.n), 0)::numeric / max(act.n), 1)::float end as ratio
    from categories c left join leads l on l.category_id = c.id left join act on act.category_id = c.id left join dem on dem.category_id = c.id
    where c.active and c.slug <> 'otro'
    group by c.id, c.slug, c.name, c.sort
    having count(l.*) > 0 or coalesce(max(act.n), 0) > 0 or coalesce(max(dem.n), 0) > 0
    order by coalesce(max(act.n), 0) asc, coalesce(max(dem.n), 0) desc, c.sort`;
}

/** Por localidad base (no es la zona de cobertura: es dónde está el profesional). */
export async function supplyByLocality(limit = 40) {
  return sql()<{ locality: string; zone: string | null; region: string | null; leads: number; registered: number }[]>`
    select coalesce(z.name, l.base_locality, 'Sin localidad') as locality, max(z.name) as zone, max(l.base_region) as region, count(*)::int as leads,
      count(*) filter (where l.stage in ('registered','verified','active'))::int as registered
    from supply_leads l left join zones z on z.id = l.base_zone_id
    group by 1 order by leads desc, locality limit ${limit}`;
}

/** Cobertura real: profesionales activos que cubren cada zona (sus zonas de trabajo, no su base). */
export async function coverageByZone() {
  return sql()<{ zone: string; region: string; providers: number; leads_based: number; gated: number; gated_lots: number }[]>`
    select z.name as zone, z.region,
      (select count(distinct pz.provider_id)::int from provider_zones pz join providers p on p.id = pz.provider_id
        where pz.zone_id = z.id and p.status = 'approved' and p.accepting_jobs and not p.is_demo) as providers,
      (select count(*)::int from supply_leads l where l.base_zone_id = z.id and l.stage not in ('discarded')) as leads_based,
      (select count(*)::int from gated_community_refs g where g.zone_id = z.id) as gated,
      (select coalesce(sum(g.lots), 0)::int from gated_community_refs g where g.zone_id = z.id) as gated_lots
    from zones z where z.active and not z.catch_all
    order by providers asc, gated_lots desc, z.sort limit 60`;
}

/**
 * Por canal: candidatos, registrados, activos, gasto y costo. El canal es la fuente de la campaña (utm_source: "meta",
 * "google"…) o, sin campaña, el origen del candidato ("research", "whatsapp"…). El gasto se carga con ese mismo nombre.
 */
export async function supplyByChannel() {
  return sql()<{ channel: string; leads: number; registered: number; active: number; spend_minor: number }[]>`
    with ch as (
      select lower(coalesce(nullif(l.utm->>'utm_source', ''), l.source)) as channel, l.stage from supply_leads l
    ), spend as (select channel, sum(amount_minor)::float as s from marketing_spend group by channel)
    select ch.channel, count(*)::int as leads,
      count(*) filter (where ch.stage in ('registered','verified','active'))::int as registered,
      count(*) filter (where ch.stage = 'active')::int as active,
      coalesce(max(spend.s), 0)::float as spend_minor
    from ch left join spend on spend.channel = ch.channel group by ch.channel order by leads desc`;
}

/** Altas por semana (últimas 12): candidatos nuevos y profesionales registrados. */
export async function supplyWeekly() {
  return sql()<{ week: Date; new_leads: number; registered: number }[]>`
    with w as (select generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as week)
    select w.week,
      (select count(*)::int from supply_leads l where l.created_at >= w.week and l.created_at < w.week + interval '1 week' and l.source <> 'research') as new_leads,
      (select count(*)::int from supply_leads l where l.registered_at >= w.week and l.registered_at < w.week + interval '1 week') as registered
    from w order by w.week`;
}

export async function supplySpend() {
  return sql()<{ channel: string; month: Date; amount_minor: number; note: string | null }[]>`
    select channel, month, amount_minor::float as amount_minor, note from marketing_spend order by month desc, channel limit 36`;
}

export async function supplySyncRuns(limit = 10) {
  return sql()<{ id: string; source: string; trigger: string; started_at: Date; finished_at: Date | null; ok: boolean | null; inserted: number; updated: number; unchanged: number; skipped: number; issues: { code: string; problem: string }[]; actor: string | null }[]>`
    select r.id, r.source, r.trigger, r.started_at, r.finished_at, r.ok, r.inserted, r.updated, r.unchanged, r.skipped, r.issues, u.full_name as actor
    from supply_sync_runs r left join users u on u.id = r.actor_id order by r.started_at desc limit ${limit}`;
}
