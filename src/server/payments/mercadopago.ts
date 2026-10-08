import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import type { PaymentGateway } from "./gateway";

/**
 * Adaptador de Mercado Pago — NO ACTIVADO. Esqueleto para la integración real (Split de pagos 1:1,
 * Checkout Pro con marketplace_fee, vinculación OAuth de cada proveedor).
 *
 * Antes de habilitarlo hay que (ver docs/payments.md):
 *  1. Validar el flujo comercial con Mercado Pago (no hay custodia/escrow documentada).
 *  2. Probar en sandbox con cuentas de prueba (vendedor, comprador, integrador).
 *  3. Implementar OAuth del proveedor y guardar sus tokens cifrados fuera de la tabla providers.
 * Solo la verificación de firma de webhooks está implementada según la documentación oficial.
 */
function notImplemented(): never {
  throw new Error(
    "La integración real con Mercado Pago no está activada. Usá PAYMENTS_GATEWAY=mock o completá los pasos de docs/payments.md.",
  );
}

export const mercadoPagoGateway: PaymentGateway = {
  name: "mercadopago",
  isTest: false,
  createCheckout: async () => notImplemented(),
  getPayment: async () => notImplemented(),
  refund: async () => notImplemented(),
  createPayoutAccount: async () => notImplemented(),
  transfer: async () => notImplemented(),

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
