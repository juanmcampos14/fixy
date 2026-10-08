import { describe, expect, it } from "vitest";
import { asUser, sql } from "@/server/db/client";
import * as quotes from "@/server/modules/quotes";
import * as requests from "@/server/modules/requests";
import * as jobs from "@/server/modules/jobs";
import * as disputes from "@/server/modules/disputes";
import * as rd from "@/server/modules/review-disputes";
import { actor, catId, invitationFor, payPending, propertyOf, providerId, simpleQuote, totalOf, visitCode } from "./helpers";

/** Trabajo completado y calificado por Ana con Plomería Sosa; la reseña queda publicada. */
async function publishedReview(rating = 2, comment = "Dejó todo sucio y llegó tarde") {
  const [ana, lucia] = await Promise.all([actor("ana"), actor("lucia")]);
  const pid = await providerId("Plomería Sosa");
  const reqId = await requests.createRequest(ana, {
    propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title: "Impugnación", description: "Pierde la descarga del inodoro.",
    answers: {}, urgency: "normal", preferredWindows: [],
  });
  const q = await simpleQuote(lucia, await invitationFor(reqId, pid));
  const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
  await payPending(jobId);
  await jobs.confirmJob(lucia, jobId);
  await jobs.startJob(lucia, jobId, await visitCode(jobId));
  await jobs.finishJob(lucia, jobId, "");
  await jobs.approveJob(ana, jobId);
  await disputes.createReview(ana, jobId, { rating, comment });
  const [r] = await sql()<{ id: string }[]>`update reviews set visible_at = now() - interval '1 hour' where job_id = ${jobId} returning id`;
  return { ana, lucia, pid, jobId, reviewId: r.id };
}

const statement = "No es correcto: dejé el baño limpio y llegué en el horario acordado por chat.";

