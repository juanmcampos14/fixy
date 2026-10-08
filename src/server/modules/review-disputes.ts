/**
 * Impugnación de reseñas.
 * Proveedor impugna (sin saber quién escribió la reseña) → la IA consulta al cliente → la IA evalúa
 * → se mantiene la reseña, el cliente la corrige/retira, o pasa a revisión humana (operación).
 * Las llamadas a la IA se hacen fuera de las transacciones; los cambios de estado se revalidan al aplicar.
 */
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import { sql, systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { isStaff } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { notify, providerRecipients, staffRecipients } from "@/server/notifications";
import { draftClientInquiry, evaluateDispute, REASON_LABEL, type MediationContext, type MediationDecision } from "@/server/assistant/review-mediator";
import { assertProviderAdmin } from "./authz";
import { getSetting } from "./catalog";
import { jobStatusLabel } from "@/server/domain/labels";

export { REASON_LABEL };

export const openSchema = z.object({
  reasonCode: z.enum(["false_facts", "not_my_job", "offensive", "personal_data", "extortion", "other"]),
  statement: z.string().trim().min(20, "Contá tu versión con un poco más de detalle (mínimo 20 caracteres).").max(3000),
});

type DisputeRow = {
  id: string; review_id: string; provider_id: string; reason_code: string; provider_statement: string; status: string;
  ai_rounds: number; client_deadline: Date; client_user_id: string; job_id: string;
};

async function loadDispute(db: Db, id: string, lock = false): Promise<DisputeRow | null> {
  const [d] = await db<DisputeRow[]>`
    select d.id, d.review_id, d.provider_id, d.reason_code, d.provider_statement, d.status, d.ai_rounds, d.client_deadline, r.client_user_id, r.job_id
    from review_disputes d join reviews r on r.id = d.review_id where d.id = ${id} ${lock ? db`for update of d` : db``}`;
  return d ?? null;
}

/** Contexto para la IA: reseña, trabajo, historial y conversación (sin datos de contacto). */
async function buildContext(db: Db, d: DisputeRow, clientResponded: boolean): Promise<MediationContext> {
  const [rv] = await db<{ rating: number; comment: string }[]>`select rating, comment from reviews where id = ${d.review_id}`;
  const [job] = await db<{ code: string; status: string; title: string; snap: { quote: { scope: string }; items: { description: string; quantity: number }[] }; completed_at: Date | null }[]>`
    select j.code, j.status, r.title, j.contract_snapshot as snap, j.completed_at from jobs j join service_requests r on r.id = j.request_id where j.id = ${d.job_id}`;
  const events = await db<{ action: string; to_state: string | null; created_at: Date }[]>`
    select action, to_state, created_at from entity_events where entity_type = 'job' and entity_id = ${d.job_id} order by id limit 40`;
  const extras = await db<{ description: string; status: string }[]>`select description, status from job_extras where job_id = ${d.job_id}`;
  const claims = await db<{ reason_code: string; status: string; resolution: string | null }[]>`select reason_code, status, resolution from disputes where job_id = ${d.job_id}`;
  const conv = await db<{ author: MediationContext["conversation"][number]["author"]; body: string }[]>`
    select author, body from review_dispute_messages where dispute_id = ${d.id} order by created_at`;
  const maxRounds = await getSetting<number>(db, "reviews.dispute_max_ai_rounds", 2);
  return {
    reasonCode: d.reason_code,
    providerStatement: d.provider_statement,
    review: rv,
    job: {
      code: job.code, title: job.title, status: job.status, scope: job.snap?.quote?.scope ?? "",
      items: (job.snap?.items ?? []).map((i) => `${i.description}${i.quantity > 1 ? ` x${i.quantity}` : ""}`),
      events: events.map((e) => `${e.action === "status" && e.to_state ? jobStatusLabel[e.to_state] ?? e.to_state : e.action} (${e.created_at.toISOString().slice(0, 10)})`),
      extras: extras.map((e) => `${e.description} [${e.status}]`),
      claims: claims.map((c) => `${c.reason_code} [${c.status}${c.resolution ? `: ${c.resolution}` : ""}]`),
      completedAt: job.completed_at?.toISOString() ?? null,
    },
    conversation: conv,
    round: d.ai_rounds + 1,
    maxRounds,
    clientResponded,
  };
}

/** El proveedor impugna una reseña publicada. No se le revela el autor en ningún momento. */
export async function openReviewDispute(actor: Actor, reviewId: string, input: z.infer<typeof openSchema>) {
  const data = openSchema.parse(input);
  const created = await systemTx(async (tx) => {
    const [rv] = await tx<{ provider_id: string; visible_at: Date }[]>`
      select r.provider_id, r.visible_at from reviews r where r.id = ${reviewId} and r.hidden_at is null and r.visible_at <= now()`;
    if (!rv) throw notFound("La reseña no existe o todavía no está publicada.");
    await assertProviderAdmin(tx, actor, rv.provider_id);
    const windowDays = await getSetting<number>(tx, "reviews.dispute_window_days", 30);
    if (Date.now() - rv.visible_at.getTime() > windowDays * 86400_000) throw invalid(`Las reseñas se pueden impugnar hasta ${windowDays} días después de publicadas.`);
    const clientDays = await getSetting<number>(tx, "reviews.dispute_client_days", 5);
    const [d] = await tx<{ id: string }[]>`
      insert into review_disputes (review_id, provider_id, opened_by, reason_code, provider_statement, client_deadline)
      values (${reviewId}, ${rv.provider_id}, ${actor.id}, ${data.reasonCode}, ${data.statement}, now() + make_interval(days => ${clientDays}))
      returning id`.catch((e) => {
      if (e.code === "23505") throw invalid("Esta reseña ya fue impugnada.");
      throw e;
    });
    await audit(tx, actor, "review_dispute.open", "review", reviewId, data.reasonCode, { disputeId: d.id });
    return d.id;
  });

  // Consulta al cliente redactada por la IA (fuera de la transacción).
  const d = (await loadDispute(sql(), created))!;
  const ctx = await buildContext(sql(), d, false);
  const inquiry = await draftClientInquiry(ctx);
  await systemTx(async (tx) => {
    await tx`insert into review_dispute_messages (dispute_id, author, body) values (${created}, 'ai', ${inquiry.message})`;
    await notify(tx, [d.client_user_id], {
      type: "review",
      title: "Queremos entender mejor tu reseña",
      body: "El profesional pidió revisarla. Contanos más: tu opinión es válida y podés mantenerla, corregirla o retirarla.",
      link: `/app/resenas/${created}`,
    });
    await notify(tx, await staffRecipients(tx), { type: "review", title: "Reseña impugnada (mediación con IA en curso)", link: `/admin/resenas/${created}`, email: false });
  });
  return created;
}

/** Aplica la decisión de la IA con revalidación de estado. */
async function applyDecision(disputeId: string, decision: MediationDecision, expectedStatus: string[]) {
  return systemTx(async (tx) => {
    const d = await loadDispute(tx, disputeId, true);
    if (!d || !expectedStatus.includes(d.status)) return;
    const decisionJson = tx.json({ ...decision } as never);
    if (decision.decision === "keep") {
      await tx`update review_disputes set status = 'resolved', resolution = 'kept', resolved_by_ai = true, resolved_at = now(),
        ai_rounds = ai_rounds + 1, ai_last_decision = ${decisionJson}, internal_summary = ${decision.internalSummary}, provider_summary = ${decision.providerSummary}
        where id = ${disputeId}`;
      await notifyResolution(tx, d, "kept", decision.providerSummary);
    } else if (decision.decision === "ask_more" && decision.clientMessage) {
      const clientDays = await getSetting<number>(tx, "reviews.dispute_client_days", 5);
      await tx`update review_disputes set status = 'awaiting_client', ai_rounds = ai_rounds + 1, ai_last_decision = ${decisionJson},
        internal_summary = ${decision.internalSummary}, client_deadline = now() + make_interval(days => ${clientDays}) where id = ${disputeId}`;
      await tx`insert into review_dispute_messages (dispute_id, author, body) values (${disputeId}, 'ai', ${decision.clientMessage})`;
      await notify(tx, [d.client_user_id], { type: "review", title: "Tenemos una pregunta más sobre tu reseña", link: `/app/resenas/${disputeId}` });
    } else {
      await tx`update review_disputes set status = 'escalated', ai_rounds = ai_rounds + 1, ai_last_decision = ${decisionJson},
        internal_summary = ${decision.internalSummary}, provider_summary = ${decision.providerSummary},
        escalation_reason = ${decision.policyFlags.length ? `Señales: ${decision.policyFlags.join(", ")}` : decision.internalSummary.slice(0, 300)}
        where id = ${disputeId}`;
      await notify(tx, await staffRecipients(tx), { type: "review", title: "Impugnación de reseña para revisión humana", body: decision.internalSummary.slice(0, 200), link: `/admin/resenas/${disputeId}` });
      await notify(tx, await providerRecipients(tx, d.provider_id), { type: "review", title: "Tu impugnación pasó a revisión del equipo", link: "/proveedor/resenas", email: false });
    }
    await audit(tx, null, `review_dispute.ai_${decision.decision}`, "review_dispute", disputeId, null, { confidence: decision.confidence, source: decision.source, flags: decision.policyFlags });
  });
}

async function notifyResolution(tx: Tx, d: DisputeRow, resolution: string, providerSummary: string | null) {
  const titles: Record<string, string> = {
    kept: "La reseña se mantiene",
    edited: "El cliente corrigió la reseña",
    withdrawn: "El cliente retiró la reseña",
    hidden: "La reseña fue ocultada por el equipo de Fixy",
    other: "Se resolvió tu impugnación",
  };
  await notify(tx, await providerRecipients(tx, d.provider_id), { type: "review", title: `Impugnación resuelta: ${titles[resolution] ?? "resuelta"}`, body: providerSummary ?? "", link: "/proveedor/resenas" });
  await notify(tx, [d.client_user_id], { type: "review", title: "Cerramos la revisión de tu reseña", body: "Gracias por responder.", link: `/app/resenas/${d.id}`, email: false });
}

async function assertReviewer(db: Db, actor: Actor, d: DisputeRow | null) {
  if (!d) throw notFound();
  if (d.client_user_id !== actor.id) throw forbidden();
}

/** Respuesta del cliente. Si la consulta está a cargo de la IA, la evalúa; si está con operación, solo se registra. */
export async function clientReply(actor: Actor, disputeId: string, body: string) {
  const text = body.trim();
  if (text.length < 2) throw invalid("Escribí tu respuesta.");
  const d = await loadDispute(sql(), disputeId);
  await assertReviewer(sql(), actor, d);
  if (!["awaiting_client", "escalated"].includes(d!.status)) throw invalid("Esta revisión ya está cerrada.");
  const toAi = d!.status === "awaiting_client";
  await systemTx(async (tx) => {
    const cur = await loadDispute(tx, disputeId, true);
    if (!cur || !["awaiting_client", "escalated"].includes(cur.status)) throw invalid("Esta revisión ya está cerrada.");
    await tx`insert into review_dispute_messages (dispute_id, author, author_id, body) values (${disputeId}, 'client', ${actor.id}, ${text.slice(0, 4000)})`;
    if (cur.status === "awaiting_client") await tx`update review_disputes set status = 'ai_review' where id = ${disputeId}`;
    else await notify(tx, await staffRecipients(tx), { type: "review", title: "El cliente respondió en una revisión de reseña", link: `/admin/resenas/${disputeId}`, email: false });
  });
  if (toAi) {
    const fresh = (await loadDispute(sql(), disputeId))!;
    const decision = await evaluateDispute(await buildContext(sql(), fresh, true));
    await applyDecision(disputeId, decision, ["ai_review"]);
  }
}

export const editSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(2000).default(""),
});

