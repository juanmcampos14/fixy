import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";

// Se configuran antes del primer env() (que se cachea).
process.env.MERCADOPAGO_WEBHOOK_SECRET = "clave-de-prueba";
process.env.MERCADOPAGO_TEST_ACCESS_TOKEN = "TEST-token";
process.env.MERCADOPAGO_MODE = "test";

describe("Mercado Pago: firma de webhooks", () => {
  it("acepta la firma documentada y rechaza alteraciones", async () => {
    const { mercadoPagoGateway } = await import("@/server/payments/mercadopago");
    const body = JSON.stringify({ id: 123, type: "payment", data: { id: "999888777" } });
    const ts = "1704908010";
    const v1 = createHmac("sha256", "clave-de-prueba").update(`id:999888777;request-id:req-1;ts:${ts};`).digest("hex");
    const h = (sig: string) => new Headers({ "x-signature": `ts=${ts},v1=${sig}`, "x-request-id": "req-1" });
    expect(mercadoPagoGateway.verifyWebhook(body, h(v1))).toBe(true);
    expect(mercadoPagoGateway.verifyWebhook(body.replace("999888777", "111"), h(v1))).toBe(false);
    expect(mercadoPagoGateway.verifyWebhook(body, new Headers())).toBe(false);
  });
});

describe("Mercado Pago: adaptador (API simulada)", () => {
  it("crea la preferencia en pesos, consulta el pago y reintegra", async () => {
    const { vi } = await import("vitest");
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const json = url.endsWith("/checkout/preferences") ? { id: "pref1", init_point: "https://mp/real", sandbox_init_point: "https://mp/sandbox" }
        : url.includes("/refunds") ? { id: 55 }
        : { id: 999, external_reference: "FXY-1", transaction_amount: 1575.5, currency_id: "ARS", status: "approved", transaction_amount_refunded: 0 };
      return new Response(JSON.stringify(json), { status: 200 });
    });
    const { mercadoPagoGateway } = await import("@/server/payments/mercadopago");
    const r = await mercadoPagoGateway.createCheckout({} as never, { externalReference: "FXY-1", amountMinor: 157550, currency: "ARS", description: "Visita", payoutAccountRef: null, marketplaceFeeMinor: 0, idempotencyKey: "k1" });
    expect(r.checkoutUrl).toBe("https://mp/sandbox");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.items[0].unit_price).toBe(1575.5);
    expect(body.external_reference).toBe("FXY-1");
    expect((calls[0].init.headers as Record<string, string>)["X-Idempotency-Key"]).toBe("k1");
    const p = await mercadoPagoGateway.getPayment({} as never, "999");
    expect(p).toMatchObject({ id: "999", externalReference: "FXY-1", amountMinor: 157550, status: "approved" });
    expect(await mercadoPagoGateway.getPayment({} as never, "no-es-un-id")).toBeNull();
    expect((await mercadoPagoGateway.refund({} as never, "999", 50000, "r1")).refundId).toBe("55");
    expect(JSON.parse(String(calls.at(-1)!.init.body)).amount).toBe(500);
    vi.unstubAllGlobals();
  });
});
