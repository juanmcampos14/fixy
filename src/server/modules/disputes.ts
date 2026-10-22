/** Reclamos y reseñas. */
import { randomInt } from "node:crypto";
import { z } from "zod";
import { systemTx, type Db } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { audit, recordEvent } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { assertTransition, disputeMachine, type DisputeStatus } from "@/server/domain/state-machines";
import { clientRecipients, notify, providerRecipients, staffRecipients } from "@/server/notifications";
import { storeFile } from "@/server/storage";
import { check, providerRole } from "./authz";
import { refundChargeTx, type ChargeRow } from "./payments";

export const disputeSchema = z.object({
  reasonCode: z.enum(["incomplete", "quality", "damage", "no_show", "price", "behavior", "other"]),
  description: z.string().trim().min(10, "Contanos qué pasó (mínimo 10 caracteres).").max(4000),
});

const DISPUTE_WINDOW_DAYS = 15;

export async function openDispute(actor: Actor, jobId: string, input: z.infer<typeof disputeSchema>, file?: { data: Buffer; name: string }) {
  const d = disputeSchema.parse(input);
  return systemTx(async (tx) => {
    const [job] = await tx<{ id: string; code: string; status: string; request_id: string; provider_id: string; completed_at: Date | null }[]>`
      select id, code, status, request_id, provider_id, completed_at from jobs where id = ${jobId} for update`;
    if (!job) throw notFound();
    const isClient = await check(tx, "is_job_client", actor, jobId);
    const isProvider = (await providerRole(tx, actor, job.provider_id)) === "admin";
    if (!isClient && !isProvider) throw forbidden();
    if (job.status === "pending_confirmation") throw invalid("Antes de la confirmación podés cancelar el trabajo directamente.");
    if (job.status === "completed" && job.completed_at && Date.now() - new Date(job.completed_at).getTime() > DISPUTE_WINDOW_DAYS * 86400_000) {
      throw invalid(`Los reclamos se pueden abrir hasta ${DISPUTE_WINDOW_DAYS} días después de completado el trabajo. Escribinos desde Ayuda.`);
    }
    const [dispute] = await tx<{ id: string }[]>`
      insert into disputes (job_id, opened_by, opened_side, reason_code, description)
      values (${jobId}, ${actor.id}, ${isClient ? "client" : "provider"}, ${d.reasonCode}, ${d.description})
      returning id`.catch((e) => {
      if (e.code === "23505") throw invalid("Ya hay un reclamo abierto para este trabajo.");
      throw e;
    });
    if (file) {
      const fileId = await storeFile(tx, { data: file.data, originalName: file.name, uploadedBy: actor.id, purpose: "dispute_evidence", ownerType: "dispute", ownerId: dispute.id });
      await tx`insert into dispute_messages (dispute_id, author_id, author_side, body, file_id) values (${dispute.id}, ${actor.id}, ${isClient ? "client" : "provider"}, 'Evidencia adjunta', ${fileId})`;
    }
    // Pausa de liquidación mientras se revisa (si existe y no fue pagada).
    await tx`update payouts set on_hold = true, hold_reason = 'Reclamo abierto' where job_id = ${jobId} and status in ('pending','scheduled','failed')`;
    await recordEvent(tx, { entityType: "dispute", entityId: dispute.id, action: "opened", to: "open", actorId: actor.id });
    await recordEvent(tx, { entityType: "job", entityId: jobId, action: "dispute_opened", actorId: actor.id, data: { disputeId: dispute.id } });
    await notify(tx, await staffRecipients(tx), { type: "dispute", title: `Nuevo reclamo · ${job.code}`, link: `/admin/reclamos/${dispute.id}` });
    const other = isClient ? await providerRecipients(tx, job.provider_id) : await clientRecipients(tx, job.request_id);
    await notify(tx, other, {
      type: "dispute",
      title: `Se abrió un reclamo · ${job.code}`,
      body: "El equipo de Fixy va a revisar el caso. Podés responder desde el detalle.",
      link: isClient ? `/proveedor/reclamos/${dispute.id}` : `/app/reclamos/${dispute.id}`,
    });
    return dispute.id;
  });
}

