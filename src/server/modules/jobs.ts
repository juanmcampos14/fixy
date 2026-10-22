/** Órdenes de trabajo: confirmación, ejecución, evidencias, adicionales, reprogramaciones, cierre y cancelación. */
import { maskContactInfo } from "@/server/domain/contact-guard";
import { rateLimit } from "@/server/rate-limit";
import { z } from "zod";
import type { Tx } from "@/server/db/client";
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { audit, recordEvent } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { computeBreakdown } from "@/server/domain/money";
import { assertTransition, jobMachine, type ActorSide, type JobStatus } from "@/server/domain/state-machines";
import { jobStatusLabel } from "@/server/domain/labels";
import { clientRecipients, notify, providerRecipients, staffRecipients } from "@/server/notifications";
import { storeFile } from "@/server/storage";
import { check, providerRole } from "./authz";
import { createCharge, createPayoutForJob, drainPaymentCommands, payLink, refundChargeTx, type ChargeRow } from "./payments";
import { formatMoney, formatDate } from "@/lib/format";

type JobRow = {
  id: string;
  code: string;
  request_id: string;
  provider_id: string;
  client_user_id: string;
  assigned_user_id: string | null;
  status: JobStatus;
  mode: string;
  scheduled_date: string | null;
  scheduled_window: string | null;
  contract_snapshot: { amounts: { providerRateBps: number; clientRateBps: number; clientFeeTaxBps: number } };
};

async function loadJob(tx: Tx, jobId: string): Promise<JobRow> {
  const [j] = await tx<JobRow[]>`select * from jobs where id = ${jobId} for update`;
  if (!j) throw notFound("Trabajo inexistente.");
  return j;
}

/** Lado desde el que actúa el usuario en este trabajo (decidido por el servidor, nunca por el navegador). */
export async function jobSide(tx: Tx, actor: Actor, job: JobRow): Promise<ActorSide | null> {
  const role = await providerRole(tx, actor, job.provider_id);
  if (role === "admin") return "provider";
  if (role === "technician" && job.assigned_user_id === actor.id) return "technician";
  if (await check(tx, "is_job_client", actor, job.id)) return "client";
  if (can(actor, "trabajos", "manage")) return "staff";
  return null;
}

async function requireSide(tx: Tx, actor: Actor, job: JobRow, allowed: ActorSide[]) {
  const side = await jobSide(tx, actor, job);
  if (!side || !allowed.includes(side)) throw forbidden();
  return side;
}

async function moveJob(tx: Tx, job: JobRow, to: JobStatus, side: ActorSide, actor: Actor, reason?: string | null, data: Record<string, unknown> = {}) {
  assertTransition(jobMachine, job.status, to, side);
  const ts: Partial<Record<JobStatus, string>> = {
    confirmed: "confirmed_at",
    in_progress: "started_at",
    pending_approval: "finished_at",
    completed: "completed_at",
    cancelled: "cancelled_at",
  };
  const col = ts[to];
  await tx`update jobs set status = ${to} ${col ? tx`, ${tx(col)} = coalesce(${tx(col)}, now())` : tx``} where id = ${job.id}`;
  await recordEvent(tx, { entityType: "job", entityId: job.id, action: "status", from: job.status, to, actorId: actor.id, actorRole: side, reason: reason ?? null, data });
  const from = job.status;
  job.status = to;
  return from;
}

async function notifyBoth(tx: Tx, job: JobRow, title: string, body = "", opts: { client?: boolean; provider?: boolean } = {}) {
  if (opts.client !== false)
    await notify(tx, await clientRecipients(tx, job.request_id), { type: "job_status", title: `${title} · ${job.code}`, body, link: `/app/trabajos/${job.id}` });
  if (opts.provider !== false)
    await notify(tx, await providerRecipients(tx, job.provider_id, job.assigned_user_id), { type: "job_status", title: `${title} · ${job.code}`, body, link: `/proveedor/trabajos/${job.id}` });
}

