import { describe, expect, it } from "vitest";
import { asUser, sql, systemTx } from "@/server/db/client";
import * as quotes from "@/server/modules/quotes";
import * as requests from "@/server/modules/requests";
import * as jobs from "@/server/modules/jobs";
import * as disputes from "@/server/modules/disputes";
import { executePayout, releasePayoutWithoutReview } from "@/server/modules/payments";
import { actor, catId, invitationFor, payPending, propertyOf, providerId, simpleQuote, totalOf, visitCode } from "./helpers";

async function completedJob() {
  const [ana, lucia] = await Promise.all([actor("ana"), actor("lucia")]);
  const pid = await providerId("Plomería Sosa");
  const reqId = await requests.createRequest(ana, {
    propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title: "Reseñas", description: "Gotea el inodoro del baño.",
    answers: {}, urgency: "normal", preferredWindows: [],
  });
  const q = await simpleQuote(lucia, await invitationFor(reqId, pid));
  const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
  await payPending(jobId);
  await jobs.confirmJob(lucia, jobId);
  await jobs.startJob(lucia, jobId, await visitCode(jobId));
  await jobs.finishJob(lucia, jobId, "");
  await jobs.approveJob(ana, jobId);
  return { ana, lucia, pid, jobId };
}

describe("reseñas obligatorias, anónimas y diferidas", () => {
  it("sin reseña no se libera la liquidación; la excepción requiere administrador y motivo", async () => {
    const { ana, jobId } = await completedJob();
    const [operador, admin] = await Promise.all([actor("operador"), actor("admin")]);
    const [p] = await sql()<{ id: string; awaiting_review: boolean }[]>`select id, awaiting_review from payouts where job_id = ${jobId}`;
    expect(p.awaiting_review).toBe(true);
    await expect(executePayout(operador, p.id, "Semanal")).rejects.toThrow(/reseña/);
    await expect(releasePayoutWithoutReview(operador, p.id, "Cliente no responde tras recordatorios")).rejects.toThrow(/administración/);
    await expect(releasePayoutWithoutReview(admin, p.id, "corto")).rejects.toThrow(/motivo/);
    await disputes.createReview(ana, jobId, { rating: 4, comment: "Bien" });
    const [after] = await sql()<{ awaiting_review: boolean }[]>`select awaiting_review from payouts where id = ${p.id}`;
    expect(after.awaiting_review).toBe(false);
    await executePayout(operador, p.id, "Semanal");
  });

  it("la publicación se demora un plazo aleatorio dentro de la regla configurada", async () => {
    const values = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const now = new Date();
      const v = await systemTx((tx) => disputes.computeVisibleAt(tx, now));
      const hours = (v.getTime() - now.getTime()) / 3600_000;
      expect([48, 72, 168].some((b) => hours >= b && hours <= b + 12)).toBe(true);
      values.add([48, 72, 168].find((b) => hours >= b && hours <= b + 12)!);
    }
    expect(values.size).toBeGreaterThan(1); // no siempre el mismo plazo
  });

  it("el proveedor no puede ver qué cliente ni qué trabajo dejó cada reseña", async () => {
    const { ana, lucia, pid, jobId } = await completedJob();
    await disputes.createReview(ana, jobId, { rating: 2, comment: "Llegó tarde" });
    // Antes de la publicación: ni en la vista pública ni en la tabla
    expect(await asUser(lucia.id, (tx) => tx`select id from reviews_published where provider_id = ${pid} and comment = 'Llegó tarde'`)).toHaveLength(0);
    expect(await asUser(lucia.id, (tx) => tx`select id from reviews`)).toHaveLength(0);
    // El detalle del trabajo para el proveedor no incluye la reseña
    const [{ n }] = await asUser(lucia.id, (tx) => tx<{ n: number }[]>`select count(*)::int as n from reviews where job_id = ${jobId}`);
    expect(n).toBe(0);
    // El cliente sí ve la suya
    expect(await asUser(ana.id, (tx) => tx`select id from reviews where job_id = ${jobId}`)).toHaveLength(1);
    // Al cumplirse el plazo se publica sin datos identificatorios y con aviso agrupado
    await sql()`update reviews set visible_at = now() - interval '1 minute' where job_id = ${jobId}`;
    const rows = await asUser(lucia.id, (tx) => tx`select * from reviews_published where provider_id = ${pid} and comment = 'Llegó tarde'`);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0])).not.toEqual(expect.arrayContaining(["job_id"]));
    expect(Object.keys(rows[0]).some((k) => /job|client|created|visible_at/.test(k))).toBe(false);
    const r = await disputes.processReviewTasks();
    expect(r.publishedProviders).toBeGreaterThanOrEqual(1);
  });

  it("recuerda al cliente que califique", async () => {
    const { jobId } = await completedJob();
    await sql()`update jobs set completed_at = now() - interval '2 days' where id = ${jobId}`;
    const r = await disputes.processReviewTasks();
    expect(r.reminders).toBeGreaterThanOrEqual(1);
    const [{ review_reminders }] = await sql()<{ review_reminders: number }[]>`select review_reminders from jobs where id = ${jobId}`;
    expect(review_reminders).toBe(1);
  });
});