/** Decisión directa del cliente: mantener (la IA evalúa), corregir o retirar su reseña. */
export async function clientDecide(actor: Actor, disputeId: string, choice: "keep" | "edit" | "withdraw", edit?: z.infer<typeof editSchema>) {
  const d = await loadDispute(sql(), disputeId);
  await assertReviewer(sql(), actor, d);
  if (!["awaiting_client", "ai_review", "escalated"].includes(d!.status)) throw invalid("Esta revisión ya está cerrada.");
  if (choice === "keep") {
    await systemTx(async (tx) => {
      const cur = await loadDispute(tx, disputeId, true);
      if (!cur || cur.status !== "awaiting_client") return;
      await tx`insert into review_dispute_messages (dispute_id, author, author_id, body) values (${disputeId}, 'client', ${actor.id}, 'Mantengo mi reseña.')`;
      await tx`update review_disputes set status = 'ai_review' where id = ${disputeId}`;
    });
    const fresh = (await loadDispute(sql(), disputeId))!;
    if (fresh.status === "ai_review") await applyDecision(disputeId, await evaluateDispute(await buildContext(sql(), fresh, true)), ["ai_review"]);
    return;
  }
  const e = choice === "edit" ? editSchema.parse(edit) : null;
  await systemTx(async (tx) => {
    const cur = await loadDispute(tx, disputeId, true);
    if (!cur || !["awaiting_client", "ai_review", "escalated"].includes(cur.status)) throw invalid("Esta revisión ya está cerrada.");
    const [old] = await tx<{ rating: number; comment: string }[]>`select rating, comment from reviews where id = ${cur.review_id} for update`;
    await tx`insert into review_revisions (review_id, rating, comment, reason) values (${cur.review_id}, ${old.rating}, ${old.comment}, ${choice === "edit" ? "Corrección del cliente durante la revisión" : "Retiro voluntario del cliente"})`;
    if (e) await tx`update reviews set rating = ${e.rating}, comment = ${e.comment}, edited_at = now() where id = ${cur.review_id}`;
    else await tx`update reviews set withdrawn_at = now(), hidden_at = now() where id = ${cur.review_id}`;
    const resolution = e ? "edited" : "withdrawn";
    const summary = e ? "El cliente revisó y corrigió su reseña." : "El cliente decidió retirar su reseña.";
    await tx`insert into review_dispute_messages (dispute_id, author, author_id, body) values (${disputeId}, 'client', ${actor.id}, ${e ? "Corregí mi reseña." : "Retiré mi reseña."})`;
    await tx`update review_disputes set status = 'resolved', resolution = ${resolution}, resolved_at = now(), provider_summary = ${summary} where id = ${disputeId}`;
    await audit(tx, actor, `review.${resolution}`, "review", cur.review_id, "Decisión del cliente en revisión", { disputeId });
    await notifyResolution(tx, cur, resolution, summary);
  });
}

