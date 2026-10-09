import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "@/server/db/client";
import * as quotes from "@/server/modules/quotes";
import * as requests from "@/server/modules/requests";
import * as jobs from "@/server/modules/jobs";
import { processPaymentWebhook, refundCharge } from "@/server/modules/payments";
import { providerBalance, requestWithdrawal } from "@/server/modules/withdrawals";
import { buildMockWebhook } from "@/server/payments/mock";
import { actor, catId, invitationFor, ledgerBalance, payPending, propertyOf, providerId, simpleQuote, totalOf, visitCode } from "./helpers";

async function completedJob(title: string) {
  const [ana, roberto] = await Promise.all([actor("ana"), actor("roberto")]);
  const pid = await providerId("Servicios Integrales Norte");
  const reqId = await requests.createRequest(ana, {
    propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title, description: "Pierde agua la canilla del baño.",
    answers: {}, urgency: "normal", preferredWindows: [],
  });
  const q = await simpleQuote(roberto, await invitationFor(reqId, pid), 2_000_000);
  const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
  const { paymentId } = await payPending(jobId);
  await jobs.confirmJob(roberto, jobId);
  await jobs.startJob(roberto, jobId, await visitCode(jobId));
  await jobs.finishJob(roberto, jobId, "");
  await jobs.approveJob(ana, jobId);
  return { ana, roberto, pid, jobId, paymentId };
}

const notify = async (paymentId: string) => {
  const hook = buildMockWebhook(paymentId);
  return processPaymentWebhook("mock", hook.rawBody, hook.headers);
};

describe("contracargos, devoluciones y recuperos", () => {
  it("un segundo pago aprobado del mismo cobro se devuelve solo", async () => {
    const { jobId } = await completedJob("Pago duplicado");
    const [c] = await sql()<{ external_reference: string; amount_minor: number }[]>`select external_reference, amount_minor from charges where job_id = ${jobId}`;
    const dup = `mock_pay_${randomUUID().slice(0, 12)}`;
    await sql()`insert into mock_gateway_payments (id, external_reference, amount_minor, currency, status) values (${dup}, ${c.external_reference}, ${c.amount_minor}, 'ARS', 'approved')`;
    expect(await notify(dup)).toBe("rejected");
    const [m] = await sql()<{ status: string }[]>`select status from mock_gateway_payments where id = ${dup}`;
    expect(m.status).toBe("refunded");
    expect(await sql()`select 1 from audit_log where action = 'payment.orphan_refunded' and data->>'paymentId' = ${dup}`).toHaveLength(1);
    expect(await notify(dup)).toBe("rejected"); // el aviso repetido no devuelve dos veces
  });

  it("un contracargo retiene la liquidación, registra el reembolso y deja el registro financiero balanceado", async () => {
    const { jobId, paymentId } = await completedJob("Contracargo");
    await sql()`update mock_gateway_payments set status = 'in_mediation' where id = ${paymentId}`;
    expect(await notify(paymentId)).toBe("applied");
    expect((await sql()<{ on_hold: boolean }[]>`select on_hold from payouts where job_id = ${jobId}`)[0].on_hold).toBe(true);

    await sql()`update mock_gateway_payments set status = 'charged_back' where id = ${paymentId}`;
    expect(await notify(paymentId)).toBe("applied");
    const [c] = await sql()<{ status: string; refunded_minor: number; amount_minor: number }[]>`select status, refunded_minor, amount_minor from charges where job_id = ${jobId}`;
    expect(c.status).toBe("refunded");
    expect(c.refunded_minor).toBe(c.amount_minor);
    const [po] = await sql()<{ amount_minor: number; on_hold: boolean }[]>`select amount_minor, on_hold from payouts where job_id = ${jobId} and kind = 'job'`;
    expect(po.amount_minor).toBe(0);
    expect(po.on_hold).toBe(true);
    expect(await sql()`select 1 from refunds r join charges c on c.id = r.charge_id where c.job_id = ${jobId} and r.source = 'chargeback'`).toHaveLength(1);
    expect(await ledgerBalance()).toBe(0);
  });

  it("una devolución hecha desde la pasarela se registra en Fixy", async () => {
    const { jobId, paymentId } = await completedJob("Devolución en la pasarela");
    await sql()`update mock_gateway_payments set status = 'partially_refunded', refunded_minor = 500000 where id = ${paymentId}`;
    expect(await notify(paymentId)).toBe("applied");
    const [c] = await sql()<{ refunded_minor: number }[]>`select refunded_minor from charges where job_id = ${jobId}`;
    expect(c.refunded_minor).toBe(500000);
    expect(await notify(paymentId)).not.toBe("applied"); // sin diferencia nueva, nada más que registrar
  });

  it("un reembolso después de cobrar queda como recupero y se descuenta del saldo", async () => {
    const { roberto, pid, jobId } = await completedJob("Reembolso tras cobrar");
    const [po] = await sql()<{ id: string; amount_minor: number }[]>`select id, amount_minor from payouts where job_id = ${jobId} and kind = 'job'`;
    // La liquidación ya se transfirió al profesional.
    for (const st of ["scheduled", "processing", "paid"]) await sql()`update payouts set status = ${st} where id = ${po.id}`;
    const before = await providerBalance(sql(), pid);
    const [c] = await sql()<{ id: string; amount_minor: number }[]>`select id, amount_minor from charges where job_id = ${jobId}`;
    await refundCharge(await actor("operador"), { chargeId: c.id, amountMinor: c.amount_minor, reason: "Reembolso total por reclamo" });
    const [rec] = await sql()<{ amount_minor: number; status: string }[]>`select amount_minor, status from provider_recoveries where job_id = ${jobId}`;
    expect(Number(rec.amount_minor)).toBe(po.amount_minor);
    expect(rec.status).toBe("open");
    const after = await providerBalance(sql(), pid);
    expect(after.recoveryMinor).toBe(before.recoveryMinor + po.amount_minor);
    expect(after.availableMinor).toBe(Math.max(0, after.grossAvailableMinor - after.recoveryMinor));
    if (after.availableMinor === 0 && !after.thisMonth) await expect(requestWithdrawal(roberto, pid, null)).rejects.toThrow(/descontar|saldo/);
    expect(await ledgerBalance()).toBe(0);
  });
});