async function initialChargeApproved(tx: Tx, jobId: string) {
  const [c] = await tx<{ n: number }[]>`
    select count(*)::int as n from charges where job_id = ${jobId} and kind in ('visit','job_total','deposit') and status = 'approved'`;
  return c.n > 0;
}

export async function confirmJob(actor: Actor, jobId: string) {
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    const side = await requireSide(tx, actor, job, ["provider"]);
    const [{ total }] = await tx<{ total: number }[]>`select total_minor as total from jobs where id = ${jobId}`;
    if (total > 0 && !(await initialChargeApproved(tx, jobId))) throw invalid("Todavía no se registró el pago del cliente. Vas a poder confirmar cuando esté aprobado.");
    const [{ status }] = await tx<{ status: string }[]>`select status from providers where id = ${job.provider_id}`;
    if (status !== "approved") throw invalid("Tu cuenta no está habilitada para tomar trabajos.");
    await moveJob(tx, job, "confirmed", side, actor);
    await notifyBoth(tx, job, "El profesional confirmó el trabajo", job.scheduled_date ? `Fecha acordada: ${formatDate(job.scheduled_date)}${job.scheduled_window ? ` · ${job.scheduled_window}` : ""}.` : "", { provider: false });
  });
}

export async function assignTechnician(actor: Actor, jobId: string, userId: string | null) {
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    await requireSide(tx, actor, job, ["provider"]);
    if (["completed", "cancelled"].includes(job.status)) throw invalid("El trabajo ya está cerrado.");
    if (userId) {
      const [m] = await tx<{ role: string }[]>`select role from provider_members where provider_id = ${job.provider_id} and user_id = ${userId} and active`;
      if (!m) throw invalid("Esa persona no es parte de tu equipo.");
    }
    await tx`update jobs set assigned_user_id = ${userId} where id = ${jobId}`;
    await recordEvent(tx, { entityType: "job", entityId: jobId, action: "technician_assigned", actorId: actor.id, data: { userId } });
    if (userId) await notify(tx, [userId], { type: "job_status", title: `Te asignaron un trabajo · ${job.code}`, link: `/proveedor/trabajos/${jobId}` });
  });
}

export async function markOnTheWay(actor: Actor, jobId: string) {
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    const side = await requireSide(tx, actor, job, ["provider", "technician"]);
    await moveJob(tx, job, "on_the_way", side, actor);
    await notifyBoth(tx, job, "El profesional está en camino", "", { provider: false });
  });
}

/** Inicio en el lugar. Con código de visita: el cliente se lo dicta al profesional al llegar (registra la visita). */
export async function startJob(actor: Actor, jobId: string, visitCode?: string) {
  // El código de visita tiene 4 dígitos: con pocos intentos por trabajo no se puede adivinar sin el cliente presente.
  await rateLimit(`visit-code:${jobId}`, 6, 900);
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    const side = await requireSide(tx, actor, job, ["provider", "technician"]);
    const [j] = await tx<{ visit_code: string | null }[]>`select visit_code from jobs where id = ${jobId}`;
    if (j.visit_code && (visitCode ?? "").trim() !== j.visit_code) throw invalid("El código de visita no coincide. Pedíselo al cliente: lo ve en el detalle del trabajo en Fixy.");
    await moveJob(tx, job, "in_progress", side, actor);
    await tx`update jobs set checked_in_at = coalesce(checked_in_at, now()) where id = ${jobId}`;
    await notifyBoth(tx, job, "El profesional llegó y comenzó la visita", "", { provider: false });
  });
}