export async function replyDispute(actor: Actor, disputeId: string, body: string, opts: { internal?: boolean } = {}, file?: { data: Buffer; name: string }) {
  if (!body.trim()) throw invalid("Escribí una respuesta.");
  return systemTx(async (tx) => {
    const [d] = await tx<{ id: string; job_id: string; status: DisputeStatus }[]>`select id, job_id, status from disputes where id = ${disputeId} for update`;
    if (!d) throw notFound();
    const staff = can(actor, "reclamos", "manage");
    const [job] = await tx<{ provider_id: string; request_id: string; code: string }[]>`select provider_id, request_id, code from jobs where id = ${d.job_id}`;
    const isClient = await check(tx, "is_job_client", actor, d.job_id);
    const isProvider = (await providerRole(tx, actor, job.provider_id)) === "admin";
    if (!staff && !isClient && !isProvider) throw forbidden();
    if (opts.internal && !staff) throw forbidden();
    if (d.status === "closed") throw invalid("El reclamo está cerrado.");
    const side = isClient ? "client" : isProvider ? "provider" : "platform";
    const fileId = file ? await storeFile(tx, { data: file.data, originalName: file.name, uploadedBy: actor.id, purpose: "dispute_evidence", ownerType: "dispute", ownerId: disputeId }) : null;
    await tx`insert into dispute_messages (dispute_id, author_id, author_side, body, file_id, internal)
      values (${disputeId}, ${actor.id}, ${side}, ${body.trim()}, ${fileId}, ${!!opts.internal})`;
    if (!staff && d.status === "awaiting_response") {
      await tx`update disputes set status = 'in_review' where id = ${disputeId}`;
      await recordEvent(tx, { entityType: "dispute", entityId: disputeId, action: "status", from: d.status, to: "in_review", actorId: actor.id });
    }
    if (!opts.internal) {
      if (staff || isClient) await notify(tx, await providerRecipients(tx, job.provider_id), { type: "dispute", title: `Nueva respuesta en el reclamo · ${job.code}`, link: `/proveedor/reclamos/${disputeId}`, email: false });
      if (staff || isProvider) await notify(tx, await clientRecipients(tx, job.request_id), { type: "dispute", title: `Nueva respuesta en el reclamo · ${job.code}`, link: `/app/reclamos/${disputeId}`, email: false });
      if (!staff) await notify(tx, await staffRecipients(tx), { type: "dispute", title: `Respuesta en reclamo · ${job.code}`, link: `/admin/reclamos/${disputeId}`, email: false });
    }
  });
}

export async function moveDispute(actor: Actor, disputeId: string, to: "in_review" | "awaiting_response" | "closed", note: string) {
  if (!can(actor, "reclamos", "manage")) throw forbidden();
  if (!note || note.trim().length < 3) throw invalid("Indicá el motivo.");
  return systemTx(async (tx) => {
    const [d] = await tx<{ status: DisputeStatus; job_id: string }[]>`select status, job_id from disputes where id = ${disputeId} for update`;
    if (!d) throw notFound();
    assertTransition(disputeMachine, d.status, to, "staff");
    await tx`update disputes set status = ${to}, assigned_to = coalesce(assigned_to, ${actor.id}) where id = ${disputeId}`;
    await recordEvent(tx, { entityType: "dispute", entityId: disputeId, action: "status", from: d.status, to, actorId: actor.id, actorRole: actor.platformRole, reason: note });
    await audit(tx, actor, `dispute.${to}`, "dispute", disputeId, note);
  });
}

export const resolutionSchema = z.object({
  resolution: z.enum(["no_action", "partial_refund", "full_refund", "redo_work", "provider_favor", "other"]),
  note: z.string().trim().min(10, "Explicá la resolución (mínimo 10 caracteres)."),
  refundMinor: z.coerce.number().int().min(0).default(0),
  completeJob: z.boolean().default(false),
});

/**
 * Resolución por operación. Reembolsos solo si la integración los soporta (en modo de prueba, simulados).
 * Libera la pausa de liquidación salvo que se haya devuelto el total.
 */
