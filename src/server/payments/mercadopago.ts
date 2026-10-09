import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import type { GatewayPayment, GatewayPaymentStatus, PaymentGateway } from "./gateway";

/**
 * Mercado Pago — Checkout Pro (API de Preferences), cobrando en la cuenta de FLIPS S.R.L.
 * - El cliente paga en la página de Mercado Pago; los datos de tarjeta nunca pasan por Fixy.
 * - El pago se confirma SOLO con el webhook firmado + consulta verificada a /v1/payments/{id} (nunca por la vuelta del navegador).
 * - MERCADOPAGO_MODE=test usa MERCADOPAGO_TEST_ACCESS_TOKEN (sin dinero real); "live" usa MERCADOPAGO_ACCESS_TOKEN.
 * - A los profesionales se les paga por retiros mensuales (transferencia registrada por la operación), no por la pasarela.
 */
const API = "https://api.mercadopago.com";

export const mpIsTest = () => env().MERCADOPAGO_MODE !== "live";

function token() {
  const e = env();
  const t = mpIsTest() ? e.MERCADOPAGO_TEST_ACCESS_TOKEN : e.MERCADOPAGO_ACCESS_TOKEN;
  if (!t) throw new Error(`Falta ${mpIsTest() ? "MERCADOPAGO_TEST_ACCESS_TOKEN" : "MERCADOPAGO_ACCESS_TOKEN"}`);
  return t;
}

async function mp<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${(json.message ?? json.error ?? "error").toString().slice(0, 200)}`);
  return json;
}

const toMinor = (n: number) => Math.round(Number(n) * 100);
const toPesos = (minor: number) => Math.round(minor) / 100;

function mapStatus(p: { status: string; status_detail?: string; transaction_amount_refunded?: number }): GatewayPaymentStatus {
  switch (p.status) {
    case "approved":
      return (p.transaction_amount_refunded ?? 0) > 0 || p.status_detail === "partially_refunded" ? "partially_refunded" : "approved";
    case "refunded":
      return "refunded";
    case "rejected":
    case "cancelled":
      return "rejected";
    case "in_mediation":
      return "in_mediation";
    case "charged_back":
      return "charged_back";
    default:
      // pending, in_process, authorized: no cambian el estado aprobado ya registrado.
      return "pending";
  }
}

export const mercadoPagoGateway: PaymentGateway = {
  name: "mercadopago",
  get isTest() {
    return mpIsTest();
  },

  async createCheckout(_db, req) {
    const base = env().APP_URL.replace(/\/$/, "");
    const back = `${base}/pagos/retorno`;
    const pref = await mp<{ id: string; init_point: string; sandbox_init_point?: string }>("/checkout/preferences", {
      method: "POST",
      idempotencyKey: req.idempotencyKey,
      body: {
        items: [{ id: req.externalReference, title: req.description.slice(0, 250), quantity: 1, currency_id: req.currency, unit_price: toPesos(req.amountMinor) }],
        external_reference: req.externalReference,
        back_urls: { success: back, pending: back, failure: back },
        auto_return: "approved",
        statement_descriptor: "FIXY",
        // Sin efectivo ni cajeros: la visita se confirma con el pago y esos medios tardan días en acreditarse.
        payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
        expires: true,
        expiration_date_to: new Date(Date.now() + 48 * 3600_000).toISOString(),
      },
    });
    return { checkoutUrl: mpIsTest() && pref.sandbox_init_point ? pref.sandbox_init_point : pref.init_point };
  },

  async getPayment(_db, paymentId): Promise<GatewayPayment | null> {
    if (!/^\d{3,25}$/.test(paymentId)) return null;
    try {
      const p = await mp<{ id: number; external_reference: string | null; transaction_amount: number; currency_id: string; status: string; status_detail?: string; transaction_amount_refunded?: number; transaction_details?: { net_received_amount?: number } }>(`/v1/payments/${paymentId}`);
      if (!p.external_reference) return null;
      return {
        id: String(p.id),
        externalReference: p.external_reference,
        amountMinor: toMinor(p.transaction_amount),
        currency: p.currency_id,
        status: mapStatus(p),
        refundedMinor: toMinor(p.transaction_amount_refunded ?? 0),
        // Lo que Mercado Pago no nos acredita: su comisión e impuestos/retenciones del cobro.
        feesMinor: p.transaction_details?.net_received_amount != null ? Math.max(0, toMinor(p.transaction_amount) - toMinor(p.transaction_details.net_received_amount)) : 0,
      };
    } catch (e) {
      if (e instanceof Error && /Mercado Pago 404/.test(e.message)) return null;
      throw e;
    }
  },

  async refund(_db, paymentId, amountMinor, idempotencyKey) {
    const r = await mp<{ id: number }>(`/v1/payments/${paymentId}/refunds`, { method: "POST", idempotencyKey, body: { amount: toPesos(amountMinor) } });
    return { refundId: String(r.id) };
  },

  // Con retiros mensuales Fixy transfiere a la cuenta bancaria del profesional: no hay cuentas de cobro en la pasarela.
  async createPayoutAccount() {
    throw new Error("Con Mercado Pago, los profesionales cargan sus datos bancarios y cobran por retiros mensuales.");
  },
  async transfer() {
    throw new Error("Los retiros se transfieren por banco y se registran desde Finanzas → Retiros.");
  },

  /**
   * Firma documentada por Mercado Pago: header x-signature "ts=...,v1=..." y HMAC-SHA256 del
   * manifiesto "id:{data.id};request-id:{x-request-id};ts:{ts};" con la clave secreta de la app.
   */
  verifyWebhook(rawBody, headers) {
    const secret = env().MERCADOPAGO_WEBHOOK_SECRET;
    const header = headers.get("x-signature");
    const requestId = headers.get("x-request-id") ?? "";
    if (!secret || !header) return false;
    const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
    if (!parts.ts || !parts.v1) return false;
    let dataId = "";
    try {
      dataId = String(JSON.parse(rawBody)?.data?.id ?? "").toLowerCase();
    } catch {
      return false;
    }
    let manifest = `id:${dataId};`;
    if (requestId) manifest += `request-id:${requestId};`;
    manifest += `ts:${parts.ts};`;
    const expected = Buffer.from(createHmac("sha256", secret).update(manifest).digest("hex"));
    const given = Buffer.from(parts.v1);
    return expected.length === given.length && timingSafeEqual(expected, given);
  },
};