export async function addEvidence(actor: Actor, jobId: string, input: { kind: "before" | "progress" | "after" | "note"; note: string }, file?: { data: Buffer; name: string }) {
  if (!file && input.note.trim().length < 2) throw invalid("Agregá una foto o una nota.");
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    await requireSide(tx, actor, job, ["provider", "technician"]);
    if (!["confirmed", "on_the_way", "in_progress", "pending_approval"].includes(job.status)) throw invalid("Solo se registran avances en trabajos activos.");
    const fileId = file ? await storeFile(tx, { data: file.data, originalName: file.name, uploadedBy: actor.id, purpose: "job_evidence", ownerType: "job", ownerId: jobId, allowPdf: false }) : null;
    await tx`insert into job_evidence (job_id, file_id, kind, note, created_by) values (${jobId}, ${fileId}, ${input.kind}, ${input.note.trim().slice(0, 1000)}, ${actor.id})`;
    await recordEvent(tx, { entityType: "job", entityId: jobId, action: "evidence_added", actorId: actor.id, data: { kind: input.kind } });
    await notify(tx, await clientRecipients(tx, job.request_id), { type: "job_status", title: `Nuevo avance registrado · ${job.code}`, link: `/app/trabajos/${jobId}`, email: false });
  });
}

/** Varias fotos de una vez (con la misma nota y momento): un solo aviso al cliente. */
export async function addEvidenceBatch(actor: Actor, jobId: string, input: { kind: "before" | "progress" | "after" | "note"; note: string }, photos: { data: Buffer; name: string }[]) {
  if (!photos.length && input.note.trim().length < 2) throw invalid("Agregá fotos o una nota.");
  if (photos.length > 10) throw invalid("Podés subir hasta 10 fotos por vez.");
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    await requireSide(tx, actor, job, ["provider", "technician"]);
    if (!["confirmed", "on_the_way", "in_progress", "pending_approval"].includes(job.status)) throw invalid("Solo se registran avances en trabajos activos.");
    const note = maskContactInfo(input.note.trim().slice(0, 1000)).text;
    const entries = photos.length ? photos : [null];
    for (const [i, file] of entries.entries()) {
      const fileId = file ? await storeFile(tx, { data: file.data, originalName: file.name, uploadedBy: actor.id, purpose: "job_evidence", ownerType: "job", ownerId: jobId, allowPdf: false }) : null;
      await tx`insert into job_evidence (job_id, file_id, kind, note, created_by) values (${jobId}, ${fileId}, ${input.kind}, ${i === 0 ? note : ""}, ${actor.id})`;
    }
    await recordEvent(tx, { entityType: "job", entityId: jobId, action: "evidence_added", actorId: actor.id, data: { kind: input.kind, photos: photos.length } });
    await notify(tx, await clientRecipients(tx, job.request_id), {
      type: "job_status", title: photos.length > 1 ? `${photos.length} fotos nuevas del trabajo · ${job.code}` : `Nuevo avance registrado · ${job.code}`, link: `/app/trabajos/${jobId}`, email: false,
    });
  });
}

/**
 * Fotos del trabajo que el profesional mandó por WhatsApp (ya guardadas y privadas): se suman como avances.
 * Solo fotos de ese mismo número que todavía no se usaron.
 */
export async function addEvidenceFromWhatsApp(actor: Actor, jobId: string, kind: "before" | "progress" | "after", phone: string, fileIds: string[]) {
  if (!fileIds.length) return 0;
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    await requireSide(tx, actor, job, ["provider", "technician"]);
    if (!["confirmed", "on_the_way", "in_progress", "pending_approval"].includes(job.status)) throw invalid("Ese trabajo ya no admite avances.");
    const media = await tx<{ id: number; file_id: string }[]>`
      select id, file_id from whatsapp_media where phone = ${phone} and request_id is null and file_id in ${tx(fileIds.slice(0, 10))}`;
    for (const m of media) {
      await tx`update files set purpose = 'job_evidence', owner_type = 'job', owner_id = ${jobId} where id = ${m.file_id} and owner_id is null`;
      await tx`insert into job_evidence (job_id, file_id, kind, note, created_by) values (${jobId}, ${m.file_id}, ${kind}, '', ${actor.id})`;
      await tx`update whatsapp_media set request_id = ${job.request_id} where id = ${m.id}`;
    }
    if (media.length) {
      await recordEvent(tx, { entityType: "job", entityId: jobId, action: "evidence_added", actorId: actor.id, data: { kind, photos: media.length, channel: "whatsapp" } });
      await notify(tx, await clientRecipients(tx, job.request_id), {
        type: "job_status", title: media.length > 1 ? `${media.length} fotos nuevas del trabajo · ${job.code}` : `Nuevo avance registrado · ${job.code}`, link: `/app/trabajos/${jobId}`, email: false,
      });
    }
    return media.length;
  });
}