export async function resolveDispute(actor: Actor, disputeId: string, input: z.infer<typeof resolutionSchema>) {
  if (!can(actor, "reclamos", "manage")) throw forbidden();
  const d = resolutionSchema.parse(input);
  await systemTx(async (tx) => {
    const [disp] = await tx<{ status: DisputeStatus; job_id: string }[]>`select status, job_id from disputes where id = ${disputeId} for update`;
    if (!disp) throw notFound();
    assertTransition(disputeMachine, disp.status, "resolved", "staff");
    const [job] = await tx<{ id: string; code: string; status: string; request_id: string; provider_id: string }[]>`select id, code, status, request_id, provider_id from jobs where id = ${disp.job_id} for update`;

    if (d.resolution === "partial_refund" || d.resolution === "full_refund") {
      const charges = await tx<ChargeRow[]>`select * from charges where job_id = ${job.id} and status in ('approved','partially_refunded') order by created_at`;
      const refundable = charges.reduce((s, c) => s + c.amount_minor - c.refunded_minor, 0);
      let remaining = d.resolution === "full_refund" ? refundable : d.refundMinor;
      if (remaining <= 0) throw invalid("Indicá el importe a reembolsar.");
      if (remaining > refundable) throw invalid("El importe supera lo cobrado.");
      for (const c of charges) {
        if (remaining <= 0) break;
        const amt = Math.min(remaining, c.amount_minor - c.refunded_minor);
        await refundChargeTx(tx, actor, { chargeId: c.id, amountMinor: amt, reason: `Reclamo: ${d.note}`, disputeId });
        remaining -= amt;
      }
    }
    await tx`update disputes set status = 'resolved', resolution = ${d.resolution}, resolution_note = ${d.note}, resolved_by = ${actor.id}, resolved_at = now() where id = ${disputeId}`;
    await recordEvent(tx, { entityType: "dispute", entityId: disputeId, action: "status", from: disp.status, to: "resolved", actorId: actor.id, actorRole: actor.platformRole, reason: d.note, data: { resolution: d.resolution } });
    // El trabajo conserva su historial. Según la resolución, operación puede reabrirlo o completarlo.
    if (d.resolution === "redo_work" && job.status === "pending_approval") {
      await tx`update jobs set status = 'in_progress' where id = ${job.id}`;
      await recordEvent(tx, { entityType: "job", entityId: job.id, action: "status", from: "pending_approval", to: "in_progress", actorId: actor.id, actorRole: "staff", reason: "Resolución de reclamo: rehacer trabajo" });
    } else if (d.completeJob && job.status === "pending_approval") {
      await tx`update jobs set status = 'completed', completed_at = now() where id = ${job.id}`;
      await recordEvent(tx, { entityType: "job", entityId: job.id, action: "status", from: "pending_approval", to: "completed", actorId: actor.id, actorRole: "staff", reason: "Cierre por resolución de reclamo" });
      const { createPayoutForJob } = await import("./payments");
      await createPayoutForJob(tx, job.id);
    }
    if (d.resolution !== "full_refund") {
      await tx`update payouts set on_hold = false, hold_reason = null where job_id = ${job.id} and status in ('pending','scheduled','failed') and hold_reason = 'Reclamo abierto'`;
    }
    await audit(tx, actor, "dispute.resolve", "dispute", disputeId, d.note, { resolution: d.resolution, refundMinor: d.refundMinor });
    await notify(tx, [...(await clientRecipients(tx, job.request_id)), ...(await providerRecipients(tx, job.provider_id))], {
      type: "dispute",
      title: `Reclamo resuelto · ${job.code}`,
      body: d.note,
      link: `/app/trabajos/${job.id}`,
    });
  });
  // Los reembolsos decididos se piden a la pasarela después del commit.
  const { drainPaymentCommands } = await import("./payments");
  await drainPaymentCommands();
}

// ───────────────────────── Reseñas ─────────────────────────

export const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, "Elegí una calificación.").max(5),
  comment: z.string().trim().max(2000).default(""),
});

/** Demora de publicación: un plazo elegido al azar entre los configurados + variación aleatoria. */
export async function computeVisibleAt(db: Db, now = new Date()) {
  const rows = await db<{ key: string; value: unknown }[]>`
    select key, value from platform_settings where key in ('reviews.publish_delay_hours', 'reviews.publish_jitter_hours')`;
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const raw = get("reviews.publish_delay_hours");
  const delays = (Array.isArray(raw) ? raw : [48, 72, 168]).map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 24 * 60);
  const jitterHours = Math.min(72, Math.max(0, Number(get("reviews.publish_jitter_hours") ?? 12)));
  const baseHours = delays.length ? delays[randomInt(delays.length)] : 72;
  const extraMinutes = randomInt(Math.floor(jitterHours * 60) + 1);
  return new Date(now.getTime() + baseHours * 3600_000 + extraMinutes * 60_000);
}

/**
 * Reseña del cliente: obligatoria para liberar la liquidación. Se publica con demora aleatoria
 * y sin datos del cliente ni del trabajo, para que el profesional no pueda asociarla.
 */
