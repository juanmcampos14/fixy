import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { sql, type Db } from "@/server/db/client";
import { env } from "@/server/env";
import { GatewayError, type GatewayPayment, type PaymentGateway } from "./gateway";

/**
 * Pasarela simulada. MODO DE PRUEBA: no mueve dinero real ni retiene fondos.
 * Mantiene su propio "estado del lado de la pasarela" (tablas mock_gateway_*) para que el
 * flujo de confirmación sea igual al real: webhook firmado + consulta verificada.
 */
/**
 * Fallas simuladas, solo en pruebas: `before` falla sin hacer nada (p. ej., 500 al recibir); `after` hace la operación
 * y después falla (p. ej., timeout cuando la pasarela ya cobró o devolvió). Cada falla se consume una vez.
 */
type MockOp = "createCheckout" | "refund" | "transfer" | "getPayment" | "searchPayments";
const faults: { op: MockOp; when: "before" | "after"; retryable: boolean }[] = [];
export function injectMockFault(op: MockOp, when: "before" | "after", retryable = true) {
  if (env().NODE_ENV !== "test") throw new Error("Las fallas simuladas solo existen en pruebas");
  faults.push({ op, when, retryable });
}
export function clearMockFaults() {
  faults.length = 0;
}
function fault(op: MockOp, when: "before" | "after") {
  const i = faults.findIndex((f) => f.op === op && f.when === when);
  if (i < 0) return;
  const [f] = faults.splice(i, 1);
  throw new GatewayError(`Pasarela simulada: falla ${when === "before" ? "antes" : "después"} de ${op}`, f.retryable);
}

const toGatewayPayment = (p: { id: string; external_reference: string; amount_minor: number; currency: string; status: GatewayPayment["status"]; refunded_minor: number }): GatewayPayment => ({
  id: p.id,
  externalReference: p.external_reference,
  amountMinor: Number(p.amount_minor),
  currency: p.currency,
  status: p.status,
  refundedMinor: Number(p.refunded_minor),
  feesMinor: 0,
});

export function signMockWebhook(rawBody: string, ts: string): string {
  return createHmac("sha256", env().MOCK_WEBHOOK_SECRET).update(`${ts}.${rawBody}`).digest("hex");
}