/** Cron: consultas sin respuesta del cliente en plazo → la IA decide con el registro (o escala). */
export async function processReviewDisputeDeadlines() {
  const due = await sql()<{ id: string }[]>`select id from review_disputes where status = 'awaiting_client' and client_deadline <= now() limit 20`;
  for (const { id } of due) {
    const claimed = await systemTx(async (tx) => {
      const r = await tx`update review_disputes set status = 'ai_review' where id = ${id} and status = 'awaiting_client' returning id`;
      if (r.length) await tx`insert into review_dispute_messages (dispute_id, author, body) values (${id}, 'system', 'Venció el plazo sin respuesta del cliente.')`;
      return r.length > 0;
    });
    if (!claimed) continue;
    const d = (await loadDispute(sql(), id))!;
    await applyDecision(id, await evaluateDispute(await buildContext(sql(), d, false)), ["ai_review"]);
  }
  return due.length;
}

// ───────────────────────── Operación (revisión humana) ─────────────────────────

export async function adminMessage(actor: Actor, disputeId: string, body: string) {
  if (!isStaff(actor)) throw forbidden();
  if (body.trim().length < 2) throw invalid("Escribí el mensaje.");
  return systemTx(async (tx) => {
    const d = await loadDispute(tx, disputeId, true);
    if (!d) throw notFound();
    if (["resolved", "closed"].includes(d.status)) throw invalid("La revisión está cerrada.");
    await tx`insert into review_dispute_messages (dispute_id, author, author_id, body) values (${disputeId}, 'admin', ${actor.id}, ${body.trim().slice(0, 4000)})`;
    if (d.status !== "escalated") await tx`update review_disputes set status = 'escalated', escalation_reason = coalesce(escalation_reason, 'Tomado por operación') where id = ${disputeId}`;
    await notify(tx, [d.client_user_id], { type: "review", title: "El equipo de Fixy te escribió sobre tu reseña", link: `/app/resenas/${disputeId}` });
    await audit(tx, actor, "review_dispute.admin_message", "review_dispute", disputeId, null);
  });
}

