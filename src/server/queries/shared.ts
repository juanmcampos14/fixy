/**
 * Consultas de lectura para los paneles. Corren con asUser(): rol fixy_app + RLS,
 * así que un usuario solo obtiene filas que tiene permitido ver.
 */
import "server-only";
import { asUser, type Tx } from "@/server/db/client";
import type { AccessRequirements } from "@/server/assistant/access-rules";
import { signedFileUrl, publicFileUrl } from "@/server/storage";

export type TimelineEvent = { id: number; action: string; from_state: string | null; to_state: string | null; reason: string | null; created_at: Date; actor_name: string | null; actor_role: string | null; data: Record<string, unknown> };

export async function timeline(tx: Tx, entityType: string, entityId: string): Promise<TimelineEvent[]> {
  return tx<TimelineEvent[]>`
    select e.id, e.action, e.from_state, e.to_state, e.reason, e.created_at, e.actor_role, e.data, u.full_name as actor_name
    from entity_events e left join user_names u on u.id = e.actor_id
    where e.entity_type = ${entityType} and e.entity_id = ${entityId} order by e.id`;
}

export type MessageRow = { id: string; body: string; sender_side: string; sender_name: string | null; created_at: Date; file_url: string | null; file_name: string | null; mine: boolean };

export async function conversationMessages(tx: Tx, userId: string, conversationId: string): Promise<MessageRow[]> {
  const rows = await tx<{ id: string; body: string; sender_side: string; sender_id: string | null; sender_name: string | null; created_at: Date; file_id: string | null; file_name: string | null }[]>`
    select m.id, m.body, m.sender_side, m.sender_id, u.full_name as sender_name, m.created_at, m.file_id, f.original_name as file_name
    from messages m left join user_names u on u.id = m.sender_id left join files f on f.id = m.file_id
    where m.conversation_id = ${conversationId} order by m.created_at`;
  return rows.map((r) => ({ ...r, file_url: r.file_id ? signedFileUrl(r.file_id) : null, mine: r.sender_id === userId }));
}

export type JobDetail = Awaited<ReturnType<typeof getJobDetail>>;

