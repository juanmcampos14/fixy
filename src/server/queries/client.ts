/** Lecturas del panel del cliente (particulares y miembros de organizaciones). Todas bajo RLS. */
import "server-only";
import type { AccessRequirements } from "@/server/assistant/access-rules";
import { asUser } from "@/server/db/client";
import { signedFileUrl, publicFileUrl } from "@/server/storage";
import { conversationMessages, timeline } from "./shared";

export type RequestListItem = {
  id: string; code: string; title: string; status: string; created_at: Date; property_label: string; category_name: string | null;
  quotes: number; invited: number; job_id: string | null; organization_name: string | null; needs_review: boolean;
};

export async function listClientRequests(userId: string, opts: { active?: boolean; propertyId?: string } = {}) {
  return asUser(userId, (tx) => tx<RequestListItem[]>`
    select r.id, r.code, r.title, r.status, r.created_at, p.label as property_label, c.name as category_name, r.needs_review,
      (select count(*)::int from quotes q where q.request_id = r.id and q.status = 'sent') as quotes,
      (select count(*)::int from request_invitations i where i.request_id = r.id) as invited,
      (select j.id from jobs j where j.request_id = r.id) as job_id, o.name as organization_name
    from service_requests r join properties p on p.id = r.property_id left join categories c on c.id = r.category_id
    left join organizations o on o.id = r.organization_id
    where app.is_request_client(${userId}, r.id)
      ${opts.active ? tx`and r.status in ('submitted','searching','with_quotes','no_coverage')` : tx``}
      ${opts.propertyId ? tx`and r.property_id = ${opts.propertyId}` : tx``}
    order by r.created_at desc limit 200`);
}

export type JobListItem = {
  id: string; code: string; status: string; title: string; provider_name: string; total_minor: number; scheduled_date: string | null;
  property_label: string; created_at: Date; pending_charge: boolean; pending_extras: number; open_reschedule: boolean; has_review: boolean; open_dispute: boolean;
};

export async function listClientJobs(userId: string, opts: { active?: boolean; propertyId?: string } = {}) {
  return asUser(userId, (tx) => tx<JobListItem[]>`
    select j.id, j.code, j.status, r.title, pp.display_name as provider_name, j.total_minor, j.scheduled_date, p.label as property_label, j.created_at,
      exists (select 1 from charges c where c.job_id = j.id and c.status = 'pending') as pending_charge,
      (select count(*)::int from job_extras e where e.job_id = j.id and e.status = 'proposed') as pending_extras,
      exists (select 1 from job_reschedules x where x.job_id = j.id and x.status = 'proposed' and x.proposed_side = 'provider') as open_reschedule,
      exists (select 1 from reviews v where v.job_id = j.id) as has_review,
      exists (select 1 from disputes d where d.job_id = j.id and d.status in ('open','in_review','awaiting_response')) as open_dispute
    from jobs j join service_requests r on r.id = j.request_id join provider_public pp on pp.id = j.provider_id join properties p on p.id = j.property_id
    where app.is_job_client(${userId}, j.id)
      ${opts.active ? tx`and j.status not in ('completed','cancelled')` : tx``}
      ${opts.propertyId ? tx`and j.property_id = ${opts.propertyId}` : tx``}
    order by j.created_at desc limit 200`);
}