export const adminResolveSchema = z.object({
  resolution: z.enum(["kept", "hidden", "other"]),
  note: z.string().trim().min(10, "Explicá la decisión (mínimo 10 caracteres)."),
  providerSummary: z.string().trim().min(5, "Escribí el mensaje para el profesional.").max(500),
});

/** Decisión humana final. Ocultar una reseña solo puede hacerlo operación, con motivo y auditoría. */
export async function adminResolve(actor: Actor, disputeId: string, input: z.infer<typeof adminResolveSchema>) {
  if (!isStaff(actor)) throw forbidden();
  const i = adminResolveSchema.parse(input);
  return systemTx(async (tx) => {
    const d = await loadDispute(tx, disputeId, true);
    if (!d) throw notFound();
    if (["resolved", "closed"].includes(d.status)) throw invalid("La revisión ya está resuelta.");
    if (d.status !== "escalated") await tx`update review_disputes set status = 'escalated' where id = ${disputeId}`;
    if (i.resolution === "hidden") await tx`update reviews set hidden_at = now() where id = ${d.review_id}`;
    await tx`update review_disputes set status = 'resolved', resolution = ${i.resolution}, resolved_by = ${actor.id}, resolved_at = now(),
      provider_summary = ${i.providerSummary}, internal_summary = coalesce(internal_summary, '') || ${`\n\nDecisión de operación: ${i.note}`}
      where id = ${disputeId}`;
    await tx`insert into review_dispute_messages (dispute_id, author, author_id, body) values (${disputeId}, 'system', ${actor.id}, ${`Revisión cerrada por el equipo de Fixy.`})`;
    await audit(tx, actor, `review_dispute.resolve_${i.resolution}`, "review_dispute", disputeId, i.note, { reviewId: d.review_id });
    await notifyResolution(tx, d, i.resolution, i.providerSummary);
  });
}