export const mockGateway: PaymentGateway = {
  name: "mock",
  isTest: true,

  // Idempotente por referencia (como una preferencia con clave idempotente): reintentar no crea otro pago.
  async createCheckout(db, req) {
    fault("createCheckout", "before");
    const [existing] = await db<{ id: string }[]>`select id from mock_gateway_payments where external_reference = ${req.externalReference} limit 1`;
    if (!existing) {
      await db`insert into mock_gateway_payments (id, external_reference, amount_minor, currency, status)
        values (${`mockpay_${randomUUID()}`}, ${req.externalReference}, ${req.amountMinor}, ${req.currency}, 'pending')`;
    }
    fault("createCheckout", "after");
    return { checkoutUrl: `/pagos/prueba/${encodeURIComponent(req.externalReference)}` };
  },

  async getPayment(db, paymentId) {
    fault("getPayment", "before");
    const [p] = await db<Parameters<typeof toGatewayPayment>[0][]>`select * from mock_gateway_payments where id = ${paymentId}`;
    return p ? toGatewayPayment(p) : null;
  },

  async searchPayments(db, externalReference) {
    fault("searchPayments", "before");
    const rows = await db<Parameters<typeof toGatewayPayment>[0][]>`
      select * from mock_gateway_payments where external_reference = ${externalReference} order by created_at desc`;
    return rows.map(toGatewayPayment);
  },

  // Idempotente por clave y atómico: la misma clave devuelve el mismo reembolso sin volver a descontar.
  async refund(db, paymentId, amountMinor, idempotencyKey) {
    fault("refund", "before");
    // Atómico en su propia transacción (la pasarela simulada vive "afuera" de la del dominio).
    const result = await sql().begin(async (t) => {
      const [done] = await t<{ id: string }[]>`select id from mock_gateway_refunds where idempotency_key = ${idempotencyKey}`;
      if (done) return { refundId: done.id };
      const [p] = await t<{ amount_minor: number; refunded_minor: number; status: string }[]>`
        select amount_minor, refunded_minor, status from mock_gateway_payments where id = ${paymentId} for update`;
      if (!p || !["approved", "partially_refunded"].includes(p.status)) throw new GatewayError("Pago no reembolsable en la pasarela simulada", false);
      const refunded = Number(p.refunded_minor) + amountMinor;
      if (refunded > Number(p.amount_minor)) throw new GatewayError("El reembolso supera el pago", false);
      const id = `mockref_${randomUUID()}`;
      await t`insert into mock_gateway_refunds (idempotency_key, id, payment_id, amount_minor) values (${idempotencyKey}, ${id}, ${paymentId}, ${amountMinor})`;
      await t`update mock_gateway_payments set refunded_minor = ${refunded},
        status = ${refunded === Number(p.amount_minor) ? "refunded" : "partially_refunded"}, updated_at = now() where id = ${paymentId}`;
      return { refundId: id };
    });
    fault("refund", "after");
    return result;
  },

  verifyWebhook(rawBody, headers) {
    const ts = headers.get("x-mock-timestamp");
    const sig = headers.get("x-mock-signature");
    if (!ts || !sig || !/^\d+$/.test(ts)) return false;
    if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // ventana anti-replay
    const expected = Buffer.from(signMockWebhook(rawBody, ts));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  },

  async createPayoutAccount(db, providerId) {
    const [existing] = await db<{ id: string }[]>`select id from mock_gateway_accounts where provider_id = ${providerId}`;
    if (existing) return { accountRef: existing.id, onboardingUrl: null };
    const id = `mockacct_${randomUUID()}`;
    await db`insert into mock_gateway_accounts (id, provider_id) values (${id}, ${providerId})`;
    return { accountRef: id, onboardingUrl: null };
  },

  async transfer(db, accountRef, amountMinor, reference) {
    fault("transfer", "before");
    const [existing] = await db<{ id: string; status: "processing" | "paid" | "failed" }[]>`
      select id, status from mock_gateway_transfers where reference = ${reference}`;
    if (existing) return { transferId: existing.id, status: existing.status }; // idempotente
    const id = `mocktr_${randomUUID()}`;
    await db`insert into mock_gateway_transfers (id, account_id, amount_minor, reference, status)
      values (${id}, ${accountRef}, ${amountMinor}, ${reference}, 'paid')`;
    fault("transfer", "after");
    return { transferId: id, status: "paid" };
  },
};

/** Simula la acción del comprador en el checkout de prueba (solo existe en el adaptador mock). */
export async function mockCompleteCheckout(db: Db, externalReference: string, outcome: "approved" | "rejected") {
  const [p] = await db<{ id: string; status: string }[]>`
    select id, status from mock_gateway_payments where external_reference = ${externalReference}
    order by created_at desc limit 1 for update`;
  if (!p) throw new Error("Pago simulado inexistente");
  if (p.status === "pending") {
    await db`update mock_gateway_payments set status = ${outcome}, updated_at = now() where id = ${p.id}`;
  }
  return p.id;
}

export function buildMockWebhook(paymentId: string, eventId = `mockevt_${randomUUID()}`) {
  const rawBody = JSON.stringify({ id: eventId, type: "payment", action: "payment.updated", data: { id: paymentId } });
  const ts = String(Math.floor(Date.now() / 1000));
  const headers = new Headers({
    "content-type": "application/json",
    "x-mock-timestamp": ts,
    "x-mock-signature": signMockWebhook(rawBody, ts),
  });
  return { rawBody, headers, eventId };
}