export async function getClientRequest(userId: string, requestId: string) {
  return asUser(userId, async (tx) => {
    const [r] = await tx<{
      id: string; code: string; title: string; description: string; status: string; urgency: string; preferred_windows: string[]; answers: Record<string, unknown>;
      needs_review: boolean; review_reason: string | null; safety_flag: string | null; created_at: Date; submitted_at: Date | null; cancel_reason: string | null; request_mode: string;
      property_id: string; property_label: string; zone_name: string; category_id: string | null; category_name: string | null; organization_id: string | null; is_client: boolean;
      service_name: string | null; target_provider_id: string | null; gated_community: boolean; gated_status: string; budget_minor: number | null;
    }[]>`
      select r.*, p.label as property_label, p.gated_community, p.gated_requirements_status as gated_status, z.name as zone_name, c.name as category_name, s.name as service_name,
        app.is_request_client(${userId}, r.id) as is_client
      from service_requests r join properties p on p.id = r.property_id join zones z on z.id = p.zone_id
      left join categories c on c.id = r.category_id left join services s on s.id = r.service_id where r.id = ${requestId}`;
    if (!r || !r.is_client) return null;
    const [priv] = await tx<{ access_info: string | null }[]>`select access_info from request_private where request_id = ${requestId}`;
    const questions = r.category_id ? await tx<{ key: string; label: string }[]>`select key, label from service_questions where category_id = ${r.category_id}` : [];
    const invitations = await tx<{ status: string; n: number }[]>`select status, count(*)::int as n from request_invitations where request_id = ${requestId} group by status`;
    const quotes = await tx<{
      id: string; status: string; mode: string; scope: string; exclusions: string; materials_included: boolean; proposed_date: string | null; proposed_window: string | null;
      valid_until: Date; labor_minor: number; materials_minor: number; visit_minor: number; subtotal_minor: number; client_fee_minor: number; client_fee_tax_minor: number;
      total_minor: number; client_rate_bps: number; client_fee_tax_bps: number; cancellation_terms: string; sent_at: Date; provider_id: string;
      provider_name: string; provider_slug: string; provider_kind: string; identity_status: string; provider_is_demo: boolean; reviews: number; rating: number | null;
      credentials: string[] | null; completed_jobs: number;
    }[]>`
      select q.*, pp.display_name as provider_name, pp.slug as provider_slug, pp.kind as provider_kind, pp.identity_status, pp.is_demo as provider_is_demo,
        (select count(*)::int from reviews_published v where v.provider_id = q.provider_id) as reviews,
        (select round(avg(rating)::numeric, 1)::float from reviews_published v where v.provider_id = q.provider_id) as rating,
        (select count(*)::int from jobs jj where jj.provider_id = q.provider_id and jj.status = 'completed') as completed_jobs,
        (select array_agg(ct.name) from provider_credentials_public pc join credential_types ct on ct.id = pc.credential_type_id where pc.provider_id = q.provider_id) as credentials
      from quotes q join provider_public pp on pp.id = q.provider_id
      where q.request_id = ${requestId} and q.status <> 'draft' order by q.status = 'sent' desc, q.total_minor`;
    const quoteItems = quotes.length
      ? await tx<{ quote_id: string; kind: string; description: string; quantity: number; unit_price_minor: number; amount_minor: number }[]>`
          select quote_id, kind, description, quantity, unit_price_minor, amount_minor from quote_items where quote_id in ${tx(quotes.map((q) => q.id))} order by sort`
      : [];
    const conversations = await tx<{ id: string; provider_id: string; provider_name: string }[]>`
      select c.id, c.provider_id, pp.display_name as provider_name from conversations c join provider_public pp on pp.id = c.provider_id
      where c.request_id = ${requestId} and (
        exists (select 1 from quotes q where q.request_id = c.request_id and q.provider_id = c.provider_id and q.status <> 'draft')
        or (${r.request_mode} = 'direct' and exists (select 1 from request_invitations i where i.request_id = c.request_id and i.provider_id = c.provider_id and i.status in ('invited','viewed','quoted'))))`;
    const invitationList = await tx<{ id: string; status: string; respond_by: Date | null; provider_id: string; provider_name: string; provider_slug: string; visit_fee_minor: number }[]>`
      select i.id, i.status, i.respond_by, i.provider_id, pp.display_name as provider_name, pp.slug as provider_slug,
        (select visit_fee_minor from providers_visit_public v where v.id = i.provider_id) as visit_fee_minor
      from request_invitations i join provider_public pp on pp.id = i.provider_id where i.request_id = ${requestId} order by i.created_at`;
    const threads = await Promise.all(conversations.map(async (c) => ({ ...c, messages: await conversationMessages(tx, userId, c.id) })));
    const [job] = await tx<{ id: string; code: string; status: string }[]>`select id, code, status from jobs where request_id = ${requestId}`;
    const photos = (await tx<{ file_id: string }[]>`select file_id from request_attachments where request_id = ${requestId}`).map((p) => signedFileUrl(p.file_id, 900));
    const events = await timeline(tx, "request", requestId);
    const referrals = (await tx<{ id: string; note: string | null; from_name: string; to_slug: string; to_name: string; to_verified: boolean; to_avatar: string | null }[]>`
      select pr.id, pr.note, f.display_name as from_name, t.slug as to_slug, t.display_name as to_name,
        (t.status = 'approved' and t.identity_status = 'verified') as to_verified, t.avatar_file_id as to_avatar
      from provider_referrals pr join provider_public f on f.id = pr.from_provider_id join provider_public t on t.id = pr.to_provider_id
      where pr.request_id = ${requestId} and pr.status = 'proposed' order by pr.created_at desc`).map((x) => ({ ...x, to_avatar: x.to_avatar ? publicFileUrl(x.to_avatar) : null }));
    return { r, accessInfo: priv?.access_info ?? null, questions, invitations, invitationList, quotes, quoteItems, threads, job: job ?? null, photos, events, referrals };
  });
}

export async function listProperties(userId: string) {
  return asUser(userId, (tx) => tx<{ id: string; label: string; kind: string; address_line: string; zone_name: string; organization_id: string | null; org_name: string | null; jobs: number; spent_minor: number; active: number }[]>`
    select p.id, p.label, p.kind, p.address_line, z.name as zone_name, p.organization_id, o.name as org_name,
      (select count(*)::int from jobs j where j.property_id = p.id) as jobs,
      (select coalesce(sum(c.amount_minor - c.refunded_minor), 0)::bigint from charges c join jobs j on j.id = c.job_id where j.property_id = p.id and c.status in ('approved','partially_refunded','refunded')) as spent_minor,
      (select count(*)::int from service_requests r where r.property_id = p.id and r.status in ('submitted','searching','with_quotes','no_coverage')) as active
    from properties p join zones z on z.id = p.zone_id left join organizations o on o.id = p.organization_id
    where p.archived_at is null and (p.owner_user_id = ${userId} or app.org_role(${userId}, p.organization_id) is not null)
    order by p.organization_id nulls first, p.label`);
}

