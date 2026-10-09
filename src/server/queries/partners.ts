/**
 * Panel de socios: evolución del negocio, embudo, oferta, calidad, canales y dinero.
 * Datos agregados de toda la plataforma (acceso: sección "socios"). Los importes de modo de prueba se informan aparte.
 */
import "server-only";
import { sql } from "@/server/db/client";

const TZ = "America/Argentina/Buenos_Aires";

export type Kpi = { current: number; previous: number };
export type WeekPoint = { week: string; value: number };

export async function getPartnerDashboard(days: number) {
  const db = sql();
  const now = new Date();
  const since = new Date(now.getTime() - days * 86400_000);
  const prevSince = new Date(since.getTime() - days * 86400_000);

  // ── KPIs del período vs. el anterior ──
  const kpi = async (q: (from: Date, to: Date) => Promise<number>): Promise<Kpi> => ({ current: await q(since, now), previous: await q(prevSince, since) });
  const one = async (p: Promise<{ v: number }[]>) => Number((await p)[0]?.v ?? 0);
  const [requests, jobsDone, gmv, revenue, newClients, newPros] = await Promise.all([
    kpi((a, b) => one(db`select count(*)::int as v from service_requests where status <> 'draft' and created_at >= ${a} and created_at < ${b}`)),
    kpi((a, b) => one(db`select count(*)::int as v from jobs where status = 'completed' and completed_at >= ${a} and completed_at < ${b}`)),
    kpi((a, b) => one(db`select coalesce(sum(j.total_minor + coalesce((select sum(e.total_minor) from job_extras e where e.job_id = j.id and e.status = 'accepted'), 0)), 0)::bigint as v
      from jobs j where j.status <> 'cancelled' and j.created_at >= ${a} and j.created_at < ${b}`)),
    kpi((a, b) => one(db`select coalesce(-sum(amount_minor), 0)::bigint as v from ledger_entries where account = 'platform_revenue' and created_at >= ${a} and created_at < ${b}`)),
    kpi((a, b) => one(db`select count(*)::int as v from users u where u.platform_role is null and not u.is_demo and u.created_at >= ${a} and u.created_at < ${b}
      and not exists (select 1 from provider_members m where m.user_id = u.id)`)),
    kpi((a, b) => one(db`select count(*)::int as v from providers where approved_at >= ${a} and approved_at < ${b}`)),
  ]);

  // ── Series semanales (12 semanas) ──
  const weeks = 12;
  const series = async (q: ReturnType<typeof db>) => (await q) as unknown as WeekPoint[];
  const weekGrid = db`select generate_series(date_trunc('week', (now() at time zone ${TZ})) - interval '11 weeks', date_trunc('week', (now() at time zone ${TZ})), interval '1 week') as w`;
  const [sRequests, sJobs, sGmv, sRevenue] = await Promise.all([
    series(db`with g as (${weekGrid}) select to_char(g.w, 'DD/MM') as week, (select count(*) from service_requests r where r.status <> 'draft'
      and date_trunc('week', r.created_at at time zone ${TZ}) = g.w)::int as value from g order by g.w`),
    series(db`with g as (${weekGrid}) select to_char(g.w, 'DD/MM') as week, (select count(*) from jobs j where j.status = 'completed'
      and date_trunc('week', j.completed_at at time zone ${TZ}) = g.w)::int as value from g order by g.w`),
    series(db`with g as (${weekGrid}) select to_char(g.w, 'DD/MM') as week, (select coalesce(sum(j.total_minor), 0) from jobs j where j.status <> 'cancelled'
      and date_trunc('week', j.created_at at time zone ${TZ}) = g.w)::bigint as value from g order by g.w`),
    series(db`with g as (${weekGrid}) select to_char(g.w, 'DD/MM') as week, (select coalesce(-sum(l.amount_minor), 0) from ledger_entries l where l.account = 'platform_revenue'
      and date_trunc('week', l.created_at at time zone ${TZ}) = g.w)::bigint as value from g order by g.w`),
  ]);

  // ── Embudo de los pedidos del período ──
  const [funnel] = await db<{ sent: number; invited: number; answered: number; hired: number; confirmed: number; completed: number; reviewed: number }[]>`
    with r as (select id from service_requests where status <> 'draft' and created_at >= ${since})
    select count(*)::int as sent,
      count(*) filter (where exists (select 1 from request_invitations i where i.request_id = r.id))::int as invited,
      count(*) filter (where exists (select 1 from quotes q where q.request_id = r.id and q.sent_at is not null))::int as answered,
      count(*) filter (where exists (select 1 from jobs j where j.request_id = r.id))::int as hired,
      count(*) filter (where exists (select 1 from jobs j where j.request_id = r.id and j.status not in ('pending_confirmation','cancelled')))::int as confirmed,
      count(*) filter (where exists (select 1 from jobs j where j.request_id = r.id and j.status = 'completed'))::int as completed,
      count(*) filter (where exists (select 1 from jobs j join reviews v on v.job_id = j.id where j.request_id = r.id))::int as reviewed
    from r`;

  // ── Oferta de profesionales ──
  const providersByStatus = await db<{ status: string; n: number }[]>`select status, count(*)::int as n from providers where not is_demo group by status`;
  const [supply] = await db<{ active: number; median_approval_hours: number | null }[]>`
    select (select count(*) from providers where status = 'approved' and identity_status = 'verified' and accepting_jobs)::int as active,
      (select percentile_cont(0.5) within group (order by extract(epoch from (approved_at - submitted_at)) / 3600.0)
        from providers where approved_at is not null and submitted_at is not null and approved_at >= ${since}) as median_approval_hours`;
  const byCategory = await db<{ name: string; providers: number; requests: number }[]>`
    select c.name,
      (select count(*) from provider_categories pc join providers p on p.id = pc.provider_id where pc.category_id = c.id and p.status = 'approved' and p.accepting_jobs)::int as providers,
      (select count(*) from service_requests r where r.category_id = c.id and r.status <> 'draft' and r.created_at >= ${since})::int as requests
    from categories c where c.active order by requests desc, c.sort limit 12`;
  const zonesGap = await db<{ name: string; requests: number; providers: number }[]>`
    select z.name,
      (select count(*) from service_requests r join properties p on p.id = r.property_id where p.zone_id = z.id and r.status <> 'draft' and r.created_at >= ${since})::int as requests,
      (select count(*) from provider_zones pz join providers p on p.id = pz.provider_id where pz.zone_id = z.id and p.status = 'approved' and p.accepting_jobs)::int as providers
    from zones z where z.active order by requests desc limit 10`;

  // ── Calidad ──
  const [quality] = await db<{ avg_rating: number | null; reviews: number; disputes: number; completed: number; review_disputes: number; refunds: number; refunds_minor: number; cancelled: number; jobs: number }[]>`
    select (select avg(rating)::float from reviews where hidden_at is null and created_at >= ${since}) as avg_rating,
      (select count(*) from reviews where created_at >= ${since})::int as reviews,
      (select count(*) from disputes where created_at >= ${since})::int as disputes,
      (select count(*) from jobs where status = 'completed' and completed_at >= ${since})::int as completed,
      (select count(*) from review_disputes where created_at >= ${since})::int as review_disputes,
      (select count(*) from refunds where created_at >= ${since})::int as refunds,
      (select coalesce(sum(amount_minor), 0) from refunds where created_at >= ${since})::bigint as refunds_minor,
      (select count(*) from jobs where status = 'cancelled' and created_at >= ${since})::int as cancelled,
      (select count(*) from jobs where created_at >= ${since})::int as jobs`;

  // ── Canales ──
  const byChannel = await db<{ channel: string; n: number }[]>`select channel, count(*)::int as n from service_requests where status <> 'draft' and created_at >= ${since} group by channel`;
  const [wa] = await db<{ conversations: number; linked: number }[]>`
    select (select count(*) from whatsapp_conversations where created_at >= ${since})::int as conversations,
      (select count(*) from users where whatsapp_phone is not null)::int as linked`;
  const providerSources = await db<{ source: string; n: number }[]>`
    select coalesce(signup_source, 'directo') as source, count(*)::int as n from providers where not is_demo and created_at >= ${since} group by 1 order by 2 desc limit 8`;

  // ── Dinero ──
  const [money] = await db<{ charged: number; refunded: number; test_charged: number; available: number; waiting: number; in_transit: number; withdrawn: number }[]>`
    select (select coalesce(sum(amount_minor), 0) from charges where status in ('approved','partially_refunded','refunded') and not is_test and approved_at >= ${since})::bigint as charged,
      (select coalesce(sum(r.amount_minor), 0) from refunds r join charges c on c.id = r.charge_id where not c.is_test and r.created_at >= ${since})::bigint as refunded,
      (select coalesce(sum(amount_minor), 0) from charges where status in ('approved','partially_refunded','refunded') and is_test and approved_at >= ${since})::bigint as test_charged,
      (select coalesce(sum(po.amount_minor), 0) from payouts po join jobs j on j.id = po.job_id where po.status = 'pending' and po.withdrawal_id is null and not po.on_hold and not po.awaiting_review and j.status = 'completed')::bigint as available,
      (select coalesce(sum(amount_minor), 0) from payouts where status = 'pending' and withdrawal_id is null and (awaiting_review or on_hold))::bigint as waiting,
      (select coalesce(sum(amount_minor), 0) from withdrawals where status = 'requested')::bigint as in_transit,
      (select coalesce(sum(amount_minor), 0) from withdrawals where status = 'paid' and paid_at >= ${since})::bigint as withdrawn`;

  return {
    days, weeks,
    kpis: { requests, jobsDone, gmv, revenue, newClients, newPros },
    series: { requests: sRequests, jobs: sJobs, gmv: sGmv, revenue: sRevenue },
    funnel,
    supply: { ...supply, providersByStatus, byCategory, zonesGap },
    quality,
    channels: { byChannel, whatsapp: wa, providerSources },
    money,
  };
}

export type PartnerDashboard = Awaited<ReturnType<typeof getPartnerDashboard>>;