export async function finishJob(actor: Actor, jobId: string, note: string) {
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    const side = await requireSide(tx, actor, job, ["provider", "technician"]);
    const [{ open }] = await tx<{ open: number }[]>`select count(*)::int as open from job_extras where job_id = ${jobId} and status = 'proposed'`;
    if (open > 0) throw invalid("Hay un adicional pendiente de respuesta del cliente. Retiralo o esperá la respuesta.");
    await moveJob(tx, job, "pending_approval", side, actor, note || null);
    await notify(tx, await clientRecipients(tx, job.request_id), {
      type: "job_finished",
      title: `El profesional informó que terminó · ${job.code}`,
      body: "Revisá el trabajo y confirmá tu conformidad, o contanos si algo no quedó bien.",
      link: `/app/trabajos/${jobId}`,
    });
  });
}

/** Conformidad del cliente: completa el trabajo y genera la liquidación pendiente (no implica liquidación realizada). */
export async function approveJob(actor: Actor, jobId: string) {
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    const side = await requireSide(tx, actor, job, ["client", "staff"]);
    const [{ open }] = await tx<{ open: number }[]>`select count(*)::int as open from disputes where job_id = ${jobId} and status in ('open','in_review','awaiting_response')`;
    if (open > 0 && side === "client") throw invalid("Hay un reclamo abierto. El equipo de Fixy lo resolverá antes de cerrar el trabajo.");
    const [{ unpaid }] = await tx<{ unpaid: number }[]>`
      select count(*)::int as unpaid from job_extras e where e.job_id = ${jobId} and e.status = 'accepted' and e.total_minor > 0
      and not exists (select 1 from charges c where c.extra_id = e.id and c.status in ('approved','partially_refunded','refunded'))`;
    if (unpaid > 0) throw invalid("Hay un adicional aceptado pendiente de pago.");
    await moveJob(tx, job, "completed", side, actor);
    await createPayoutForJob(tx, jobId);
    await notifyBoth(tx, job, "Trabajo completado", "¡Gracias por confirmar! Ya podés dejar una reseña.", { provider: false });
    await notify(tx, await providerRecipients(tx, job.provider_id, job.assigned_user_id), {
      type: "job_status",
      title: `El cliente dio conformidad · ${job.code}`,
      body: "La liquidación quedó pendiente. Podés seguirla en Cobros.",
      link: `/proveedor/trabajos/${jobId}`,
    });
  });
}

/**
 * Cancelación. Cliente o proveedor: solo antes de la confirmación (reintegro total automático de lo cobrado).
 * Operación: en cualquier estado no cerrado, con motivo; el reembolso se decide aparte y queda auditado.
 */
export async function cancelJob(actor: Actor, jobId: string, reason: string, opts: { refundAll?: boolean; asStaff?: boolean } = {}) {
  if (!reason || reason.trim().length < 5) throw invalid("Indicá el motivo de la cancelación.");
  await systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    // Desde el panel de operación se actúa siempre como equipo Fixy, aunque el usuario también sea parte del trabajo.
    const side = opts.asStaff && can(actor, "trabajos", "manage") ? "staff" : await requireSide(tx, actor, job, ["client", "provider", "staff"]);
    await moveJob(tx, job, "cancelled", side, actor, reason);
    await tx`update jobs set cancel_reason = ${reason}, cancelled_by = ${actor.id} where id = ${jobId}`;
    await tx`update job_extras set status = 'withdrawn', decided_at = now() where job_id = ${jobId} and status = 'proposed'`;
    // Cobros pendientes: quedan fallidos. Si el cliente igual llega a pagar el link viejo, el pago se detecta como
    // huérfano y se devuelve completo (applyGatewayPayment → refundOrphanPayment).
    const pending = await tx<{ id: string }[]>`select id from charges where job_id = ${jobId} and status in ('pending','processing')`;
    for (const c of pending) {
      await tx`update charges set status = 'failed', failure_reason = 'Trabajo cancelado' where id = ${c.id}`;
    }
    const refundAll = side !== "staff" || opts.refundAll === true;
    if (refundAll) {
      const approved = await tx<ChargeRow[]>`select * from charges where job_id = ${jobId} and status in ('approved','partially_refunded')`;
      for (const c of approved) {
        await refundChargeTx(tx, actor, { chargeId: c.id, amountMinor: c.amount_minor - c.refunded_minor, reason: `Cancelación: ${reason}` });
      }
    }
    if (side === "staff") await audit(tx, actor, "job.cancel", "job", jobId, reason, { refundAll });
    await notifyBoth(tx, job, "Trabajo cancelado", reason);
  });
  // Los reembolsos se piden a la pasarela después del commit.
  await drainPaymentCommands();
}