/** Detalle completo de un trabajo, visible según RLS (cliente, proveedor, técnico asignado u operación). */
export async function getJobDetail(userId: string, jobId: string) {
  return asUser(userId, async (tx) => {
    const [job] = await tx<{
      id: string; code: string; status: string; mode: string; request_id: string; provider_id: string; client_user_id: string; organization_id: string | null;
      property_id: string; category_id: string | null; assigned_user_id: string | null; scheduled_date: string | null; scheduled_window: string | null;
      contract_snapshot: ContractSnapshot; total_minor: number; provider_net_minor: number; cancel_reason: string | null; created_at: Date;
      completed_at: Date | null; confirmed_at: Date | null; visit_code: string | null; checked_in_at: Date | null;
    }[]>`select * from jobs where id = ${jobId}`;
    if (!job) return null;
    // El código de visita solo lo ve el cliente (se lo dicta al profesional al llegar).
    const [{ isClient }] = await tx<{ isClient: boolean }[]>`select app.is_job_client(${userId}, ${jobId}) as "isClient"`;
    if (!isClient) job.visit_code = null;
    const [request] = await tx<{ id: string; code: string; title: string; description: string; answers: Record<string, unknown>; urgency: string }[]>`
      select id, code, title, description, answers, urgency from service_requests where id = ${job.request_id}`;
    const [priv] = await tx<{ access_info: string | null }[]>`select access_info from request_private where request_id = ${job.request_id}`;
    const [property] = await tx<{ id: string; label: string; kind: string; address_line: string; address_extra: string | null; contact_name: string | null; contact_phone: string | null; access_notes: string | null; zone_name: string; gated_name: string | null; gated_rules_file_id: string | null; gated_rules_url: string | null }[]>`
      select p.id, p.label, p.kind, p.address_line, p.address_extra, p.contact_name, p.contact_phone, p.access_notes, z.name as zone_name,
        p.gated_name, p.gated_rules_file_id, p.gated_rules_url
      from properties p join zones z on z.id = p.zone_id where p.id = ${job.property_id}`;
    const [access] = await tx<{ gated_requirements: AccessRequirements | null; gated_client_notes: string | null }[]>`
      select gated_requirements, gated_client_notes from request_access_requirements where request_id = ${job.request_id}`;
    const [zone] = await tx<{ zone_name: string }[]>`
      select z.name as zone_name from service_requests r join properties p on p.id = r.property_id join zones z on z.id = p.zone_id where r.id = ${job.request_id}`;
    const [provider] = await tx<{ id: string; slug: string; display_name: string; kind: string; identity_status: string }[]>`
      select id, slug, display_name, kind, identity_status from provider_public where id = ${job.provider_id}`;
    const [client] = await tx<{ full_name: string }[]>`select full_name from user_names where id = ${job.client_user_id}`;
    const [tech] = job.assigned_user_id ? await tx<{ full_name: string }[]>`select full_name from user_names where id = ${job.assigned_user_id}` : [];
    const charges = await tx<{ id: string; kind: string; status: string; amount_minor: number; refunded_minor: number; client_fee_minor: number; tax_minor: number; provider_fee_minor: number; provider_net_minor: number; is_test: boolean; checkout_url: string | null; external_reference: string; created_at: Date; approved_at: Date | null; extra_id: string | null }[]>`
      select id, kind, status, amount_minor, refunded_minor, client_fee_minor, tax_minor, provider_fee_minor, provider_net_minor, is_test, checkout_url, external_reference, created_at, approved_at, extra_id
      from charges where job_id = ${jobId} order by created_at`;
    const refunds = await tx<{ id: string; charge_id: string; amount_minor: number; reason: string; created_at: Date }[]>`
      select r.id, r.charge_id, r.amount_minor, r.reason, r.created_at from refunds r join charges c on c.id = r.charge_id where c.job_id = ${jobId} order by r.created_at`;
    const [payout] = await tx<{ id: string; status: string; gross_minor: number; fee_minor: number; adjustments_minor: number; amount_minor: number; on_hold: boolean; hold_reason: string | null; paid_at: Date | null; is_test: boolean; scheduled_for: string | null; awaiting_review: boolean }[]>`
      select id, status, gross_minor, fee_minor, adjustments_minor, amount_minor, on_hold, hold_reason, paid_at, is_test, scheduled_for, awaiting_review from payouts where job_id = ${jobId}`;
    const extras = await tx<{ id: string; description: string; reason: string; labor_minor: number; materials_minor: number; discount_minor: number; is_main_quote: boolean; subtotal_minor: number; client_fee_minor: number; client_fee_tax_minor: number; provider_fee_minor: number; total_minor: number; provider_net_minor: number; status: string; created_at: Date; decided_at: Date | null; decision_note: string | null }[]>`
      select * from job_extras where job_id = ${jobId} order by created_at`;
    const reschedules = await tx<{ id: string; proposed_side: string; new_date: string; new_window: string | null; previous_date: string | null; reason: string; status: string; created_at: Date; proposer: string | null }[]>`
      select r.id, r.proposed_side, r.new_date, r.new_window, r.previous_date, r.reason, r.status, r.created_at, u.full_name as proposer
      from job_reschedules r left join user_names u on u.id = r.proposed_by where r.job_id = ${jobId} order by r.created_at`;
    const evidenceRows = await tx<{ id: string; kind: string; note: string; file_id: string | null; created_at: Date; author: string | null }[]>`
      select e.id, e.kind, e.note, e.file_id, e.created_at, u.full_name as author from job_evidence e left join user_names u on u.id = e.created_by
      where e.job_id = ${jobId} order by e.created_at`;
    const evidence = evidenceRows.map((e) => ({ ...e, url: e.file_id ? signedFileUrl(e.file_id, 900) : null }));
    const disputes = await tx<{ id: string; status: string; reason_code: string; description: string; created_at: Date; resolution: string | null; resolution_note: string | null; opened_side: string }[]>`
      select id, status, reason_code, description, created_at, resolution, resolution_note, opened_side from disputes where job_id = ${jobId} order by created_at desc`;
    const [review] = await tx<{ id: string; rating: number; comment: string; provider_reply: string | null; created_at: Date }[]>`
      select id, rating, comment, provider_reply, created_at from reviews where job_id = ${jobId}`;
    const [conversation] = await tx<{ id: string }[]>`select id from conversations where job_id = ${jobId}`;
    const messages = conversation ? await conversationMessages(tx, userId, conversation.id) : [];
    const events = await timeline(tx, "job", jobId);
    const requestEvents = await timeline(tx, "request", job.request_id);
    const photos = (await tx<{ file_id: string }[]>`select file_id from request_attachments where request_id = ${job.request_id}`).map((p) => signedFileUrl(p.file_id, 900));
    return {
      job, request, accessInfo: priv?.access_info ?? null, property: property ?? null, zoneName: zone?.zone_name ?? "", provider, clientName: client?.full_name ?? "",
      technicianName: tech?.full_name ?? null, charges, refunds, payout: payout ?? null, extras, reschedules, evidence, disputes, review: review ?? null,
      conversationId: conversation?.id ?? null, messages, events, requestEvents, photos,
      access: access ?? null, rulesFileUrl: property?.gated_rules_file_id ? signedFileUrl(property.gated_rules_file_id, 900) : null,
    };
  });
}

export type ContractSnapshot = {
  acceptedAt: string;
  request: { code: string; title: string; description: string };
  provider: { id: string; name: string };
  quote: { id: string; mode: string; scope: string; exclusions: string; materialsIncluded: boolean; proposedDate: string | null; proposedWindow: string | null; validUntil: string };
  items: { kind: string; description: string; quantity: number; unit_price_minor: number; amount_minor: number }[];
  amounts: {
    laborMinor: number; materialsMinor: number; visitMinor: number; subtotalMinor: number; clientFeeMinor: number; clientFeeTaxMinor: number;
    providerFeeMinor: number; totalMinor: number; providerNetMinor: number; providerRateBps: number; clientRateBps: number; clientFeeTaxBps: number;
  };
  cancellationTerms: string;
};

export function portfolioUrl(fileId: string) {
  return publicFileUrl(fileId);
}

/** Resumen financiero de un trabajo, consistente entre paneles. */
export function jobMoney(d: NonNullable<JobDetail>) {
  const approved = d.charges.filter((c) => ["approved", "partially_refunded", "refunded"].includes(c.status));
  const paid = approved.reduce((s, c) => s + c.amount_minor, 0);
  const refunded = approved.reduce((s, c) => s + c.refunded_minor, 0);
  const acceptedExtras = d.extras.filter((e) => e.status === "accepted").reduce((s, e) => s + e.total_minor, 0);
  const agreed = d.job.total_minor + acceptedExtras;
  const pending = d.charges.filter((c) => c.status === "pending" || c.status === "processing").reduce((s, c) => s + c.amount_minor, 0);
  const grossProvider = approved.reduce((s, c) => s + c.provider_net_minor + c.provider_fee_minor, 0);
  const providerFees = approved.reduce((s, c) => s + c.provider_fee_minor, 0);
  return { agreed, paid, refunded, pending, balance: Math.max(agreed - paid, 0), grossProvider, providerFees, providerNet: grossProvider - providerFees };
}
