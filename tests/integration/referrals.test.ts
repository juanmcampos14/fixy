import { describe, expect, it } from "vitest";
import { asUser, sql } from "@/server/db/client";
import * as requests from "@/server/modules/requests";
import * as quotes from "@/server/modules/quotes";
import * as jobs from "@/server/modules/jobs";
import * as providers from "@/server/modules/providers";
import * as disputes from "@/server/modules/disputes";
import { actor, catId, invitationFor, ledgerBalance, payPending, propertyOf, providerId, totalOf, visitCode } from "./helpers";

describe("recomendación entre colegas y neto del profesional", () => {
  it("el colega recomendado hace el trabajo: quien recomendó cobra el 10 % y los costos de cobro los absorbe el profesional", async () => {
    const [ana, lucia, roberto] = await Promise.all([actor("ana"), actor("lucia"), actor("roberto")]);
    const [sosa, norte] = await Promise.all([providerId("Plomería Sosa"), providerId("Servicios Integrales Norte")]);
    await providers.updateVisitSettings(roberto, norte, { visitFeeMinor: 2_000_000, visitFeeCredited: false });

    const reqId = await requests.createRequest(ana, {
      propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title: "Pérdida bajo la mesada", description: "Pierde agua debajo de la mesada de la cocina.",
      answers: {}, urgency: "normal", preferredWindows: [], targetProviderId: sosa,
    });
    // Lucía no puede y recomienda a Servicios Integrales Norte.
    const candidates = await requests.referralCandidates(sql(), reqId, sosa);
    expect(candidates.some((c) => c.id === norte)).toBe(true);
    await requests.declineInvitation(lucia, await invitationFor(reqId, sosa), "Estoy sin agenda esta semana", { toProviderId: norte, note: "Trabajamos juntos, son muy prolijos" });
    const [ref] = await asUser(ana.id, (tx) => tx<{ id: string; status: string }[]>`select id, status from provider_referrals where request_id = ${reqId}`);
    expect(ref.status).toBe("proposed"); // el cliente la ve

    await requests.acceptReferral(ana, ref.id);
    const inv = await invitationFor(reqId, norte);
    const [i] = await sql()<{ referral_id: string }[]>`select referral_id from request_invitations where id = ${inv}`;
    expect(i.referral_id).toBe(ref.id);

    const q = await quotes.acceptBooking(roberto, inv, { proposedDate: "2026-12-12", proposedWindow: "Mañana", note: "" });
    expect(await totalOf(q)).toBe(2_200_000); // visita + 10 % al cliente
    const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
    await payPending(jobId);
    // Simulamos lo que descuenta Mercado Pago de ese cobro (comisión + impuestos).
    await sql()`update charges set gateway_fee_minor = 150_000 where job_id = ${jobId}`;
    await jobs.startJob(roberto, jobId, await visitCode(jobId));
    await jobs.finishJob(roberto, jobId, "Listo");
    await jobs.approveJob(ana, jobId);

    const payouts = await sql()<{ kind: string; provider_id: string; amount_minor: number; processing_minor: number; referral_minor: number; awaiting_review: boolean }[]>`
      select kind, provider_id, amount_minor, processing_minor, referral_minor, awaiting_review from payouts where job_id = ${jobId} order by kind`;
    const job = payouts.find((p) => p.kind === "job")!;
    const referral = payouts.find((p) => p.kind === "referral")!;
    // Neto del colega: 2.000.000 − 150.000 = 1.850.000; 10 % para Lucía = 185.000.
    expect(job).toMatchObject({ provider_id: norte, processing_minor: 150_000, referral_minor: 185_000, amount_minor: 1_665_000 });
    expect(referral).toMatchObject({ provider_id: sosa, amount_minor: 185_000, awaiting_review: true });
    expect(await ledgerBalance()).toBe(0);

    // Con la reseña, ambas liquidaciones quedan disponibles.
    await disputes.createReview(ana, jobId, { rating: 5, comment: "Muy bien" });
    const after = await sql()<{ awaiting_review: boolean }[]>`select awaiting_review from payouts where job_id = ${jobId}`;
    expect(after.every((p) => !p.awaiting_review)).toBe(true);
  });
});