// ───────────────────────── Adicionales ─────────────────────────

export const extraSchema = z.object({
  description: z.string().trim().min(5, "Describí el adicional.").max(2000),
  reason: z.string().trim().min(5, "Explicá por qué es necesario.").max(1000),
  laborMinor: z.coerce.number().int().min(0),
  materialsMinor: z.coerce.number().int().min(0),
  /** Presupuesto del arreglo tras la visita (descuenta la visita si el profesional lo ofrece). */
  isMainQuote: z.boolean().optional().default(false),
});

/** Descuento de la visita aplicable al presupuesto del arreglo (solo una vez, si se pagó y el profesional lo ofrece). */
export async function visitCreditFor(db: Tx, jobId: string): Promise<number> {
  const [r] = await db<{ credit: number }[]>`
    select case when p.visit_fee_credited and j.mode = 'diagnostic'
        and not exists (select 1 from job_extras e where e.job_id = j.id and e.is_main_quote and e.status in ('proposed','accepted'))
      then coalesce((j.contract_snapshot->'amounts'->>'subtotalMinor')::bigint, 0) else 0 end as credit
    from jobs j join providers p on p.id = j.provider_id where j.id = ${jobId}`;
  return r?.credit ?? 0;
}

/** El proveedor propone un adicional. Usa las mismas tasas contratadas. Requiere aceptación explícita del cliente. */
export async function proposeExtra(actor: Actor, jobId: string, input: z.input<typeof extraSchema>) {
  const d = extraSchema.parse(input);
  if (d.laborMinor + d.materialsMinor <= 0) throw invalid("El importe debe ser mayor a cero.");
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    await requireSide(tx, actor, job, ["provider"]);
    if (!["confirmed", "on_the_way", "in_progress"].includes(job.status)) throw invalid("Solo se proponen adicionales en trabajos confirmados y en curso.");
    const a = job.contract_snapshot.amounts;
    const discount = d.isMainQuote ? Math.min(await visitCreditFor(tx, jobId), d.laborMinor + d.materialsMinor) : 0;
    const b = computeBreakdown(
      { laborMinor: d.laborMinor + d.materialsMinor - discount, materialsMinor: 0, visitMinor: 0 },
      { providerRateBps: a.providerRateBps, clientRateBps: a.clientRateBps, clientFeeTaxBps: a.clientFeeTaxBps },
    );
    const [e] = await tx<{ id: string }[]>`
      insert into job_extras (job_id, description, reason, labor_minor, materials_minor, discount_minor, is_main_quote, subtotal_minor, client_fee_minor, client_fee_tax_minor,
        provider_fee_minor, total_minor, provider_net_minor, proposed_by)
      values (${jobId}, ${d.description}, ${d.reason}, ${d.laborMinor}, ${d.materialsMinor}, ${discount}, ${d.isMainQuote}, ${b.subtotalMinor}, ${b.clientFeeMinor},
        ${b.clientFeeTaxMinor}, ${b.providerFeeMinor}, ${b.totalMinor}, ${b.providerNetMinor}, ${actor.id})
      returning id`;
    await recordEvent(tx, { entityType: "job", entityId: jobId, action: "extra_proposed", actorId: actor.id, data: { extraId: e.id, totalMinor: b.totalMinor } });
    await notify(tx, await clientRecipients(tx, job.request_id), {
      type: "extra",
      title: d.isMainQuote ? `Presupuesto del arreglo para aprobar · ${job.code}` : `Adicional para aprobar · ${job.code}`,
      body: `${d.description} — ${formatMoney(b.totalMinor)} en total. No se cobra hasta que lo aceptes.`,
      link: `/app/trabajos/${jobId}`,
    });
    return e.id;
  });
}