export async function createReview(actor: Actor, jobId: string, input: z.infer<typeof reviewSchema>) {
  const d = reviewSchema.parse(input);
  return systemTx(async (tx) => {
    const [job] = await tx<{ status: string; client_user_id: string; provider_id: string; code: string }[]>`select status, client_user_id, provider_id, code from jobs where id = ${jobId}`;
    if (!job) throw notFound();
    if (!(await check(tx, "is_job_client", actor, jobId))) throw forbidden();
    if (job.status !== "completed") throw invalid("Podés calificar cuando el trabajo esté completado.");
    const visibleAt = await computeVisibleAt(tx);
    await tx`insert into reviews (job_id, client_user_id, provider_id, rating, comment, visible_at)
      values (${jobId}, ${job.client_user_id}, ${job.provider_id}, ${d.rating}, ${d.comment}, ${visibleAt})`.catch((e) => {
      if (e.code === "23505") throw invalid("Ya calificaste este trabajo.");
      throw e;
    });
    // Con la reseña, la liquidación queda en condiciones de liberarse (en el próximo ciclo de liquidaciones).
    await tx`update payouts set awaiting_review = false where job_id = ${jobId}`;
    await recordEvent(tx, { entityType: "job", entityId: jobId, action: "review_submitted", actorId: actor.id });
    // Al proveedor no se le avisa ahora: recibe un aviso agrupado cuando se publiquen sus reseñas.
  });
}

export async function replyReview(actor: Actor, reviewId: string, reply: string) {
  return systemTx(async (tx) => {
    const [r] = await tx<{ provider_id: string; provider_reply: string | null }[]>`select provider_id, provider_reply from reviews where id = ${reviewId}`;
    if (!r) throw notFound();
    if ((await providerRole(tx, actor, r.provider_id)) !== "admin") throw forbidden();
    const [{ visible }] = await tx<{ visible: boolean }[]>`select exists (select 1 from reviews_published where id = ${reviewId}) as visible`;
    if (!visible) throw notFound();
    if (r.provider_reply) throw invalid("Ya respondiste esta reseña.");
    await tx`update reviews set provider_reply = ${reply.trim().slice(0, 1000)} where id = ${reviewId}`;
  });
}

export async function hideReview(actor: Actor, reviewId: string, reason: string) {
  if (!can(actor, "reclamos", "manage")) throw forbidden();
  if (reason.trim().length < 5) throw invalid("Indicá el motivo.");
  return systemTx(async (tx) => {
    await tx`update reviews set hidden_at = now() where id = ${reviewId}`;
    await audit(tx, actor, "review.hide", "review", reviewId, reason);
  });
}

/**
 * Tarea periódica (cron): avisa a cada proveedor, de forma agrupada, cuando se publican reseñas nuevas,
 * y recuerda a los clientes que califiquen (necesario para liberar la liquidación).
 */
export async function processReviewTasks() {
  return systemTx(async (tx) => {
    const published = await tx<{ provider_id: string; n: number }[]>`
      with done as (
        update reviews set publish_notified = true where not publish_notified and visible_at <= now() and hidden_at is null
        returning provider_id)
      select provider_id, count(*)::int as n from done group by provider_id`;
    for (const p of published) {
      await notify(tx, await providerRecipients(tx, p.provider_id), {
        type: "review",
        title: p.n === 1 ? "Se publicó una reseña nueva" : `Se publicaron ${p.n} reseñas nuevas`,
        body: "Las reseñas son anónimas y se publican días después del trabajo.",
        link: "/proveedor/resenas",
      });
    }
    const [{ value: rawDays } = { value: [1, 3, 7] }] = await tx<{ value: unknown }[]>`select value from platform_settings where key = 'reviews.reminder_days'`;
    const days = (Array.isArray(rawDays) ? rawDays : [1, 3, 7]).map(Number).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    let reminders = 0;
    for (const [i, d] of days.entries()) {
      const due = await tx<{ id: string; code: string; request_id: string }[]>`
        update jobs set review_reminders = ${i + 1}
        where status = 'completed' and review_reminders = ${i} and completed_at <= now() - make_interval(days => ${d})
          and not exists (select 1 from reviews r where r.job_id = jobs.id)
          and not exists (select 1 from disputes x where x.job_id = jobs.id and x.status in ('open','in_review','awaiting_response'))
        returning id, code, request_id`;
      for (const j of due) {
        await notify(tx, await clientRecipients(tx, j.request_id), {
          type: "review",
          title: `¿Cómo te fue con el trabajo ${j.code}?`,
          body: "Tu reseña es necesaria para liberar el pago al profesional. Se publica sin tu nombre.",
          link: `/app/trabajos/${j.id}`,
        });
        reminders++;
      }
    }
    return { publishedProviders: published.length, reminders };
  });
}
