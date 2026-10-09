import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Db } from "@/server/db/client";
import { env } from "@/server/env";
import type { GatewayPayment, PaymentGateway } from "./gateway";

/**
 * Pasarela simulada. MODO DE PRUEBA: no mueve dinero real ni retiene fondos.
 * Mantiene su propio "estado del lado de la pasarela" (tablas mock_gateway_*) para que el
 * flujo de confirmación sea igual al real: webhook firmado + consulta verificada.
 */
export function signMockWebhook(rawBody: string, ts: string): string {
  return createHmac("sha256", env().MOCK_WEBHOOK_SECRET).update(`${ts}.${rawBody}`).digest("hex");
}

export const mockGateway: PaymentGateway = {
  name: "mock",
  isTest: true,

  async createCheckout(db, req) {
    const id = `mockpay_${randomUUID()}`;
    await db`insert into mock_gateway_payments (id, external_reference, amount_minor, currency, status)
      values (${id}, ${req.externalReference}, ${req.amountMinor}, ${req.currency}, 'pending')`;
    return { checkoutUrl: `/pagos/prueba/${encodeURIComponent(req.externalReference)}` };
  },

  async getPayment(db, paymentId) {
    const [p] = await db<{ id: string; external_reference: string; amount_minor: number; currency: string; status: GatewayPayment["status"]; refunded_minor: number }[]>`
      select * from mock_gateway_payments where id = ${paymentId}`;
    if (!p) return null;
    return {
      id: p.id,
      externalReference: p.external_reference,
      amountMinor: p.amount_minor,
      currency: p.currency,
      status: p.status,
      refundedMinor: p.refunded_minor,
      feesMinor: 0,
    };
  },

  async refund(db, paymentId, amountMinor) {
    const [p] = await db<{ amount_minor: number; refunded_minor: number; status: string }[]>`
      select amount_minor, refunded_minor, status from mock_gateway_payments where id = ${paymentId} for update`;
    if (!p || !["approved", "partially_refunded"].includes(p.status)) throw new Error("Pago no reembolsable en la pasarela simulada");
    const refunded = p.refunded_minor + amountMinor;
    if (refunded > p.amount_minor) throw new Error("El reembolso supera el pago");
    await db`update mock_gateway_payments set refunded_minor = ${refunded},
      status = ${refunded === p.amount_minor ? "refunded" : "partially_refunded"}, updated_at = now() where id = ${paymentId}`;
    return { refundId: `mockref_${randomUUID()}` };
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
    const [existing] = await db<{ id: string; status: "processing" | "paid" | "failed" }[]>`
      select id, status from mock_gateway_transfers where reference = ${reference}`;
    if (existing) return { transferId: existing.id, status: existing.status }; // idempotente
    const id = `mocktr_${randomUUID()}`;
    await db`insert into mock_gateway_transfers (id, account_id, amount_minor, reference, status)
      values (${id}, ${accountRef}, ${amountMinor}, ${reference}, 'paid')`;
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