export async function decideExtra(actor: Actor, extraId: string, decision: "accepted" | "rejected", note: string, confirmTotalMinor?: number) {
  return systemTx(async (tx) => {
    const [e] = await tx<{ id: string; job_id: string; status: string; total_minor: number; client_fee_minor: number; client_fee_tax_minor: number; provider_fee_minor: number; provider_net_minor: number; description: string }[]>`
      select * from job_extras where id = ${extraId} for update`;
    if (!e) throw notFound();
    const job = await loadJob(tx, e.job_id);
    await requireSide(tx, actor, job, ["client"]);
    if (e.status !== "proposed") throw invalid("Este adicional ya fue respondido.");
    if (decision === "accepted" && confirmTotalMinor !== e.total_minor) throw invalid("El total del adicional no coincide. Revisalo antes de aceptar.");
    if (["completed", "cancelled"].includes(job.status)) throw invalid("El trabajo ya está cerrado.");
    await tx`update job_extras set status = ${decision}, decided_by = ${actor.id}, decided_at = now(), decision_note = ${note || null} where id = ${extraId}`;
    await recordEvent(tx, { entityType: "job", entityId: job.id, action: `extra_${decision}`, actorId: actor.id, reason: note || null, data: { extraId } });
    let checkoutUrl: string | null = null;
    if (decision === "accepted" && e.total_minor > 0) {
      const [prov] = await tx<{ payout_account_ref: string | null }[]>`select payout_account_ref from providers where id = ${job.provider_id}`;
      const c = await createCharge(tx, {
        jobId: job.id,
        extraId,
        kind: "extra",
        amountMinor: e.total_minor,
        clientFeeMinor: e.client_fee_minor,
        taxMinor: e.client_fee_tax_minor,
        providerFeeMinor: e.provider_fee_minor,
        providerNetMinor: e.provider_net_minor,
        payerUserId: actor.id,
        description: `Adicional ${job.code}: ${e.description.slice(0, 60)}`,
        payoutAccountRef: prov.payout_account_ref,
      });
      checkoutUrl = payLink(c.id);
    }
    await notify(tx, await providerRecipients(tx, job.provider_id, job.assigned_user_id), {
      type: "extra",
      title: decision === "accepted" ? `El cliente aceptó el adicional · ${job.code}` : `El cliente rechazó el adicional · ${job.code}`,
      body: note || "",
      link: `/proveedor/trabajos/${job.id}`,
    });
    return { checkoutUrl };
  });
}

export async function withdrawExtra(actor: Actor, extraId: string) {
  return systemTx(async (tx) => {
    const [e] = await tx<{ job_id: string; status: string }[]>`select job_id, status from job_extras where id = ${extraId} for update`;
    if (!e) throw notFound();
    const job = await loadJob(tx, e.job_id);
    await requireSide(tx, actor, job, ["provider"]);
    if (e.status !== "proposed") throw invalid("Solo se retiran adicionales pendientes.");
    await tx`update job_extras set status = 'withdrawn', decided_at = now() where id = ${extraId}`;
    await recordEvent(tx, { entityType: "job", entityId: job.id, action: "extra_withdrawn", actorId: actor.id, data: { extraId } });
  });
}

// ───────────────────────── Reprogramaciones ─────────────────────────

