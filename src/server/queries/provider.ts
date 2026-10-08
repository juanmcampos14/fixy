/**
 * Lecturas del panel de proveedor. Todo corre con asUser() (rol fixy_app + RLS) salvo:
 *  - la zona y el tipo de propiedad de una oportunidad (consulta de sistema acotada, después de verificar
 *    bajo RLS que la invitación pertenece al proveedor del usuario), y
 *  - el estado del alta (checklist/elegibilidad) del propio proveedor, después de verificar la membresía.
 * Datos públicos (perfil público, landing) usan sql() seleccionando solo columnas públicas.
 */
import "server-only";
import { redirect } from "next/navigation";
import { asUser, sql, type Tx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { requireActor } from "@/server/auth/session";
import { publicFileUrl, signedFileUrl } from "@/server/storage";
import { onboardingChecklist, providerEligibility } from "@/server/modules/providers";
import { conversationMessages, timeline } from "./shared";

// ───────────────────────── Contexto ─────────────────────────

export type ProviderMembership = Actor["providers"][number];
export type ProviderCtx = { actor: Actor; provider: ProviderMembership; isAdmin: boolean };

/** Proveedor activo del usuario: prioriza una membresía de administrador. */
export function activeMembership(actor: Actor): ProviderMembership | null {
  return actor.providers.find((p) => p.role === "admin") ?? actor.providers[0] ?? null;
}

/**
 * Para páginas del panel. Sin proveedor → alta. `adminOnly` bloquea a técnicos en el servidor
 * (no alcanza con ocultar la navegación).
 */
export async function requireProviderContext(opts: { adminOnly?: boolean } = {}): Promise<ProviderCtx> {
  const actor = await requireActor("/proveedor");
  const provider = activeMembership(actor);
  if (!provider) redirect("/proveedor/alta");
  const isAdmin = provider.role === "admin";
  if (opts.adminOnly && !isAdmin) redirect("/proveedor");
  return { actor, provider, isAdmin };
}

// ───────────────────────── Perfil y alta ─────────────────────────

export type OwnProvider = {
  id: string; slug: string; kind: "individual" | "company"; display_name: string; legal_name: string | null; tax_id: string | null;
  responsible_name: string; contact_email: string; contact_phone: string | null; description: string; years_experience: number | null;
  billing_info: string | null; accepting_jobs: boolean; max_active_jobs: number; base_zone_id: string | null; status: string;
  identity_status: string; payouts_status: string; payout_provider: string | null; review_note: string | null;
  submitted_at: Date | null; approved_at: Date | null; is_demo: boolean;
};

export async function getOwnProvider(userId: string, providerId: string): Promise<OwnProvider | null> {
  return asUser(userId, async (tx) => {
    const [p] = await tx<OwnProvider[]>`
      select id, slug, kind, display_name, legal_name, tax_id, responsible_name, contact_email, contact_phone, description,
        years_experience, billing_info, accepting_jobs, max_active_jobs, base_zone_id, status, identity_status, payouts_status,
        payout_provider, review_note, submitted_at, approved_at, is_demo
      from providers where id = ${providerId}`;
    return p ?? null;
  });
}

/** Estado del alta del propio proveedor (el usuario debe ser miembro: se verifica bajo RLS antes). */
export async function getOnboardingState(userId: string, providerId: string) {
  const own = await getOwnProvider(userId, providerId);
  if (!own) return null;
  const [checklist, eligibility] = await Promise.all([onboardingChecklist(sql(), providerId), providerEligibility(sql(), providerId)]);
  return { provider: own, checklist, eligibility };
}

export async function getProviderSetup(userId: string, providerId: string) {
  return asUser(userId, async (tx) => {
    const categories = await tx<{ id: string; name: string; icon: string; description: string }[]>`
      select id, name, icon, description from categories where active order by sort, name`;
    const zones = await tx<{ id: string; name: string; region: string }[]>`select id, name, region from zones where active order by sort, name`;
    const selectedCats = (await tx<{ category_id: string }[]>`select category_id from provider_categories where provider_id = ${providerId}`).map((r) => r.category_id);
    const selectedZones = (await tx<{ zone_id: string }[]>`select zone_id from provider_zones where provider_id = ${providerId}`).map((r) => r.zone_id);
    const availability = await tx<{ weekday: number; start_minute: number; end_minute: number }[]>`
      select weekday, start_minute, end_minute from provider_availability where provider_id = ${providerId} order by weekday, start_minute`;
    const portfolioRows = await tx<{ id: string; file_id: string; caption: string }[]>`
      select id, file_id, caption from provider_portfolio where provider_id = ${providerId} order by created_at`;
    const documents = await tx<{ id: string; kind: string; status: string; expires_on: string | null; review_note: string | null; created_at: Date; credential_name: string | null; file_id: string; file_name: string | null }[]>`
      select d.id, d.kind, d.status, d.expires_on, d.review_note, d.created_at, ct.name as credential_name, d.file_id, f.original_name as file_name
      from provider_documents d left join credential_types ct on ct.id = d.credential_type_id left join files f on f.id = d.file_id
      where d.provider_id = ${providerId} order by d.created_at desc`;
    const credentialTypes = await tx<{ id: string; name: string; description: string; expires: boolean }[]>`
      select id, name, description, expires from credential_types order by name`;
    const [terms] = await tx<{ id: string; title: string; version: string; is_draft: boolean; accepted: boolean }[]>`
      select d.id, d.title, d.version, d.is_draft,
        exists (select 1 from policy_acceptances a where a.policy_id = d.id and a.user_id = ${userId}) as accepted
      from policy_documents d where d.kind = 'provider_terms' order by d.published_at desc limit 1`;
    return {
      categories, zones, selectedCats, selectedZones, availability,
      portfolio: portfolioRows.map((p) => ({ ...p, url: publicFileUrl(p.file_id) })),
      documents: documents.map((d) => ({ ...d, url: signedFileUrl(d.file_id, 900) })),
      credentialTypes, terms: terms ?? null,
    };
  });
}

export type ProviderSetup = Awaited<ReturnType<typeof getProviderSetup>>;

// ───────────────────────── Inicio ─────────────────────────

export async function getDashboard(userId: string, providerId: string, isAdmin: boolean) {
  return asUser(userId, async (tx) => {
    const [{ newOpps }] = isAdmin
      ? await tx<{ newOpps: number }[]>`select count(*)::int as "newOpps" from request_invitations where provider_id = ${providerId} and status in ('invited','viewed')`
      : [{ newOpps: 0 }];
    const activeJobs = await tx<{ id: string; code: string; status: string; scheduled_date: string | null; scheduled_window: string | null; title: string; assigned_user_id: string | null }[]>`
      select j.id, j.code, j.status, j.scheduled_date, j.scheduled_window, r.title, j.assigned_user_id
      from jobs j join service_requests r on r.id = j.request_id
      where j.provider_id = ${providerId} and j.status not in ('completed','cancelled')
        ${isAdmin ? tx`` : tx`and j.assigned_user_id = ${userId}`}
      order by j.scheduled_date nulls last, j.created_at`;
    // Pendientes concretos (solo administradores ven pagos).
    const toConfirm = isAdmin
      ? await tx<{ id: string; code: string; title: string }[]>`
          select j.id, j.code, r.title from jobs j join service_requests r on r.id = j.request_id
          where j.provider_id = ${providerId} and j.status = 'pending_confirmation'
            and exists (select 1 from charges c where c.job_id = j.id and c.kind in ('visit','job_total','deposit') and c.status = 'approved')`
      : [];
    const awaitingPayment = isAdmin
      ? await tx<{ id: string; code: string; title: string }[]>`
          select j.id, j.code, r.title from jobs j join service_requests r on r.id = j.request_id
          where j.provider_id = ${providerId} and j.status = 'pending_confirmation'
            and not exists (select 1 from charges c where c.job_id = j.id and c.kind in ('visit','job_total','deposit') and c.status = 'approved')`
      : [];
    const extrasWaiting = isAdmin
      ? await tx<{ id: string; job_id: string; code: string; description: string }[]>`
          select e.id, e.job_id, j.code, e.description from job_extras e join jobs j on j.id = e.job_id
          where j.provider_id = ${providerId} and e.status = 'proposed'`
      : [];
    const reschedulesToAnswer = isAdmin
      ? await tx<{ id: string; job_id: string; code: string; new_date: string }[]>`
          select r.id, r.job_id, j.code, r.new_date from job_reschedules r join jobs j on j.id = r.job_id
          where j.provider_id = ${providerId} and r.status = 'proposed' and r.proposed_side = 'client'`
      : [];
    const openDisputes = isAdmin
      ? await tx<{ id: string; code: string; status: string }[]>`
          select d.id, j.code, d.status from disputes d join jobs j on j.id = d.job_id
          where j.provider_id = ${providerId} and d.status in ('open','in_review','awaiting_response')`
      : [];
    const [earnings] = isAdmin
      ? await tx<{ pending: number; paid: number }[]>`
          select coalesce(sum(amount_minor) filter (where status in ('pending','scheduled','processing','failed')), 0)::bigint as pending,
                 coalesce(sum(amount_minor) filter (where status = 'paid'), 0)::bigint as paid
          from payouts where provider_id = ${providerId}`
      : [null];
    const [testMode] = isAdmin
      ? await tx<{ any_test: boolean }[]>`select coalesce(bool_or(is_test), false) as any_test from payouts where provider_id = ${providerId}`
      : [null];
    return { newOpps, activeJobs, toConfirm, awaitingPayment, extrasWaiting, reschedulesToAnswer, openDisputes, earnings, anyTest: testMode?.any_test ?? false };
  });
}

// ───────────────────────── Oportunidades ─────────────────────────

export async function listInvitations(userId: string, providerId: string) {
  return asUser(userId, (tx) =>
    tx<{ id: string; status: string; created_at: Date; code: string; title: string; urgency: string; request_status: string; category_name: string | null; category_icon: string | null; quote_status: string | null }[]>`
      select i.id, i.status, i.created_at, r.code, r.title, r.urgency, r.status as request_status, c.name as category_name, c.icon as category_icon,
        (select q.status from quotes q where q.invitation_id = i.id order by q.created_at desc limit 1) as quote_status
      from request_invitations i join service_requests r on r.id = i.request_id left join categories c on c.id = r.category_id
      where i.provider_id = ${providerId}
      order by case when i.status in ('invited','viewed') then 0 else 1 end, i.created_at desc`,
  );
}

export async function getOpportunity(userId: string, providerId: string, invitationId: string) {
  const data = await asUser(userId, async (tx) => {
    const [inv] = await tx<{ id: string; request_id: string; provider_id: string; status: string; created_at: Date; decline_reason: string | null }[]>`
      select id, request_id, provider_id, status, created_at, decline_reason from request_invitations where id = ${invitationId} and provider_id = ${providerId}`;
    if (!inv) return null;
    const [request] = await tx<{ id: string; code: string; title: string; description: string; answers: Record<string, string | boolean>; urgency: string; preferred_windows: string[]; status: string; category_id: string | null; service_id: string | null; created_at: Date }[]>`
      select id, code, title, description, answers, urgency, preferred_windows, status, category_id, service_id, created_at
      from service_requests where id = ${inv.request_id}`;
    if (!request) return null;
    const [category] = request.category_id
      ? await tx<{ name: string; icon: string }[]>`select name, icon from categories where id = ${request.category_id}`
      : [];
    const [service] = request.service_id
      ? await tx<{ name: string; pricing_mode: string; scope: string; exclusions: string; fixed_price_minor: number | null }[]>`
          select name, pricing_mode, scope, exclusions, fixed_price_minor from services where id = ${request.service_id}`
      : [];
    const questions = request.category_id
      ? await tx<{ key: string; label: string }[]>`select key, label from service_questions where category_id = ${request.category_id} order by sort`
      : [];
    const photos = (await tx<{ file_id: string }[]>`select file_id from request_attachments where request_id = ${request.id}`).map((p) => signedFileUrl(p.file_id, 900));
    const [quote] = await tx<{ id: string; status: string; mode: string; scope: string; exclusions: string; materials_included: boolean; proposed_date: string | null; proposed_window: string | null; valid_until: Date; subtotal_minor: number; provider_fee_minor: number; provider_net_minor: number; total_minor: number; provider_rate_bps: number; sent_at: Date | null }[]>`
      select id, status, mode, scope, exclusions, materials_included, proposed_date, proposed_window, valid_until, subtotal_minor, provider_fee_minor,
        provider_net_minor, total_minor, provider_rate_bps, sent_at
      from quotes where invitation_id = ${inv.id} order by created_at desc limit 1`;
    const items = quote
      ? await tx<{ id: string; kind: string; description: string; quantity: number; unit_price_minor: number; amount_minor: number }[]>`
          select id, kind, description, quantity, unit_price_minor, amount_minor from quote_items where quote_id = ${quote.id} order by sort`
      : [];
    const [conv] = await tx<{ id: string; job_id: string | null }[]>`select id, job_id from conversations where request_id = ${request.id} and provider_id = ${providerId}`;
    const messages = conv ? await conversationMessages(tx, userId, conv.id) : [];
    return { inv, request, category: category ?? null, service: service ?? null, questions, photos, quote: quote ?? null, items, conversationId: conv?.id ?? null, jobId: conv?.job_id ?? null, messages };
  });
  if (!data) return null;
  // Consulta de sistema acotada: solo el nombre de la zona y el tipo de propiedad (sin dirección ni datos de acceso).
  const [loc] = await sql()<{ zone_name: string; region: string; property_kind: string }[]>`
    select z.name as zone_name, z.region, p.kind as property_kind
    from service_requests r join properties p on p.id = r.property_id join zones z on z.id = p.zone_id where r.id = ${data.request.id}`;
  return { ...data, zoneName: loc?.zone_name ?? "", region: loc?.region ?? "", propertyKind: loc?.property_kind ?? "other" };
}

// ───────────────────────── Trabajos y agenda ─────────────────────────

export async function listJobs(userId: string, providerId: string, isAdmin: boolean) {
  return asUser(userId, (tx) =>
    tx<{ id: string; code: string; status: string; scheduled_date: string | null; scheduled_window: string | null; title: string; category_name: string | null; technician: string | null; created_at: Date }[]>`
      select j.id, j.code, j.status, j.scheduled_date, j.scheduled_window, r.title, c.name as category_name, u.full_name as technician, j.created_at
      from jobs j join service_requests r on r.id = j.request_id left join categories c on c.id = j.category_id
      left join user_names u on u.id = j.assigned_user_id
      where j.provider_id = ${providerId} ${isAdmin ? tx`` : tx`and j.assigned_user_id = ${userId}`}
      order by case when j.status in ('completed','cancelled') then 1 else 0 end, j.scheduled_date nulls last, j.created_at desc`,
  );
}

export async function listAgenda(userId: string, providerId: string, isAdmin: boolean) {
  return asUser(userId, (tx) =>
    tx<{ id: string; code: string; status: string; scheduled_date: string | null; scheduled_window: string | null; title: string; technician: string | null }[]>`
      select j.id, j.code, j.status, j.scheduled_date, j.scheduled_window, r.title, u.full_name as technician
      from jobs j join service_requests r on r.id = j.request_id left join user_names u on u.id = j.assigned_user_id
      where j.provider_id = ${providerId} and j.status in ('pending_confirmation','confirmed','on_the_way','in_progress')
        ${isAdmin ? tx`` : tx`and j.assigned_user_id = ${userId}`}
      order by j.scheduled_date nulls last, j.scheduled_window`,
  );
}

export async function listTeam(userId: string, providerId: string) {
  return asUser(userId, (tx) =>
    tx<{ user_id: string; full_name: string; role: "admin" | "technician"; active: boolean; created_at: Date; active_jobs: number }[]>`
      select m.user_id, u.full_name, m.role, m.active, m.created_at,
        (select count(*)::int from jobs j where j.provider_id = m.provider_id and j.assigned_user_id = m.user_id and j.status not in ('completed','cancelled')) as active_jobs
      from provider_members m join user_names u on u.id = m.user_id
      where m.provider_id = ${providerId} order by m.active desc, m.role, u.full_name`,
  );
}

// ───────────────────────── Cobros ─────────────────────────

export async function getEarnings(userId: string, providerId: string) {
  return asUser(userId, async (tx) => {
    const rows = await tx<{
      job_id: string; code: string; title: string; job_status: string; charged_gross: number; charged_fee: number; refunded: number; any_test: boolean;
      payout_id: string | null; payout_status: string | null; gross_minor: number | null; fee_minor: number | null; adjustments_minor: number | null;
      amount_minor: number | null; on_hold: boolean | null; hold_reason: string | null; paid_at: Date | null; payout_test: boolean | null; awaiting_review: boolean | null;
    }[]>`
      select j.id as job_id, j.code, r.title, j.status as job_status,
        coalesce((select sum(c.provider_net_minor + c.provider_fee_minor) from charges c where c.job_id = j.id and c.status in ('approved','partially_refunded','refunded')), 0)::bigint as charged_gross,
        coalesce((select sum(c.provider_fee_minor) from charges c where c.job_id = j.id and c.status in ('approved','partially_refunded','refunded')), 0)::bigint as charged_fee,
        coalesce((select sum(c.refunded_minor) from charges c where c.job_id = j.id), 0)::bigint as refunded,
        coalesce((select bool_or(c.is_test) from charges c where c.job_id = j.id), false) as any_test,
        p.id as payout_id, p.status as payout_status, p.gross_minor, p.fee_minor, p.adjustments_minor, p.amount_minor, p.on_hold, p.hold_reason, p.paid_at, p.is_test as payout_test, p.awaiting_review
      from jobs j join service_requests r on r.id = j.request_id left join payouts p on p.job_id = j.id
      where j.provider_id = ${providerId}
        and (p.id is not null or exists (select 1 from charges c where c.job_id = j.id and c.status in ('approved','partially_refunded','refunded')))
      order by j.created_at desc`;
    return rows;
  });
}

// ───────────────────────── Reseñas ─────────────────────────

/** Reseñas publicadas del proveedor: sin cliente, sin trabajo y sin fecha exacta (solo el mes). */
export async function listReviews(userId: string, providerId: string) {
  return asUser(userId, (tx) =>
    tx<{ id: string; rating: number; comment: string; provider_reply: string | null; is_demo: boolean; published_month: string }[]>`
      select id, rating, comment, provider_reply, is_demo, published_month
      from reviews_published where provider_id = ${providerId} order by published_month desc, sort_key`,
  );
}

// ───────────────────────── Reclamos ─────────────────────────

export async function getDisputeForProvider(userId: string, disputeId: string) {
  return asUser(userId, async (tx: Tx) => {
    const [d] = await tx<{ id: string; job_id: string; status: string; reason_code: string; description: string; opened_side: string; resolution: string | null; resolution_note: string | null; created_at: Date; resolved_at: Date | null }[]>`
      select id, job_id, status, reason_code, description, opened_side, resolution, resolution_note, created_at, resolved_at from disputes where id = ${disputeId}`;
    if (!d) return null;
    const [job] = await tx<{ id: string; code: string; provider_id: string; title: string }[]>`
      select j.id, j.code, j.provider_id, r.title from jobs j join service_requests r on r.id = j.request_id where j.id = ${d.job_id}`;
    if (!job) return null;
    const msgs = await tx<{ id: string; body: string; author_side: string; author_name: string | null; created_at: Date; file_id: string | null; file_name: string | null; mine: boolean }[]>`
      select m.id, m.body, m.author_side, u.full_name as author_name, m.created_at, m.file_id, f.original_name as file_name, m.author_id = ${userId} as mine
      from dispute_messages m left join user_names u on u.id = m.author_id left join files f on f.id = m.file_id
      where m.dispute_id = ${disputeId} and not m.internal order by m.created_at`;
    const events = await timeline(tx, "dispute", disputeId);
    return { dispute: d, job, messages: msgs.map((m) => ({ ...m, file_url: m.file_id ? signedFileUrl(m.file_id, 900) : null })), events };
  });
}

// ───────────────────────── Perfil público ─────────────────────────

/** Solo columnas públicas; solo proveedores aprobados. */
export async function getPublicProfile(slug: string) {
  const db = sql();
  const [p] = await db<{ id: string; slug: string; kind: string; display_name: string; description: string; years_experience: number | null; identity_status: string; is_demo: boolean; approved_at: Date | null }[]>`
    select id, slug, kind, display_name, description, years_experience, identity_status, is_demo, approved_at
    from provider_public where slug = ${slug} and status = 'approved'`;
  if (!p) return null;
  const [categories, zones, portfolio, credentials, reviews] = await Promise.all([
    db<{ id: string; name: string; icon: string }[]>`
      select c.id, c.name, c.icon from provider_categories pc join categories c on c.id = pc.category_id where pc.provider_id = ${p.id} and c.active order by c.sort, c.name`,
    db<{ name: string; region: string }[]>`
      select z.name, z.region from provider_zones pz join zones z on z.id = pz.zone_id where pz.provider_id = ${p.id} and z.active order by z.sort, z.name`,
    db<{ id: string; file_id: string; caption: string }[]>`
      select pp.id, pp.file_id, pp.caption from provider_portfolio pp join files f on f.id = pp.file_id
      where pp.provider_id = ${p.id} and f.visibility = 'public' order by pp.created_at`,
    db<{ name: string; expires_on: string | null }[]>`
      select ct.name, cp.expires_on from provider_credentials_public cp join credential_types ct on ct.id = cp.credential_type_id
      where cp.provider_id = ${p.id} order by ct.name`,
    db<{ id: string; rating: number; comment: string; provider_reply: string | null; is_demo: boolean; published_month: string }[]>`
      select id, rating, comment, provider_reply, is_demo, published_month
      from reviews_published where provider_id = ${p.id}
      order by published_month desc, sort_key limit 30`,
  ]);
  const [{ avg, n }] = await db<{ avg: string | null; n: number }[]>`
    select round(avg(rating)::numeric, 1)::text as avg, count(*)::int as n
    from reviews_published where provider_id = ${p.id}`;
  return {
    provider: p, categories, zones, credentials, reviews,
    portfolio: portfolio.map((x) => ({ id: x.id, caption: x.caption, url: publicFileUrl(x.file_id) })),
    rating: { average: avg ? Number(avg) : null, count: n },
  };
}

/** Regla de comisión por defecto (pública) y si hay reglas específicas por categoría. */
export async function getDefaultCommission() {
  const db = sql();
  const [def] = await db<{ provider_rate_bps: number; client_rate_bps: number }[]>`
    select provider_rate_bps, client_rate_bps from commission_rules where active and category_id is null limit 1`;
  const [{ specific }] = await db<{ specific: number }[]>`select count(*)::int as specific from commission_rules where active and category_id is not null`;
  return { providerRateBps: def?.provider_rate_bps ?? null, clientRateBps: def?.client_rate_bps ?? null, hasCategoryRules: specific > 0 };
}