export async function getProperty(userId: string, propertyId: string) {
  return asUser(userId, async (tx) => {
    const [p] = await tx<{ id: string; label: string; kind: string; address_line: string; address_extra: string | null; zone_id: string; zone_name: string; contact_name: string | null; contact_phone: string | null; access_notes: string | null; organization_id: string | null; owner_user_id: string | null; org_name: string | null;
      lat: number | null; lng: number | null; place_id: string | null; formatted_address: string | null;
      gated_community: boolean; gated_name: string | null; gated_rules_url: string | null; gated_rules_text: string | null; gated_rules_file_id: string | null;
      gated_requirements: AccessRequirements | null; gated_requirements_status: string; gated_client_notes: string | null; gated_requirements_updated_at: Date | null }[]>`
      select p.*, z.name as zone_name, o.name as org_name from properties p join zones z on z.id = p.zone_id left join organizations o on o.id = p.organization_id
      where p.id = ${propertyId} and (p.owner_user_id = ${userId} or app.org_role(${userId}, p.organization_id) is not null)`;
    if (!p) return null;
    const providers = await tx<{ id: string; slug: string; display_name: string; jobs: number; last: Date }[]>`
      select pp.id, pp.slug, pp.display_name, count(*)::int as jobs, max(j.created_at) as last from jobs j join provider_public pp on pp.id = j.provider_id
      where j.property_id = ${propertyId} and j.status = 'completed' group by pp.id, pp.slug, pp.display_name order by last desc`;
    return { p, providers };
  });
}

export async function clientPayments(userId: string) {
  return asUser(userId, async (tx) => {
    const charges = await tx<{ id: string; job_id: string; job_code: string; title: string; kind: string; status: string; amount_minor: number; refunded_minor: number; is_test: boolean; created_at: Date; approved_at: Date | null; external_reference: string; checkout_url: string | null; provider_name: string }[]>`
      select c.id, c.job_id, j.code as job_code, r.title, c.kind, c.status, c.amount_minor, c.refunded_minor, c.is_test, c.created_at, c.approved_at, c.external_reference, c.checkout_url, pp.display_name as provider_name
      from charges c join jobs j on j.id = c.job_id join service_requests r on r.id = j.request_id join provider_public pp on pp.id = j.provider_id
      where app.is_job_client(${userId}, c.job_id) order by c.created_at desc`;
    const refunds = await tx<{ id: string; charge_id: string; job_code: string; amount_minor: number; reason: string; created_at: Date }[]>`
      select f.id, f.charge_id, j.code as job_code, f.amount_minor, f.reason, f.created_at from refunds f join charges c on c.id = f.charge_id join jobs j on j.id = c.job_id
      where app.is_job_client(${userId}, c.job_id) order by f.created_at desc`;
    const [agreed] = await tx<{ total: number }[]>`
      select coalesce(sum(j.total_minor + coalesce((select sum(e.total_minor) from job_extras e where e.job_id = j.id and e.status = 'accepted'), 0)), 0)::bigint as total
      from jobs j where app.is_job_client(${userId}, j.id) and j.status <> 'cancelled'`;
    return { charges, refunds, agreed: agreed.total };
  });
}

export async function getClientDispute(userId: string, disputeId: string) {
  return asUser(userId, async (tx) => {
    const [d] = await tx<{ id: string; job_id: string; status: string; reason_code: string; description: string; resolution: string | null; resolution_note: string | null; created_at: Date; opened_side: string; job_code: string; title: string; ok: boolean }[]>`
      select d.*, j.code as job_code, r.title, app.is_job_client(${userId}, d.job_id) as ok
      from disputes d join jobs j on j.id = d.job_id join service_requests r on r.id = j.request_id where d.id = ${disputeId}`;
    if (!d || !d.ok) return null;
    const messages = await tx<{ id: string; author_side: string; body: string; created_at: Date; author: string | null; file_id: string | null; file_name: string | null }[]>`
      select m.id, m.author_side, m.body, m.created_at, u.full_name as author, m.file_id, f.original_name as file_name
      from dispute_messages m left join user_names u on u.id = m.author_id left join files f on f.id = m.file_id
      where m.dispute_id = ${disputeId} order by m.created_at`;
    const events = await timeline(tx, "dispute", disputeId);
    return { d, messages: messages.map((m) => ({ ...m, url: m.file_id ? signedFileUrl(m.file_id) : null })), events };
  });
}