export async function proposeReschedule(actor: Actor, jobId: string, input: { newDate: string; newWindow: string; reason: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.newDate)) throw invalid("Fecha inválida.");
  if (input.reason.trim().length < 3) throw invalid("Indicá el motivo.");
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    const side = await requireSide(tx, actor, job, ["client", "provider"]);
    if (!["pending_confirmation", "confirmed", "on_the_way"].includes(job.status)) throw invalid("El trabajo ya no admite reprogramaciones.");
    await tx`insert into job_reschedules (job_id, proposed_by, proposed_side, previous_date, previous_window, new_date, new_window, reason)
      values (${jobId}, ${actor.id}, ${side}, ${job.scheduled_date}, ${job.scheduled_window}, ${input.newDate}, ${input.newWindow || null}, ${input.reason})`;
    await recordEvent(tx, { entityType: "job", entityId: jobId, action: "reschedule_proposed", actorId: actor.id, reason: input.reason, data: { newDate: input.newDate } });
    const title = `Propuesta de reprogramación · ${job.code}`;
    const body = `Nueva fecha propuesta: ${formatDate(input.newDate)}${input.newWindow ? ` · ${input.newWindow}` : ""}.`;
    if (side === "client") await notify(tx, await providerRecipients(tx, job.provider_id, job.assigned_user_id), { type: "reschedule", title, body, link: `/proveedor/trabajos/${jobId}` });
    else await notify(tx, await clientRecipients(tx, job.request_id), { type: "reschedule", title, body, link: `/app/trabajos/${jobId}` });
  }).catch((e) => {
    if ((e as { code?: string }).code === "23505") throw invalid("Ya hay una reprogramación pendiente de respuesta.");
    throw e;
  });
}

export async function decideReschedule(actor: Actor, rescheduleId: string, decision: "accepted" | "rejected" | "withdrawn") {
  return systemTx(async (tx) => {
    const [r] = await tx<{ id: string; job_id: string; proposed_side: string; status: string; new_date: string; new_window: string | null }[]>`
      select * from job_reschedules where id = ${rescheduleId} for update`;
    if (!r || r.status !== "proposed") throw invalid("Esta propuesta ya no está pendiente.");
    const job = await loadJob(tx, r.job_id);
    const side = await requireSide(tx, actor, job, ["client", "provider"]);
    // Acuerdo: acepta o rechaza la otra parte; quien propuso solo puede retirar.
    if (decision === "withdrawn" ? side !== r.proposed_side : side === r.proposed_side) throw forbidden();
    await tx`update job_reschedules set status = ${decision}, decided_by = ${actor.id}, decided_at = now() where id = ${rescheduleId}`;
    if (decision === "accepted") {
      await tx`update jobs set scheduled_date = ${r.new_date}, scheduled_window = ${r.new_window} where id = ${job.id}`;
    }
    await recordEvent(tx, { entityType: "job", entityId: job.id, action: `reschedule_${decision}`, actorId: actor.id, data: { newDate: r.new_date } });
    await notifyBoth(tx, job, decision === "accepted" ? "Reprogramación acordada" : "Reprogramación no aceptada", decision === "accepted" ? `Nueva fecha: ${formatDate(r.new_date)}.` : "");
  });
}

// ───────────────────────── Operación ─────────────────────────

/** Intervención de operación sobre el estado (ej.: volver a ejecución tras un reclamo). Siempre con motivo y auditoría. */
export async function operatorMoveJob(actor: Actor, jobId: string, to: JobStatus, reason: string) {
  if (!can(actor, "trabajos", "manage")) throw forbidden();
  if (!reason || reason.trim().length < 5) throw invalid("Indicá el motivo.");
  return systemTx(async (tx) => {
    const job = await loadJob(tx, jobId);
    const from = await moveJob(tx, job, to, "staff", actor, reason);
    if (to === "completed") await createPayoutForJob(tx, jobId);
    await audit(tx, actor, "job.operator_move", "job", jobId, reason, { from, to });
    await notifyBoth(tx, job, `Actualización del equipo de Fixy: ${jobStatusLabel[to]}`, reason);
  });
}

export async function alertStaffAboutJob(tx: Tx, jobId: string, title: string) {
  await notify(tx, await staffRecipients(tx), { type: "job_status", title, link: `/admin/trabajos/${jobId}`, email: false });
}