describe("impugnación de reseñas", () => {
  it("el proveedor impugna sin conocer al autor; se consulta al cliente y se escala si la IA no resuelve", async () => {
    const { ana, lucia, pid, reviewId } = await publishedReview();
    const id = await rd.openReviewDispute(lucia, reviewId, { reasonCode: "false_facts", statement });
    const [d] = await sql()<{ status: string }[]>`select status from review_disputes where id = ${id}`;
    expect(d.status).toBe("awaiting_client");
    const msgs = await sql()<{ author: string }[]>`select author from review_dispute_messages where dispute_id = ${id}`;
    expect(msgs.map((m) => m.author)).toEqual(["ai"]);
    const [n] = await sql()<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${ana.id} and link = ${`/app/resenas/${id}`}`;
    expect(n.n).toBe(1);

    // El proveedor no ve el análisis interno, la conversación ni la reseña con su autor.
    expect(await asUser(lucia.id, (tx) => tx`select id from review_disputes`)).toHaveLength(0);
    expect(await asUser(lucia.id, (tx) => tx`select id from review_dispute_messages`)).toHaveLength(0);
    const view = await asUser(lucia.id, (tx) => tx<Record<string, unknown>[]>`select * from review_disputes_provider where id = ${id}`);
    expect(view).toHaveLength(1);
    expect(Object.keys(view[0])).not.toContain("internal_summary");
    expect(Object.keys(view[0])).not.toContain("provider_statement");
    // Otro proveedor no puede ver ni impugnar
    const martin = await actor("martin");
    expect(await asUser(martin.id, (tx) => tx`select id from review_disputes_provider`)).toHaveLength(0);

    // El cliente ve la consulta del asistente
    expect(await asUser(ana.id, (tx) => tx`select id from review_dispute_messages where dispute_id = ${id}`)).toHaveLength(1);
    expect(await asUser(ana.id, (tx) => tx`select id from review_disputes_client where id = ${id}`)).toHaveLength(1);
    expect(await asUser(lucia.id, (tx) => tx`select id from review_disputes_client where id = ${id}`)).toHaveLength(0);

    // Cliente responde → sin IA disponible, pasa a revisión humana
    await rd.clientReply(ana, id, "Llegó dos horas tarde y no limpió el piso. Tengo fotos.");
    const [after] = await sql()<{ status: string; escalation_reason: string | null }[]>`select status, escalation_reason from review_disputes where id = ${id}`;
    expect(after.status).toBe("escalated");

    // Operación decide ocultar → deja de publicarse
    const operador = await actor("operador");
    await expect(rd.adminResolve(lucia, id, { resolution: "hidden", note: "Intento indebido", providerSummary: "x x x x x" })).rejects.toThrow(/permiso/);
    await rd.adminResolve(operador, id, { resolution: "kept", note: "El relato del cliente coincide con el chat del trabajo.", providerSummary: "Revisamos el caso y la reseña se mantiene." });
    const [final] = await asUser(lucia.id, (tx) => tx<{ status: string; resolution: string; provider_summary: string }[]>`select status, resolution, provider_summary from review_disputes_provider where id = ${id}`);
    expect(final).toMatchObject({ status: "resolved", resolution: "kept" });
    expect(await asUser(lucia.id, (tx) => tx`select id from reviews_published where id = ${reviewId}`)).toHaveLength(1);
    void pid;
  });

  it("una sola impugnación por reseña, solo sobre reseñas publicadas y propias", async () => {
    const { lucia, reviewId, jobId } = await publishedReview(3, "Regular");
    const martin = await actor("martin");
    await expect(rd.openReviewDispute(martin, reviewId, { reasonCode: "other", statement })).rejects.toThrow(/permiso/);
    await rd.openReviewDispute(lucia, reviewId, { reasonCode: "other", statement });
    await expect(rd.openReviewDispute(lucia, reviewId, { reasonCode: "other", statement })).rejects.toThrow(/ya fue impugnada/);
    await sql()`update reviews set visible_at = now() + interval '2 days' where job_id = ${jobId}`;
    const other = await publishedReview(4, "Bien");
    await sql()`update reviews set visible_at = now() + interval '2 days' where id = ${other.reviewId}`;
    await expect(rd.openReviewDispute(lucia, other.reviewId, { reasonCode: "other", statement })).rejects.toThrow(/no está publicada/);
  });

  it("el cliente puede corregir o retirar su reseña, con historial", async () => {
    const a = await publishedReview(1, "Pésimo");
    const id1 = await rd.openReviewDispute(a.lucia, a.reviewId, { reasonCode: "false_facts", statement });
    await rd.clientDecide(a.ana, id1, "edit", { rating: 3, comment: "Hubo una demora, pero lo resolvió." });
    const [r1] = await sql()<{ rating: number; edited_at: Date | null }[]>`select rating, edited_at from reviews where id = ${a.reviewId}`;
    expect(r1.rating).toBe(3);
    expect(r1.edited_at).not.toBeNull();
    const [{ n }] = await sql()<{ n: number }[]>`select count(*)::int as n from review_revisions where review_id = ${a.reviewId}`;
    expect(n).toBe(1);
    const [s1] = await sql()<{ resolution: string }[]>`select resolution from review_disputes where id = ${id1}`;
    expect(s1.resolution).toBe("edited");

    const b = await publishedReview(1, "Malo");
    const id2 = await rd.openReviewDispute(b.lucia, b.reviewId, { reasonCode: "offensive", statement });
    await expect(rd.clientDecide(b.lucia, id2, "withdraw")).rejects.toThrow(/permiso/);
    await rd.clientDecide(b.ana, id2, "withdraw");
    expect(await asUser(b.lucia.id, (tx) => tx`select id from reviews_published where id = ${b.reviewId}`)).toHaveLength(0);
  });

  it("si el cliente no responde en plazo, se decide con el registro o se escala", async () => {
    const c = await publishedReview(2, "No me gustó");
    const id = await rd.openReviewDispute(c.lucia, c.reviewId, { reasonCode: "false_facts", statement });
    await sql()`update review_disputes set client_deadline = now() - interval '1 minute' where id = ${id}`;
    expect(await rd.processReviewDisputeDeadlines()).toBeGreaterThanOrEqual(1);
    const [d] = await sql()<{ status: string }[]>`select status from review_disputes where id = ${id}`;
    expect(["escalated", "resolved"]).toContain(d.status);
  });
});
