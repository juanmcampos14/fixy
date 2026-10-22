/**
 * Fallas de la pasarela (auditoría H-02 / H-03 y skill fixy-reliable-payments): timeouts después de que la pasarela
 * hizo la operación, errores antes, dos procesadores a la vez, leases vencidos, avisos fuera de orden y conciliación.
 * En ningún caso puede haber doble cobro, doble devolución, doble transferencia ni registro financiero desbalanceado.
 */
import { afterEach, describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import * as quotes from "@/server/modules/quotes";
import * as requests from "@/server/modules/requests";
import * as jobs from "@/server/modules/jobs";
import { drainPaymentCommands, executePayout, processPaymentWebhook, refundCharge, releasePayoutWithoutReview } from "@/server/modules/payments";
import { runPaymentCommands } from "@/server/modules/payment-commands";
import { replayCommand, runReconciliation } from "@/server/modules/payment-reconciliation";
import { buildMockWebhook, clearMockFaults, injectMockFault } from "@/server/payments/mock";
import { actor, catId, completeCheckout, invitationFor, ledgerBalance, payPending, propertyOf, providerId, simpleQuote, totalOf, visitCode } from "./helpers";

afterEach(() => clearMockFaults());

/** Trabajo contratado con un cobro pendiente (todavía sin checkout en la pasarela). */
async function hiredJob(title: string) {
  const [ana, roberto] = await Promise.all([actor("ana"), actor("roberto")]);
  const pid = await providerId("Servicios Integrales Norte");
  const reqId = await requests.createRequest(ana, {
    propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title, description: "Pierde agua la canilla de la cocina.",
    answers: {}, urgency: "normal", preferredWindows: [],
  });
  const q = await simpleQuote(roberto, await invitationFor(reqId, pid), 2_000_000);
  const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
  const [c] = await sql()<{ id: string; external_reference: string; amount_minor: number }[]>`select id, external_reference, amount_minor from charges where job_id = ${jobId}`;
  return { jobId, charge: { ...c, amount_minor: Number(c.amount_minor) } };
}

/** Trabajo con el cobro aprobado. */
async function paidJob(title: string) {
  const j = await hiredJob(title);
  const { paymentId } = await payPending(j.jobId);
  return { ...j, paymentId };
}

const commandsOf = (chargeId: string) =>
  sql()<{ kind: string; status: string; attempts: number }[]>`select kind, status, attempts from payment_commands where charge_id = ${chargeId} order by created_at`;
const mockRefunds = (paymentId: string) => sql()<{ amount_minor: number }[]>`select amount_minor from mock_gateway_refunds where payment_id = ${paymentId}`;
const due = (chargeId: string) => sql()`update payment_commands set next_attempt_at = now() where charge_id = ${chargeId} and status = 'retryable'`;
const admin = () => actor("admin");

describe("pagos ante fallas de la pasarela", () => {
  it("aceptar un presupuesto no llama a la pasarela: el checkout se crea después, una sola vez, aunque corran dos procesadores", async () => {
    const { charge } = await hiredJob("Checkout diferido");
    expect(await sql()`select 1 from mock_gateway_payments where external_reference = ${charge.external_reference}`).toHaveLength(0);
    expect(await commandsOf(charge.id)).toEqual([{ kind: "create_checkout", status: "pending", attempts: 0 }]);

    await Promise.all([runPaymentCommands({ chargeId: charge.id }), runPaymentCommands({ chargeId: charge.id })]);
    expect(await sql()`select 1 from mock_gateway_payments where external_reference = ${charge.external_reference}`).toHaveLength(1);
    expect((await commandsOf(charge.id))[0]).toMatchObject({ status: "succeeded", attempts: 1 });
    const [c] = await sql()<{ checkout_url: string }[]>`select checkout_url from charges where id = ${charge.id}`;
    expect(c.checkout_url).toBe(`/pagos/prueba/${encodeURIComponent(charge.external_reference)}`);
  });

  it("si la pasarela crea el checkout pero no responde, el reintento usa la misma operación", async () => {
    const { charge } = await hiredJob("Checkout con timeout");
    injectMockFault("createCheckout", "after");
    expect(await runPaymentCommands({ chargeId: charge.id })).toMatchObject({ retrying: 1 });
    expect((await sql()<{ checkout_url: string | null }[]>`select checkout_url from charges where id = ${charge.id}`)[0].checkout_url).toBeNull();
    await due(charge.id);
    expect(await runPaymentCommands({ chargeId: charge.id })).toMatchObject({ succeeded: 1 });
    expect(await sql()`select 1 from mock_gateway_payments where external_reference = ${charge.external_reference}`).toHaveLength(1);
  });

  it("si la pasarela rechaza crear el checkout, el cobro queda fallido y el cliente puede reintentar", async () => {
    const { charge } = await hiredJob("Checkout rechazado");
    injectMockFault("createCheckout", "before", false);
    expect(await runPaymentCommands({ chargeId: charge.id })).toMatchObject({ dead: 1 });
    expect((await sql()<{ status: string }[]>`select status from charges where id = ${charge.id}`)[0].status).toBe("failed");
    expect(await sql()`select 1 from payment_incidents where charge_id = ${charge.id} and kind = 'command_dead' and status = 'open'`).toHaveLength(1);
  });

  it("timeout después de devolver: el reintento no devuelve dos veces y el registro queda balanceado", async () => {
    const { charge, paymentId } = await paidJob("Reembolso con timeout");
    injectMockFault("refund", "after");
    const refundId = await refundCharge(await admin(), { chargeId: charge.id, amountMinor: 50_000, reason: "Ajuste por demora" });
    // La pasarela devolvió, Fixy todavía no lo registró: el cobro sigue igual y el reembolso, pendiente.
    expect(await mockRefunds(paymentId)).toHaveLength(1);
    expect((await sql()<{ status: string }[]>`select status from refunds where id = ${refundId}`)[0].status).toBe("pending");
    expect((await sql()<{ refunded_minor: number }[]>`select refunded_minor from charges where id = ${charge.id}`)[0].refunded_minor).toBe(0);
    // Mientras tanto no se puede pedir de nuevo lo mismo por encima de lo cobrado.
    await expect(refundCharge(await admin(), { chargeId: charge.id, amountMinor: charge.amount_minor, reason: "Total" })).rejects.toThrow(/máximo/);

    await due(charge.id);
    await runPaymentCommands({ chargeId: charge.id });
    expect(await mockRefunds(paymentId)).toHaveLength(1); // misma clave: la pasarela no repite
    expect((await sql()<{ status: string }[]>`select status from refunds where id = ${refundId}`)[0].status).toBe("approved");
    expect((await sql()<{ refunded_minor: number; status: string }[]>`select refunded_minor, status from charges where id = ${charge.id}`)[0])
      .toEqual({ refunded_minor: 50_000, status: "partially_refunded" });
    expect(await sql()`select 1 from ledger_entries where refund_id = ${refundId} and account = 'gateway_clearing'`).toHaveLength(1);
    expect(await ledgerBalance()).toBe(0);
  });

  it("un aviso de la pasarela que llega antes de registrar nuestra devolución no la duplica", async () => {
    const { charge, paymentId } = await paidJob("Aviso antes del registro");
    injectMockFault("refund", "after");
    await refundCharge(await admin(), { chargeId: charge.id, amountMinor: 30_000, reason: "Ajuste por demora" });
    const hook = buildMockWebhook(paymentId);
    expect(await processPaymentWebhook("mock", hook.rawBody, hook.headers)).toBe("ignored_stale");
    await due(charge.id);
    await drainPaymentCommands({ chargeId: charge.id });
    const refunds = await sql()<{ source: string; status: string }[]>`select source, status from refunds where charge_id = ${charge.id}`;
    expect(refunds).toEqual([{ source: "platform", status: "approved" }]);
    expect((await sql()<{ refunded_minor: number }[]>`select refunded_minor from charges where id = ${charge.id}`)[0].refunded_minor).toBe(30_000);
    expect(await ledgerBalance()).toBe(0);
  });

  it("si la pasarela rechaza la devolución, queda fallida sin tocar el cobro y se puede reintentar con la misma clave", async () => {
    const { charge, paymentId } = await paidJob("Reembolso rechazado");
    injectMockFault("refund", "before", false);
    const refundId = await refundCharge(await admin(), { chargeId: charge.id, amountMinor: 40_000, reason: "Ajuste por demora" });
    expect((await sql()<{ status: string }[]>`select status from refunds where id = ${refundId}`)[0].status).toBe("failed");
    expect((await sql()<{ refunded_minor: number }[]>`select refunded_minor from charges where id = ${charge.id}`)[0].refunded_minor).toBe(0);
    const [cmd] = await sql()<{ id: string }[]>`select id from payment_commands where refund_id = ${refundId}`;
    expect(await sql()`select 1 from payment_incidents where command_id = ${cmd.id} and severity = 'critical' and status = 'open'`).toHaveLength(1);

    await replayCommand(await admin(), cmd.id);
    expect((await sql()<{ status: string }[]>`select status from refunds where id = ${refundId}`)[0].status).toBe("approved");
    expect(await mockRefunds(paymentId)).toEqual([{ amount_minor: 40_000 }]);
    expect(await sql()`select 1 from payment_incidents where command_id = ${cmd.id} and status = 'open'`).toHaveLength(0);
    expect(await ledgerBalance()).toBe(0);
  });

  it("un procesador que se cae con el lease tomado: al vencer, otro lo retoma y lo hace una sola vez", async () => {
    const { charge, paymentId } = await paidJob("Lease vencido");
    injectMockFault("refund", "before"); // el primer intento no llega a la pasarela
    await refundCharge(await admin(), { chargeId: charge.id, amountMinor: 20_000, reason: "Ajuste por demora" });
    // Simula un procesador que reclamó el comando y murió.
    await sql()`update payment_commands set status = 'leased', lease_until = now() + interval '1 minute' where charge_id = ${charge.id} and kind = 'refund'`;
    expect(await runPaymentCommands({ chargeId: charge.id })).toEqual({ succeeded: 0, retrying: 0, dead: 0 }); // lease vigente: nadie lo toca
    await sql()`update payment_commands set lease_until = now() - interval '1 second' where charge_id = ${charge.id} and kind = 'refund'`;
    const [a, b] = await Promise.all([runPaymentCommands({ chargeId: charge.id }), runPaymentCommands({ chargeId: charge.id })]);
    expect(a.succeeded + b.succeeded).toBe(1);
    expect(await mockRefunds(paymentId)).toHaveLength(1);
    expect(await ledgerBalance()).toBe(0);
  });

  it("si la pasarela no responde al consultar un aviso, no se aplica nada y el aviso puede reintentarse", async () => {
    const { charge } = await hiredJob("Aviso sin respuesta");
    const paymentId = await completeCheckout(charge.external_reference, "approved");
    injectMockFault("getPayment", "before");
    const hook = buildMockWebhook(paymentId);
    expect(await processPaymentWebhook("mock", hook.rawBody, hook.headers)).toBe("error");
    expect((await sql()<{ status: string }[]>`select status from charges where id = ${charge.id}`)[0].status).toBe("pending");
    expect(await processPaymentWebhook("mock", hook.rawBody, hook.headers)).toBe("applied"); // la pasarela reenvía el mismo aviso
    expect(await processPaymentWebhook("mock", hook.rawBody, hook.headers)).toBe("ignored_duplicate");
  });

  it("la conciliación aplica un pago cuyo aviso se perdió y no hace nada si la pasarela no responde", async () => {
    const { charge } = await hiredJob("Aviso perdido");
    await completeCheckout(charge.external_reference, "approved"); // pagó, pero el webhook nunca llegó
    await sql()`update charges set created_at = now() - interval '20 minutes', reconciled_at = null where id = ${charge.id}`;

    injectMockFault("searchPayments", "before");
    await sql()`update charges set reconciled_at = now() where id <> ${charge.id} and reconciled_at is null`;
    const failed = await runReconciliation({ limit: 1 });
    expect(failed).toMatchObject({ checked: 1, errors: 1, applied: 0 });
    expect((await sql()<{ status: string }[]>`select status from charges where id = ${charge.id}`)[0].status).toBe("pending");

    await sql()`update charges set reconciled_at = null where id = ${charge.id}`;
    const ok = await runReconciliation({ limit: 1 });
    expect(ok).toMatchObject({ checked: 1, applied: 1 });
    expect((await sql()<{ status: string }[]>`select status from charges where id = ${charge.id}`)[0].status).toBe("approved");
    expect(await ledgerBalance()).toBe(0);
  });

  it("la conciliación detecta un reembolso que Fixy registró y la pasarela no tiene", async () => {
    const { charge, paymentId } = await paidJob("Reembolso fantasma");
    await refundCharge(await admin(), { chargeId: charge.id, amountMinor: 10_000, reason: "Ajuste por demora" });
    // La pasarela "pierde" la devolución (por ejemplo, la revirtió): el registro interno no coincide.
    await sql()`update mock_gateway_payments set refunded_minor = 0, status = 'approved' where id = ${paymentId}`;
    await sql()`update charges set reconciled_at = null where id = ${charge.id}`;
    await sql()`update charges set reconciled_at = now() where id <> ${charge.id} and reconciled_at is null`;
    await runReconciliation({ limit: 1 });
    expect(await sql()`select 1 from payment_incidents where charge_id = ${charge.id} and kind = 'refund_not_in_gateway' and severity = 'critical' and status = 'open'`).toHaveLength(1);
    // La segunda vuelta no la duplica.
    await sql()`update charges set reconciled_at = null where id = ${charge.id}`;
    await runReconciliation({ limit: 1 });
    expect(await sql()`select 1 from payment_incidents where charge_id = ${charge.id} and kind = 'refund_not_in_gateway'`).toHaveLength(1);
  });

  it("un pago duplicado se devuelve una sola vez aunque el aviso llegue varias veces y la devolución tarde", async () => {
    const { charge } = await paidJob("Duplicado con demora");
    const dup = `mockpay_dup_${Date.now()}`;
    await sql()`insert into mock_gateway_payments (id, external_reference, amount_minor, currency, status) values (${dup}, ${charge.external_reference}, ${charge.amount_minor}, 'ARS', 'approved')`;
    injectMockFault("refund", "after");
    const h1 = buildMockWebhook(dup);
    expect(await processPaymentWebhook("mock", h1.rawBody, h1.headers)).toBe("rejected");
    const h2 = buildMockWebhook(dup);
    expect(await processPaymentWebhook("mock", h2.rawBody, h2.headers)).toBe("rejected");
    await due(charge.id);
    await drainPaymentCommands({ chargeId: charge.id });
    expect(await mockRefunds(dup)).toHaveLength(1);
    expect(await sql()`select 1 from audit_log where action = 'payment.orphan_refunded' and data->>'paymentId' = ${dup}`).toHaveLength(1);
    expect(await ledgerBalance()).toBe(0);
  });

  it("una transferencia que la pasarela hizo pero no confirmó no se repite al reintentar", async () => {
    // Trabajo propio, con otro profesional: el saldo de Servicios Integrales Norte lo usan las pruebas de retiros.
    const [ana, lucia] = await Promise.all([actor("ana"), actor("lucia")]);
    const pid = await providerId("Plomería Sosa");
    const reqId = await requests.createRequest(ana, {
      propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title: "Transferencia con falla", description: "Pierde agua el flotante del tanque.",
      answers: {}, urgency: "normal", preferredWindows: [],
    });
    const q = await simpleQuote(lucia, await invitationFor(reqId, pid), 1_500_000);
    const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
    await payPending(jobId);
    await jobs.confirmJob(lucia, jobId);
    await jobs.startJob(lucia, jobId, await visitCode(jobId));
    await jobs.finishJob(lucia, jobId, "");
    await jobs.approveJob(ana, jobId);
    const [p] = await sql()<{ id: string; awaiting_review: boolean }[]>`select id, awaiting_review from payouts where job_id = ${jobId} and kind = 'job'`;
    expect(p).toBeTruthy();
    const a = await admin();
    if (p.awaiting_review) await releasePayoutWithoutReview(a, p.id, "Prueba de transferencia con falla de la pasarela");
    injectMockFault("transfer", "after");
    expect(await executePayout(a, p.id, "Liquidación de prueba")).toEqual({ status: "processing" });
    await sql()`update payment_commands set next_attempt_at = now() where payout_id = ${p.id} and status = 'retryable'`;
    await runPaymentCommands({});
    expect((await sql()<{ status: string }[]>`select status from payouts where id = ${p.id}`)[0].status).toBe("paid");
    expect(await sql()`select 1 from mock_gateway_transfers where reference = ${`payout:${p.id}`}`).toHaveLength(1);
    expect(await sql()`select 1 from ledger_entries where payout_id = ${p.id} and entry_type = 'payout'`).toHaveLength(2);
    await expect(executePayout(a, p.id, "Otra vez")).rejects.toThrow(/ejecutable/);
    expect(await ledgerBalance()).toBe(0);
  });
});
