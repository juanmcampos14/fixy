import { describe, expect, it } from "vitest";
import { asUser, sql } from "@/server/db/client";
import * as quotes from "@/server/modules/quotes";
import * as requests from "@/server/modules/requests";
import * as jobs from "@/server/modules/jobs";
import * as disputes from "@/server/modules/disputes";
import { executePayout } from "@/server/modules/payments";
import { markWithdrawalPaid, providerBalance, rejectWithdrawal, requestWithdrawal } from "@/server/modules/withdrawals";
import { actor, catId, invitationFor, ledgerBalance, payPending, propertyOf, providerId, simpleQuote, totalOf, visitCode } from "./helpers";

const BANK = { holderName: "Servicios Integrales Norte SRL", holderTaxId: "30-71234567-9", cbu: "0000003100099999999991", alias: "", bankName: "Banco de prueba" };

async function reviewedJob(title: string) {
  const [ana, roberto] = await Promise.all([actor("ana"), actor("roberto")]);
  const pid = await providerId("Servicios Integrales Norte");
  const reqId = await requests.createRequest(ana, {
    propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title, description: "Pierde agua la canilla de la cocina.",
    answers: {}, urgency: "normal", preferredWindows: [],
  });
  const q = await simpleQuote(roberto, await invitationFor(reqId, pid), 4_000_000);
  const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
  await payPending(jobId);
  await jobs.confirmJob(roberto, jobId);
  await jobs.startJob(roberto, jobId, await visitCode(jobId));
  await jobs.finishJob(roberto, jobId, "");
  await jobs.approveJob(ana, jobId);
  return { ana, roberto, pid, jobId };
}

describe("saldo y retiros mensuales", () => {
  it("0 % de comisión: el profesional cobra el 100 % del presupuesto", async () => {
    const [{ bad }] = await sql()<{ bad: number }[]>`select count(*)::int as bad from commission_rules where provider_rate_bps <> 0`;
    expect(bad).toBe(0);
    await expect(sql()`insert into commission_rules (provider_rate_bps, client_rate_bps, active) values (500, 1000, false)`).rejects.toThrow();
  });

  it("el saldo se acumula con reseña; un retiro por mes, a 20 días, con datos bancarios; la operación lo paga", async () => {
    const { ana, roberto, pid, jobId } = await reviewedJob("Retiro 1");
    const [operador, lucia] = await Promise.all([actor("operador"), actor("lucia")]);
    const [po] = await sql()<{ id: string; amount_minor: number; fee_minor: number; gross_minor: number }[]>`select id, amount_minor, fee_minor, gross_minor from payouts where job_id = ${jobId}`;
    expect(po.fee_minor).toBe(0);
    expect(po.amount_minor).toBe(4_000_000);

    // Sin reseña no está disponible
    let b = await providerBalance(sql(), pid);
    const before = b.availableMinor;
    expect(b.waitingReviewMinor).toBeGreaterThanOrEqual(4_000_000);
    await disputes.createReview(ana, jobId, { rating: 5, comment: "Excelente" });
    b = await providerBalance(sql(), pid);
    expect(b.availableMinor).toBe(before + 4_000_000);

    // Otro proveedor no puede retirar el saldo ajeno; sin datos bancarios no se puede pedir
    await expect(requestWithdrawal(lucia, pid, null)).rejects.toThrow();
    await expect(requestWithdrawal(roberto, pid, null)).rejects.toThrow(/datos bancarios/);
    await expect(requestWithdrawal(roberto, pid, { ...BANK, cbu: "123" })).rejects.toThrow();

    const w = await requestWithdrawal(roberto, pid, BANK);
    expect(w.amountMinor).toBe(b.availableMinor);
    const [{ diff }] = await sql()<{ diff: number }[]>`select (scheduled_for - (now() at time zone 'America/Argentina/Buenos_Aires')::date)::int as diff from withdrawals where id = ${w.id}`;
    expect(diff).toBe(20);
    // Los datos bancarios no quedan en la auditoría
    const logs = await sql()<{ data: unknown }[]>`select data from audit_log where entity_id = ${pid} and action = 'provider.bank_account_saved'`;
    expect(JSON.stringify(logs)).not.toContain("0000003100099999999991");
    // El saldo queda en camino y no se puede pedir otro este mes
    b = await providerBalance(sql(), pid);
    expect(b.availableMinor).toBe(0);
    expect(b.requestedMinor).toBe(w.amountMinor);
    expect(b.canRequest).toBe(false);
    await expect(requestWithdrawal(roberto, pid, null)).rejects.toThrow(/este mes|saldo/);
    // Una liquidación del retiro no se puede pagar suelta
    await expect(executePayout(operador, po.id, "suelta")).rejects.toThrow(/retiro/);
    // Un técnico no ve los retiros; el cliente tampoco
    expect(await asUser(ana.id, (tx) => tx`select id from withdrawals where id = ${w.id}`)).toHaveLength(0);

    // La operación no puede pagar antes de la fecha (salvo administración explícita)
    await expect(markWithdrawalPaid(operador, w.id, "TRF-1")).rejects.toThrow(/fecha/);
    await expect(markWithdrawalPaid(roberto, w.id, "TRF-1", { allowEarly: true })).rejects.toThrow();
    const admin = await actor("admin");
    const ledgerBefore = await ledgerBalance();
    await markWithdrawalPaid(admin, w.id, "TRF-0001", { allowEarly: true });
    expect(await ledgerBalance()).toBe(ledgerBefore); // asientos balanceados
    const [paid] = await sql()<{ status: string; withdrawal_id: string }[]>`select status, withdrawal_id from payouts where id = ${po.id}`;
    expect(paid).toEqual({ status: "paid", withdrawal_id: w.id });
    b = await providerBalance(sql(), pid);
    expect(b.paidMinor).toBe(w.amountMinor);
  });

  it("un retiro rechazado devuelve el saldo y no cuenta para el mes", async () => {
    const { ana, roberto, pid, jobId } = await reviewedJob("Retiro 2");
    await disputes.createReview(ana, jobId, { rating: 4, comment: "Bien" });
    // El retiro del mes ya se usó en el test anterior: lo simulamos rechazando uno nuevo en otro período
    await sql()`update withdrawals set period = '2000-01' where provider_id = ${pid}`;
    const w = await requestWithdrawal(roberto, pid, null);
    const operador = await actor("operador");
    await rejectWithdrawal(operador, w.id, "El CBU no corresponde al titular.");
    const b = await providerBalance(sql(), pid);
    expect(b.availableMinor).toBe(w.amountMinor);
    expect(b.canRequest).toBe(true);
    const again = await requestWithdrawal(roberto, pid, null);
    expect(again.amountMinor).toBe(w.amountMinor);
  });
});
