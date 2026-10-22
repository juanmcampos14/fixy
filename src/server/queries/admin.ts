/**
 * Consultas de lectura del panel de operación. Corren con asUser(): el rol fixy_app + RLS
 * deja ver todo a operación (app.is_staff), y nada a cualquier otro usuario.
 */
import "server-only";
import { asUser, sql, type Tx } from "@/server/db/client";
import { signedFileUrl, publicFileUrl } from "@/server/storage";
import { timeline, type TimelineEvent } from "./shared";
import { providerEligibility, onboardingChecklist } from "@/server/modules/providers";

// ───────────────────────── Resumen ─────────────────────────

export const PERIODS = [
  { key: "7", label: "7 días", days: 7 },
  { key: "30", label: "30 días", days: 30 },
  { key: "90", label: "90 días", days: 90 },
  { key: "todo", label: "Todo", days: null },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export function parsePeriod(v: string | undefined): (typeof PERIODS)[number] {
  return PERIODS.find((p) => p.key === v) ?? PERIODS[1];
}

export type Overview = {
  requestsCreated: number;
  requestsConverted: number;
  unquoted: number;
  unquotedOver24h: number;
  firstQuoteMedianHours: number | null;
  firstQuoteAvgHours: number | null;
  firstQuoteSample: number;
  jobsCompleted: number;
  jobsCancelled: number;
  requestsCancelled: number;
  disputesOpen: number;
  disputesTotal: number;
  contractedMinor: number;
  contractedJobs: number;
  chargedGrossMinor: number;
  refundedMinor: number;
  platformRevenueMinor: number;
  taxesMinor: number;
  payoutsPendingMinor: number;
  payoutsPendingCount: number;
  payoutsOnHold: number;
  chargesTotal: number;
  chargesTest: number;
};

export async function getOverview(userId: string, days: number | null): Promise<Overview> {
  const since = days ? new Date(Date.now() - days * 86400_000) : null;
  return asUser(userId, async (tx) => {
    const [r] = await tx<Overview[]>`
      with req as (
        select r.id, r.status, r.submitted_at, r.created_at,
          (select min(q.sent_at) from quotes q where q.request_id = r.id and q.sent_at is not null) as first_quote_at
        from service_requests r
        where r.status <> 'draft' and (${since}::timestamptz is null or r.created_at >= ${since}::timestamptz)
      ),
      fq as (
        select extract(epoch from (first_quote_at - submitted_at)) / 3600.0 as h
        from req where first_quote_at is not null and submitted_at is not null
      ),
      unq as (
        select r.submitted_at from service_requests r
        where r.status in ('submitted','searching','no_coverage')
          and not exists (select 1 from quotes q where q.request_id = r.id and q.sent_at is not null)
      ),
      extras as (
        select e.job_id, sum(e.total_minor)::bigint as total from job_extras e where e.status = 'accepted' group by e.job_id
      )
      select
        (select count(*)::int from req) as "requestsCreated",
        (select count(*)::int from req where exists (select 1 from jobs j where j.request_id = req.id)) as "requestsConverted",
        (select count(*)::int from unq) as "unquoted",
        (select count(*)::int from unq where submitted_at < now() - interval '24 hours') as "unquotedOver24h",
        (select percentile_cont(0.5) within group (order by h) from fq)::float8 as "firstQuoteMedianHours",
        (select avg(h) from fq)::float8 as "firstQuoteAvgHours",
        (select count(*)::int from fq) as "firstQuoteSample",
        (select count(*)::int from jobs where status = 'completed' and (${since}::timestamptz is null or completed_at >= ${since}::timestamptz)) as "jobsCompleted",
        (select count(*)::int from jobs where status = 'cancelled' and (${since}::timestamptz is null or cancelled_at >= ${since}::timestamptz)) as "jobsCancelled",
        (select count(*)::int from entity_events where entity_type = 'request' and to_state = 'cancelled'
           and (${since}::timestamptz is null or created_at >= ${since}::timestamptz)) as "requestsCancelled",
        (select count(*)::int from disputes where status in ('open','in_review','awaiting_response')) as "disputesOpen",
        (select count(*)::int from disputes where ${since}::timestamptz is null or created_at >= ${since}::timestamptz) as "disputesTotal",
        (select coalesce(sum(j.total_minor + coalesce(x.total, 0)), 0)::bigint from jobs j left join extras x on x.job_id = j.id
           where j.status <> 'cancelled' and (${since}::timestamptz is null or j.created_at >= ${since}::timestamptz)) as "contractedMinor",
        (select count(*)::int from jobs j where j.status <> 'cancelled' and (${since}::timestamptz is null or j.created_at >= ${since}::timestamptz)) as "contractedJobs",
        (select coalesce(sum(amount_minor), 0)::bigint from charges where status in ('approved','partially_refunded','refunded')
           and (${since}::timestamptz is null or approved_at >= ${since}::timestamptz)) as "chargedGrossMinor",
        (select coalesce(sum(amount_minor), 0)::bigint from refunds where status = 'approved'
           and (${since}::timestamptz is null or coalesce(processed_at, created_at) >= ${since}::timestamptz)) as "refundedMinor",
        (select coalesce(-sum(amount_minor), 0)::bigint from ledger_entries where account = 'platform_revenue'
           and (${since}::timestamptz is null or created_at >= ${since}::timestamptz)) as "platformRevenueMinor",
        (select coalesce(-sum(amount_minor), 0)::bigint from ledger_entries where account = 'taxes_payable'
           and (${since}::timestamptz is null or created_at >= ${since}::timestamptz)) as "taxesMinor",
        (select coalesce(sum(amount_minor), 0)::bigint from payouts where status in ('pending','scheduled')) as "payoutsPendingMinor",
        (select count(*)::int from payouts where status in ('pending','scheduled')) as "payoutsPendingCount",
        (select count(*)::int from payouts where on_hold and status in ('pending','scheduled','failed')) as "payoutsOnHold",
        (select count(*)::int from charges where ${since}::timestamptz is null or created_at >= ${since}::timestamptz) as "chargesTotal",
        (select count(*)::int from charges where is_test and (${since}::timestamptz is null or created_at >= ${since}::timestamptz)) as "chargesTest"`;
    return r;
  });
}

export type Attention = Awaited<ReturnType<typeof getAttention>>;

export async function getAttention(userId: string) {
  return asUser(userId, async (tx) => {
    const providers = await tx<{ id: string; display_name: string; submitted_at: Date | null; is_demo: boolean }[]>`
      select id, display_name, submitted_at, is_demo from providers where status = 'in_review' order by submitted_at nulls last limit 20`;
    const review = await tx<{ id: string; code: string; title: string; status: string; needs_review: boolean; review_reason: string | null; submitted_at: Date | null }[]>`
      select id, code, title, status, needs_review, review_reason, submitted_at from service_requests
      where status not in ('draft','cancelled','converted') and (needs_review or status = 'no_coverage')
      order by submitted_at nulls last limit 20`;
    const unanswered = await tx<{ id: string; code: string; title: string; status: string; submitted_at: Date | null; invitations: number }[]>`
      select r.id, r.code, r.title, r.status, r.submitted_at,
        (select count(*)::int from request_invitations i where i.request_id = r.id) as invitations
      from service_requests r
      where r.status in ('submitted','searching','no_coverage') and r.submitted_at < now() - interval '24 hours'
        and not exists (select 1 from quotes q where q.request_id = r.id and q.sent_at is not null)
      order by r.submitted_at limit 20`;
    const disputes = await tx<{ id: string; status: string; reason_code: string; created_at: Date; job_code: string }[]>`
      select d.id, d.status, d.reason_code, d.created_at, j.code as job_code from disputes d join jobs j on j.id = d.job_id
      where d.status in ('open','in_review','awaiting_response') order by d.created_at limit 20`;
    const holds = await tx<{ id: string; amount_minor: number; hold_reason: string | null; job_id: string; job_code: string; provider_name: string; is_test: boolean }[]>`
      select p.id, p.amount_minor, p.hold_reason, p.job_id, j.code as job_code, pr.display_name as provider_name, p.is_test
      from payouts p join jobs j on j.id = p.job_id join providers pr on pr.id = p.provider_id
      where p.on_hold and p.status in ('pending','scheduled','failed') order by p.created_at limit 20`;
    return { providers, review, unanswered, disputes, holds };
  });
}

export async function navCounts(userId: string) {
  return asUser(userId, async (tx) => {
    const [r] = await tx<{ providers: number; requests: number; disputes: number; reviewDisputes: number }[]>`
      select (select count(*)::int from providers where status = 'in_review') as providers,
        (select count(*)::int from review_disputes where status = 'escalated') as "reviewDisputes",
        (select count(*)::int from service_requests where status not in ('draft','cancelled','converted') and (needs_review or status = 'no_coverage')) as requests,
        (select count(*)::int from disputes where status in ('open','in_review','awaiting_response')) as disputes`;
    return r;
  });
}

// ───────────────────────── Proveedores ─────────────────────────

export async function listProviders(userId: string, f: { status?: string; q?: string }) {
  return asUser(userId, (tx) => tx<{
    id: string; display_name: string; legal_name: string | null; kind: string; status: string; identity_status: string; payouts_status: string;
    accepting_jobs: boolean; is_demo: boolean; created_at: Date; submitted_at: Date | null; categories: string[]; pending_docs: number;
  }[]>`
    select p.id, p.display_name, p.legal_name, p.kind, p.status, p.identity_status, p.payouts_status, p.accepting_jobs, p.is_demo, p.created_at, p.submitted_at,
      coalesce((select array_agg(c.name order by c.sort) from provider_categories pc join categories c on c.id = pc.category_id where pc.provider_id = p.id), '{}') as categories,
      (select count(*)::int from provider_documents d where d.provider_id = p.id and d.status = 'pending') as pending_docs
    from providers p
    where (${f.status ?? null}::text is null or p.status = ${f.status ?? null})
      and (${f.q ?? null}::text is null or p.display_name ilike ${"%" + (f.q ?? "") + "%"} or p.legal_name ilike ${"%" + (f.q ?? "") + "%"})
    order by case p.status when 'in_review' then 0 when 'pending' then 1 when 'suspended' then 2 else 3 end, p.created_at desc
    limit 200`);
}

export type ProviderAdminDetail = NonNullable<Awaited<ReturnType<typeof getProviderAdmin>>>;

export async function getProviderAdmin(userId: string, providerId: string) {
  return asUser(userId, async (tx) => {
    const [p] = await tx<{
      id: string; slug: string; kind: string; display_name: string; legal_name: string | null; tax_id: string | null; responsible_name: string;
      contact_email: string; contact_phone: string | null; description: string; years_experience: number | null; billing_info: string | null;
      accepting_jobs: boolean; max_active_jobs: number; base_zone_id: string | null; base_zone_name: string | null; status: string; identity_status: string;
      payouts_status: string; payout_provider: string | null; has_payout_account: boolean; review_note: string | null; submitted_at: Date | null;
      approved_at: Date | null; is_demo: boolean; created_at: Date;
    }[]>`
      select p.id, p.slug, p.kind, p.display_name, p.legal_name, p.tax_id, p.responsible_name, p.contact_email, p.contact_phone, p.description,
        p.years_experience, p.billing_info, p.accepting_jobs, p.max_active_jobs, p.base_zone_id, z.name as base_zone_name, p.status,
        p.identity_status, p.payouts_status, p.payout_provider, (p.payout_account_ref is not null) as has_payout_account, p.review_note,
        p.submitted_at, p.approved_at, p.is_demo, p.created_at
      from providers p left join zones z on z.id = p.base_zone_id where p.id = ${providerId}`;
    if (!p) return null;
    const members = await tx<{ user_id: string; full_name: string; role: string; active: boolean }[]>`
      select m.user_id, u.full_name, m.role, m.active from provider_members m join user_names u on u.id = m.user_id
      where m.provider_id = ${providerId} order by m.active desc, m.role, u.full_name`;
    const categories = await tx<{ id: string; name: string }[]>`
      select c.id, c.name from provider_categories pc join categories c on c.id = pc.category_id where pc.provider_id = ${providerId} order by c.sort, c.name`;
    const zones = await tx<{ id: string; name: string; region: string }[]>`
      select z.id, z.name, z.region from provider_zones pz join zones z on z.id = pz.zone_id where pz.provider_id = ${providerId} order by z.sort, z.name`;
    const availability = await tx<{ weekday: number; start_minute: number; end_minute: number }[]>`
      select weekday, start_minute, end_minute from provider_availability where provider_id = ${providerId} order by weekday, start_minute`;
    const portfolio = (await tx<{ id: string; caption: string; file_id: string }[]>`
      select id, caption, file_id from provider_portfolio where provider_id = ${providerId} order by created_at`).map((x) => ({ ...x, url: publicFileUrl(x.file_id) }));
    const documents = (await tx<{
      id: string; kind: string; credential_type_id: string | null; credential_name: string | null; file_id: string; file_name: string; mime_type: string;
      status: string; expires_on: string | null; review_note: string | null; reviewed_at: Date | null; reviewer: string | null; created_at: Date;
    }[]>`
      select d.id, d.kind, d.credential_type_id, ct.name as credential_name, d.file_id, f.original_name as file_name, f.mime_type, d.status, d.expires_on,
        d.review_note, d.reviewed_at, u.full_name as reviewer, d.created_at
      from provider_documents d join files f on f.id = d.file_id
      left join credential_types ct on ct.id = d.credential_type_id
      left join user_names u on u.id = d.reviewed_by
      where d.provider_id = ${providerId} order by d.created_at desc`).map((d) => ({ ...d, url: signedFileUrl(d.file_id, 900) }));
    const required = await tx<{ category_name: string; credential_type_id: string; credential_name: string; state: "valid" | "expired" | "pending" | "rejected" | "missing"; expires_on: string | null }[]>`
      select c.name as category_name, ct.id as credential_type_id, ct.name as credential_name,
        case
          when exists (select 1 from provider_documents d where d.provider_id = ${providerId} and d.credential_type_id = ct.id and d.status = 'approved' and (d.expires_on is null or d.expires_on >= current_date)) then 'valid'
          when exists (select 1 from provider_documents d where d.provider_id = ${providerId} and d.credential_type_id = ct.id and d.status = 'approved') then 'expired'
          when exists (select 1 from provider_documents d where d.provider_id = ${providerId} and d.credential_type_id = ct.id and d.status = 'pending') then 'pending'
          when exists (select 1 from provider_documents d where d.provider_id = ${providerId} and d.credential_type_id = ct.id and d.status = 'rejected') then 'rejected'
          else 'missing' end as state,
        (select max(d.expires_on) from provider_documents d where d.provider_id = ${providerId} and d.credential_type_id = ct.id and d.status = 'approved') as expires_on
      from provider_categories pc join categories c on c.id = pc.category_id
      join category_required_credentials rc on rc.category_id = c.id
      join credential_types ct on ct.id = rc.credential_type_id
      where pc.provider_id = ${providerId} order by c.name, ct.name`;
    const [stats] = await tx<{ active_jobs: number; completed_jobs: number; cancelled_jobs: number; reviews: number; rating: number | null; open_disputes: number }[]>`
      select
        (select count(*)::int from jobs where provider_id = ${providerId} and status in ('pending_confirmation','confirmed','on_the_way','in_progress','pending_approval')) as active_jobs,
        (select count(*)::int from jobs where provider_id = ${providerId} and status = 'completed') as completed_jobs,
        (select count(*)::int from jobs where provider_id = ${providerId} and status = 'cancelled') as cancelled_jobs,
        (select count(*)::int from reviews where provider_id = ${providerId} and hidden_at is null) as reviews,
        (select round(avg(rating)::numeric, 1)::float8 from reviews where provider_id = ${providerId} and hidden_at is null) as rating,
        (select count(*)::int from disputes d join jobs j on j.id = d.job_id where j.provider_id = ${providerId} and d.status in ('open','in_review','awaiting_response')) as open_disputes`;
    const recentJobs = await tx<{ id: string; code: string; status: string; total_minor: number; created_at: Date }[]>`
      select id, code, status, total_minor, created_at from jobs where provider_id = ${providerId} order by created_at desc limit 10`;
    const eligibility = await providerEligibility(tx, providerId);
    const checklist = await onboardingChecklist(tx, providerId);
    const events = await timeline(tx, "provider", providerId);
    const audits = await auditFor(tx, "provider", providerId);
    return { p, members, categories, zones, availability, portfolio, documents, required, stats, recentJobs, eligibility, checklist, events, audits };
  });
}

export type AuditRow = { id: number; action: string; reason: string | null; created_at: Date; actor_name: string | null; actor_role: string | null; data: Record<string, unknown> };

async function auditFor(tx: Tx, entityType: string, entityId: string): Promise<AuditRow[]> {
  return tx<AuditRow[]>`
    select a.id, a.action, a.reason, a.created_at, u.full_name as actor_name, a.actor_role, a.data
    from audit_log a left join user_names u on u.id = a.actor_id
    where a.entity_type = ${entityType} and a.entity_id = ${entityId} order by a.id desc limit 50`;
}

// ───────────────────────── Solicitudes ─────────────────────────

export async function listRequests(userId: string, f: { status?: string; review?: boolean; categoryId?: string; q?: string }) {
  const like = f.q ? `%${f.q}%` : null;
  return asUser(userId, (tx) => tx<{
    id: string; code: string; title: string; status: string; needs_review: boolean; review_reason: string | null; urgency: string; safety_flag: string | null;
    category_name: string | null; zone_name: string; client_name: string; submitted_at: Date | null; created_at: Date;
    invitations: number; quotes_sent: number; unanswered: boolean;
  }[]>`
    select r.id, r.code, r.title, r.status, r.needs_review, r.review_reason, r.urgency, r.safety_flag, c.name as category_name, z.name as zone_name,
      u.full_name as client_name, r.submitted_at, r.created_at,
      (select count(*)::int from request_invitations i where i.request_id = r.id) as invitations,
      (select count(*)::int from quotes q where q.request_id = r.id and q.sent_at is not null) as quotes_sent,
      (r.status in ('submitted','searching','no_coverage') and r.submitted_at < now() - interval '24 hours'
        and not exists (select 1 from quotes q where q.request_id = r.id and q.sent_at is not null)) as unanswered
    from service_requests r
    join properties p on p.id = r.property_id join zones z on z.id = p.zone_id
    left join categories c on c.id = r.category_id
    join user_names u on u.id = r.created_by
    where r.status <> 'draft'
      and (${f.status ?? null}::text is null or r.status = ${f.status ?? null})
      and (${f.review ? true : null}::boolean is null or r.needs_review or r.status = 'no_coverage')
      and (${f.categoryId ?? null}::uuid is null or r.category_id = ${f.categoryId ?? null})
      and (${like}::text is null or r.code ilike ${like} or r.title ilike ${like})
    order by (r.needs_review or r.status = 'no_coverage') and r.status not in ('cancelled','converted') desc, r.created_at desc
    limit 200`);
}

export async function getRequestAdmin(userId: string, requestId: string) {
  return asUser(userId, async (tx) => {
    const [r] = await tx<{
      id: string; code: string; title: string; description: string; answers: Record<string, unknown>; urgency: string; preferred_windows: string[];
      status: string; needs_review: boolean; review_reason: string | null; safety_flag: string | null; cancel_reason: string | null;
      assistant_source: string; submitted_at: Date | null; created_at: Date; category_id: string | null; category_name: string | null;
      category_requires_review: boolean | null; service_name: string | null; client_name: string; responsible_name: string | null;
      organization_name: string | null; target_provider_name: string | null; previous_job_id: string | null;
      property_label: string; property_kind: string; address_line: string; address_extra: string | null; zone_name: string; region: string;
      contact_name: string | null; contact_phone: string | null; access_notes: string | null;
    }[]>`
      select r.id, r.code, r.title, r.description, r.answers, r.urgency, r.preferred_windows, r.status, r.needs_review, r.review_reason, r.safety_flag,
        r.cancel_reason, r.assistant_source, r.submitted_at, r.created_at, r.category_id, c.name as category_name, c.requires_review as category_requires_review,
        s.name as service_name, u.full_name as client_name, ru.full_name as responsible_name, o.name as organization_name,
        tp.display_name as target_provider_name, r.previous_job_id,
        p.label as property_label, p.kind as property_kind, p.address_line, p.address_extra, z.name as zone_name, z.region,
        p.contact_name, p.contact_phone, p.access_notes
      from service_requests r
      join properties p on p.id = r.property_id join zones z on z.id = p.zone_id
      left join categories c on c.id = r.category_id
      left join services s on s.id = r.service_id
      join user_names u on u.id = r.created_by
      left join user_names ru on ru.id = r.responsible_user_id
      left join organizations o on o.id = r.organization_id
      left join providers tp on tp.id = r.target_provider_id
      where r.id = ${requestId}`;
    if (!r) return null;
    const [priv] = await tx<{ access_info: string | null }[]>`select access_info from request_private where request_id = ${requestId}`;
    const questions = r.category_id
      ? await tx<{ key: string; label: string }[]>`select key, label from service_questions where category_id = ${r.category_id}`
      : [];
    const photos = (await tx<{ file_id: string; original_name: string }[]>`
      select a.file_id, f.original_name from request_attachments a join files f on f.id = a.file_id where a.request_id = ${requestId}`).map((x) => ({
      ...x,
      url: signedFileUrl(x.file_id, 900),
    }));
    const invitations = await tx<{
      id: string; provider_id: string; provider_name: string; source: string; status: string; rank_position: number | null; rank_score: number | null;
      rank_reasons: string[]; decline_reason: string | null; created_at: Date; responded_at: Date | null; invited_by_name: string | null;
    }[]>`
      select i.id, i.provider_id, p.display_name as provider_name, i.source, i.status, i.rank_position, i.rank_score, i.rank_reasons, i.decline_reason,
        i.created_at, i.responded_at, u.full_name as invited_by_name
      from request_invitations i join providers p on p.id = i.provider_id left join user_names u on u.id = i.invited_by
      where i.request_id = ${requestId} order by i.created_at, i.rank_position nulls last`;
    const quotes = await tx<{
      id: string; provider_id: string; provider_name: string; mode: string; status: string; total_minor: number; subtotal_minor: number;
      client_fee_minor: number; provider_fee_minor: number; sent_at: Date | null; valid_until: Date; scope: string; provider_rate_bps: number; client_rate_bps: number;
    }[]>`
      select q.id, q.provider_id, p.display_name as provider_name, q.mode, q.status, q.total_minor, q.subtotal_minor, q.client_fee_minor, q.provider_fee_minor,
        q.sent_at, q.valid_until, q.scope, q.provider_rate_bps, q.client_rate_bps
      from quotes q join providers p on p.id = q.provider_id where q.request_id = ${requestId} order by q.sent_at nulls last, q.created_at`;
    const [job] = await tx<{ id: string; code: string; status: string }[]>`select id, code, status from jobs where request_id = ${requestId}`;
    const events = await timeline(tx, "request", requestId);
    const audits = await auditFor(tx, "request", requestId);
    return { r, accessInfo: priv?.access_info ?? null, questions, photos, invitations, quotes, job: job ?? null, events, audits };
  });
}

// ───────────────────────── Trabajos ─────────────────────────

export async function listJobs(userId: string, f: { status?: string; providerId?: string; q?: string }) {
  const like = f.q ? `%${f.q}%` : null;
  return asUser(userId, (tx) => tx<{
    id: string; code: string; title: string; status: string; total_minor: number; scheduled_date: string | null; created_at: Date;
    provider_id: string; provider_name: string; client_name: string; open_dispute: boolean; payout_status: string | null; payout_on_hold: boolean | null; has_test: boolean;
  }[]>`
    select j.id, j.code, r.title, j.status, j.total_minor, j.scheduled_date, j.created_at, j.provider_id, p.display_name as provider_name,
      u.full_name as client_name,
      exists (select 1 from disputes d where d.job_id = j.id and d.status in ('open','in_review','awaiting_response')) as open_dispute,
      po.status as payout_status, po.on_hold as payout_on_hold,
      exists (select 1 from charges c where c.job_id = j.id and c.is_test) as has_test
    from jobs j join service_requests r on r.id = j.request_id join providers p on p.id = j.provider_id join user_names u on u.id = j.client_user_id
    left join payouts po on po.job_id = j.id
    where (${f.status ?? null}::text is null or j.status = ${f.status ?? null})
      and (${f.providerId ?? null}::uuid is null or j.provider_id = ${f.providerId ?? null})
      and (${like}::text is null or j.code ilike ${like} or r.title ilike ${like})
    order by j.created_at desc limit 200`);
}

export async function providerOptions(userId: string) {
  return asUser(userId, (tx) => tx<{ id: string; display_name: string }[]>`select id, display_name from providers order by display_name`);
}

export async function categoryOptions(userId: string) {
  return asUser(userId, (tx) => tx<{ id: string; name: string; requires_review: boolean; active: boolean }[]>`
    select id, name, requires_review, active from categories order by sort, name`);
}

// ───────────────────────── Reclamos ─────────────────────────

export async function listDisputes(userId: string, f: { status?: string }) {
  return asUser(userId, (tx) => tx<{
    id: string; status: string; reason_code: string; opened_side: string; created_at: Date; updated_at: Date; resolution: string | null;
    job_id: string; job_code: string; job_status: string; provider_name: string; opened_by_name: string; payout_status: string | null; payout_on_hold: boolean | null;
  }[]>`
    select d.id, d.status, d.reason_code, d.opened_side, d.created_at, d.updated_at, d.resolution, j.id as job_id, j.code as job_code, j.status as job_status,
      p.display_name as provider_name, u.full_name as opened_by_name, po.status as payout_status, po.on_hold as payout_on_hold
    from disputes d join jobs j on j.id = d.job_id join providers p on p.id = j.provider_id join user_names u on u.id = d.opened_by
    left join payouts po on po.job_id = j.id
    where (${f.status ?? null}::text is null or d.status = ${f.status ?? null})
    order by case when d.status in ('open','in_review','awaiting_response') then 0 else 1 end, d.created_at desc limit 200`);
}

export async function getDisputeAdmin(userId: string, disputeId: string) {
  return asUser(userId, async (tx) => {
    const [d] = await tx<{
      id: string; job_id: string; status: string; reason_code: string; description: string; opened_side: string; opened_by_name: string;
      resolution: string | null; resolution_note: string | null; resolved_by_name: string | null; assigned_name: string | null;
      created_at: Date; resolved_at: Date | null;
    }[]>`
      select d.id, d.job_id, d.status, d.reason_code, d.description, d.opened_side, u.full_name as opened_by_name, d.resolution, d.resolution_note,
        rb.full_name as resolved_by_name, asg.full_name as assigned_name, d.created_at, d.resolved_at
      from disputes d join user_names u on u.id = d.opened_by left join user_names rb on rb.id = d.resolved_by left join user_names asg on asg.id = d.assigned_to
      where d.id = ${disputeId}`;
    if (!d) return null;
    const [job] = await tx<{ id: string; code: string; status: string; total_minor: number; title: string; provider_id: string; provider_name: string; client_name: string; completed_at: Date | null }[]>`
      select j.id, j.code, j.status, j.total_minor, r.title, j.provider_id, p.display_name as provider_name, u.full_name as client_name, j.completed_at
      from jobs j join service_requests r on r.id = j.request_id join providers p on p.id = j.provider_id join user_names u on u.id = j.client_user_id
      where j.id = ${d.job_id}`;
    const messages = (await tx<{ id: string; author_name: string; author_side: string; body: string; internal: boolean; file_id: string | null; file_name: string | null; created_at: Date }[]>`
      select m.id, u.full_name as author_name, m.author_side, m.body, m.internal, m.file_id, f.original_name as file_name, m.created_at
      from dispute_messages m join user_names u on u.id = m.author_id left join files f on f.id = m.file_id
      where m.dispute_id = ${disputeId} order by m.created_at`).map((m) => ({ ...m, file_url: m.file_id ? signedFileUrl(m.file_id, 900) : null }));
    const charges = await tx<{ id: string; kind: string; status: string; amount_minor: number; refunded_minor: number; is_test: boolean }[]>`
      select id, kind, status, amount_minor, refunded_minor, is_test from charges where job_id = ${d.job_id} order by created_at`;
    const refunds = await tx<{ id: string; amount_minor: number; reason: string; created_at: Date }[]>`
      select id, amount_minor, reason, created_at from refunds where dispute_id = ${disputeId} order by created_at`;
    const [payout] = await tx<{ id: string; status: string; amount_minor: number; on_hold: boolean; hold_reason: string | null; is_test: boolean }[]>`
      select id, status, amount_minor, on_hold, hold_reason, is_test from payouts where job_id = ${d.job_id} and kind = 'job'`;
    const events = await timeline(tx, "dispute", disputeId);
    const audits = await auditFor(tx, "dispute", disputeId);
    return { d, job, messages, charges, refunds, payout: payout ?? null, events, audits };
  });
}

// ───────────────────────── Finanzas ─────────────────────────

export async function listCharges(userId: string, status?: string) {
  return asUser(userId, (tx) => tx<{
    id: string; job_id: string; job_code: string; kind: string; status: string; gateway: string; is_test: boolean; amount_minor: number; client_fee_minor: number;
    tax_minor: number; provider_fee_minor: number; provider_net_minor: number; refunded_minor: number; external_reference: string; created_at: Date; approved_at: Date | null;
    failure_reason: string | null;
  }[]>`
    select c.id, c.job_id, j.code as job_code, c.kind, c.status, c.gateway, c.is_test, c.amount_minor, c.client_fee_minor, c.tax_minor, c.provider_fee_minor,
      c.provider_net_minor, c.refunded_minor, c.external_reference, c.created_at, c.approved_at, c.failure_reason
    from charges c join jobs j on j.id = c.job_id
    where (${status ?? null}::text is null or c.status = ${status ?? null})
    order by c.created_at desc limit 200`);
}

export async function listPayouts(userId: string) {
  return asUser(userId, (tx) => tx<{
    id: string; job_id: string; job_code: string; job_status: string; provider_id: string; provider_name: string; payouts_status: string; status: string; on_hold: boolean;
    hold_reason: string | null; gross_minor: number; fee_minor: number; adjustments_minor: number; amount_minor: number; is_test: boolean; gateway: string;
    scheduled_for: string | null; paid_at: Date | null; created_at: Date; external_ref: string | null; awaiting_review: boolean; review_override_reason: string | null;
  }[]>`
    select po.id, po.job_id, j.code as job_code, j.status as job_status, po.provider_id, p.display_name as provider_name, p.payouts_status, po.status, po.on_hold,
      po.awaiting_review, po.review_override_reason,
      po.hold_reason, po.gross_minor, po.fee_minor, po.adjustments_minor, po.amount_minor, po.is_test, po.gateway, po.scheduled_for, po.paid_at, po.created_at, po.external_ref
    from payouts po join jobs j on j.id = po.job_id join providers p on p.id = po.provider_id
    order by case when po.status in ('pending','scheduled','failed') then 0 else 1 end, po.created_at desc limit 200`);
}

export async function listRefunds(userId: string) {
  return asUser(userId, (tx) => tx<{
    id: string; charge_id: string; charge_kind: string; charge_amount_minor: number; charge_status: string; job_id: string; job_code: string; amount_minor: number;
    status: string; reason: string; dispute_id: string | null; requested_by_name: string | null; created_at: Date; is_test: boolean;
  }[]>`
    select r.id, r.charge_id, c.kind as charge_kind, c.amount_minor as charge_amount_minor, c.status as charge_status, c.job_id, j.code as job_code,
      r.amount_minor, r.status, r.reason, r.dispute_id, u.full_name as requested_by_name, r.created_at, c.is_test
    from refunds r join charges c on c.id = r.charge_id join jobs j on j.id = c.job_id left join user_names u on u.id = r.requested_by
    order by r.created_at desc limit 200`);
}

export async function getLedger(userId: string) {
  return asUser(userId, async (tx) => {
    const entries = await tx<{
      id: number; txn_id: string; job_id: string | null; job_code: string | null; entry_type: string; account: string; amount_minor: number; is_test: boolean;
      reason: string; actor_name: string | null; external_ref: string | null; created_at: Date;
    }[]>`
      select l.id, l.txn_id, l.job_id, j.code as job_code, l.entry_type, l.account, l.amount_minor, l.is_test, l.reason, u.full_name as actor_name,
        l.external_ref, l.created_at
      from ledger_entries l left join jobs j on j.id = l.job_id left join user_names u on u.id = l.actor_id
      order by l.id desc limit 200`;
    const totals = await tx<{ account: string; is_test: boolean; total: number; entries: number }[]>`
      select account, is_test, sum(amount_minor)::bigint as total, count(*)::int as entries from ledger_entries group by account, is_test order by account, is_test`;
    return { entries, totals };
  });
}

export async function jobsForAdjustment(userId: string) {
  return asUser(userId, (tx) => tx<{ id: string; code: string; provider_name: string }[]>`
    select j.id, j.code, p.display_name as provider_name from jobs j join providers p on p.id = j.provider_id order by j.created_at desc limit 200`);
}

// ───────────────────────── Catálogo y comisiones ─────────────────────────

export async function getCatalogAdmin(userId: string) {
  return asUser(userId, async (tx) => {
    const categories = await tx<{ id: string; slug: string; name: string; description: string; icon: string; sort: number; active: boolean; requires_review: boolean; safety_note: string | null }[]>`
      select id, slug, name, description, icon, sort, active, requires_review, safety_note from categories order by sort, name`;
    const services = await tx<{
      id: string; category_id: string; slug: string; name: string; description: string; pricing_mode: string; fixed_price_minor: number | null;
      diagnostic_price_minor: number | null; scope: string; exclusions: string; active: boolean; sort: number;
    }[]>`select id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, scope, exclusions, active, sort from services order by sort, name`;
    const questions = await tx<{ id: string; category_id: string; key: string; label: string; kind: string; options: string[]; required: boolean; sort: number }[]>`
      select id, category_id, key, label, kind, options, required, sort from service_questions order by sort, key`;
    const credentialTypes = await tx<{ id: string; code: string; name: string; description: string; expires: boolean }[]>`
      select id, code, name, description, expires from credential_types order by name`;
    const required = await tx<{ category_id: string; credential_type_id: string }[]>`select category_id, credential_type_id from category_required_credentials`;
    const zones = await tx<{ id: string; code: string; name: string; region: string; active: boolean; sort: number; providers: number }[]>`
      select z.id, z.code, z.name, z.region, z.active, z.sort, (select count(*)::int from provider_zones pz where pz.zone_id = z.id) as providers
      from zones z order by z.region, z.sort, z.name`;
    return { categories, services, questions, credentialTypes, required, zones };
  });
}

export async function getCommissionsAdmin(userId: string) {
  return asUser(userId, async (tx) => {
    const rules = await tx<{
      id: string; category_id: string | null; category_name: string | null; provider_rate_bps: number; client_rate_bps: number; client_fee_tax_bps: number;
      active: boolean; created_at: Date; created_by_name: string | null;
    }[]>`
      select r.id, r.category_id, c.name as category_name, r.provider_rate_bps, r.client_rate_bps, r.client_fee_tax_bps, r.active, r.created_at,
        u.full_name as created_by_name
      from commission_rules r left join categories c on c.id = r.category_id left join user_names u on u.id = r.created_by
      order by r.active desc, r.category_id nulls first, r.created_at desc limit 100`;
    const settings = await tx<{ key: string; value: unknown; updated_at: Date; updated_by_name: string | null }[]>`
      select s.key, s.value, s.updated_at, u.full_name as updated_by_name from platform_settings s left join user_names u on u.id = s.updated_by order by s.key`;
    const categories = await tx<{ id: string; name: string }[]>`select id, name from categories order by sort, name`;
    return { rules, settings, categories };
  });
}

// ───────────────────────── Auditoría ─────────────────────────

export async function listAudit(userId: string, f: { action?: string; entityType?: string; limit: number; offset: number }) {
  const prefix = f.action ? `${f.action.replace(/[%_\\]/g, "\\$&")}%` : null;
  return asUser(userId, async (tx) => {
    const rows = await tx<(AuditRow & { entity_type: string; entity_id: string | null })[]>`
      select a.id, a.action, a.entity_type, a.entity_id, a.reason, a.created_at, u.full_name as actor_name, a.actor_role, a.data
      from audit_log a left join user_names u on u.id = a.actor_id
      where (${prefix}::text is null or a.action like ${prefix})
        and (${f.entityType ?? null}::text is null or a.entity_type = ${f.entityType ?? null})
      order by a.id desc limit ${f.limit + 1} offset ${f.offset}`;
    const entityTypes = await tx<{ entity_type: string }[]>`select distinct entity_type from audit_log order by 1`;
    return { rows: rows.slice(0, f.limit), hasMore: rows.length > f.limit, entityTypes: entityTypes.map((e) => e.entity_type) };
  });
}

export type { TimelineEvent };

// ───────────────────────── Reseñas e impugnaciones ─────────────────────────

export async function listReviewDisputes(userId: string, status?: string) {
  return asUser(userId, (tx) => tx<{
    id: string; status: string; resolution: string | null; reason_code: string; created_at: Date; ai_rounds: number; resolved_by_ai: boolean;
    rating: number; job_id: string; job_code: string; provider_name: string; client_name: string; escalation_reason: string | null;
  }[]>`
    select d.id, d.status, d.resolution, d.reason_code, d.created_at, d.ai_rounds, d.resolved_by_ai, r.rating, j.id as job_id, j.code as job_code,
      p.display_name as provider_name, u.full_name as client_name, d.escalation_reason
    from review_disputes d join reviews r on r.id = d.review_id join jobs j on j.id = r.job_id
    join providers p on p.id = d.provider_id join user_names u on u.id = r.client_user_id
    ${status ? tx`where d.status = ${status}` : tx``}
    order by case d.status when 'escalated' then 0 when 'ai_review' then 1 when 'awaiting_client' then 2 else 3 end, d.created_at desc limit 200`);
}

export async function listAllReviews(userId: string, q?: string) {
  return asUser(userId, (tx) => tx<{
    id: string; rating: number; comment: string; created_at: Date; visible_at: Date; hidden_at: Date | null; withdrawn_at: Date | null; edited_at: Date | null;
    is_demo: boolean; job_id: string; job_code: string; provider_id: string; provider_name: string; client_name: string; dispute_id: string | null; dispute_status: string | null;
  }[]>`
    select r.id, r.rating, r.comment, r.created_at, r.visible_at, r.hidden_at, r.withdrawn_at, r.edited_at, r.is_demo, j.id as job_id, j.code as job_code,
      p.id as provider_id, p.display_name as provider_name, u.full_name as client_name, d.id as dispute_id, d.status as dispute_status
    from reviews r join jobs j on j.id = r.job_id join providers p on p.id = r.provider_id join user_names u on u.id = r.client_user_id
    left join review_disputes d on d.review_id = r.id
    ${q ? tx`where j.code ilike ${"%" + q + "%"} or p.display_name ilike ${"%" + q + "%"} or u.full_name ilike ${"%" + q + "%"}` : tx``}
    order by r.created_at desc limit 300`);
}

export async function getReviewDispute(userId: string, id: string) {
  return asUser(userId, async (tx) => {
    const [d] = await tx<{
      id: string; status: string; resolution: string | null; reason_code: string; provider_statement: string; ai_rounds: number; resolved_by_ai: boolean;
      ai_last_decision: { decision?: string; confidence?: string; policyFlags?: string[]; source?: string } | null; internal_summary: string | null; provider_summary: string | null;
      escalation_reason: string | null; client_deadline: Date; created_at: Date; resolved_at: Date | null; review_id: string; provider_id: string;
    }[]>`select * from review_disputes where id = ${id}`;
    if (!d) return null;
    const [review] = await tx<{ rating: number; comment: string; created_at: Date; visible_at: Date; hidden_at: Date | null; withdrawn_at: Date | null; edited_at: Date | null; job_id: string; client_user_id: string }[]>`
      select rating, comment, created_at, visible_at, hidden_at, withdrawn_at, edited_at, job_id, client_user_id from reviews where id = ${d.review_id}`;
    const [job] = await tx<{ code: string; title: string; status: string; completed_at: Date | null }[]>`
      select j.code, r.title, j.status, j.completed_at from jobs j join service_requests r on r.id = j.request_id where j.id = ${review.job_id}`;
    const [client] = await tx<{ full_name: string; email: string; phone: string | null }[]>`select full_name, email, phone from users where id = ${review.client_user_id}`;
    const [provider] = await tx<{ display_name: string; slug: string }[]>`select display_name, slug from providers where id = ${d.provider_id}`;
    const messages = await tx<{ id: string; author: string; author_name: string | null; body: string; created_at: Date }[]>`
      select m.id, m.author, u.full_name as author_name, m.body, m.created_at from review_dispute_messages m left join user_names u on u.id = m.author_id
      where m.dispute_id = ${id} order by m.created_at`;
    const revisions = await tx<{ rating: number; comment: string; reason: string; created_at: Date }[]>`
      select rating, comment, reason, created_at from review_revisions where review_id = ${d.review_id} order by created_at`;
    return { d, review, job, client, provider, messages, revisions };
  });
}

/** Oficios que escribieron profesionales porque no estaban en la lista (tabla de sistema, sin datos personales). */
export async function listTradeSuggestions() {
  return sql()<{ id: string; text: string; created_at: Date; provider: string; provider_id: string }[]>`
    select t.id, t.text, t.created_at, p.display_name as provider, p.id as provider_id
    from trade_suggestions t join providers p on p.id = t.provider_id where t.status = 'open' order by t.created_at desc limit 50`;
}
