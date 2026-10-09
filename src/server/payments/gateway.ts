/**
 * Interfaz de pasarela de pagos. El dominio nunca habla directamente con una pasarela concreta.
 * - MockGateway: modo de prueba, sin dinero real (por defecto).
 * - MercadoPagoGateway: esqueleto no activado; ver docs/payments.md antes de habilitarlo.
 */
import type { Db } from "@/server/db/client";

export type GatewayName = "mock" | "mercadopago";

export type GatewayPaymentStatus = "pending" | "approved" | "rejected" | "refunded" | "partially_refunded";

export type GatewayPayment = {
  id: string;
  externalReference: string;
  amountMinor: number;
  currency: string;
  status: GatewayPaymentStatus;
  refundedMinor: number;
  /** Costos de cobro descontados por la pasarela (comisión + impuestos/retenciones). 0 si no aplica. */
  feesMinor: number;
};

export type CheckoutRequest = {
  externalReference: string;
  amountMinor: number;
  currency: "ARS";
  description: string;
  payoutAccountRef: string | null;
  marketplaceFeeMinor: number;
  idempotencyKey: string;
};

export interface PaymentGateway {
  readonly name: GatewayName;
  readonly isTest: boolean;
  /** Crea la intención de cobro y devuelve a dónde redirigir al cliente. */
  createCheckout(db: Db, req: CheckoutRequest): Promise<{ checkoutUrl: string }>;
  /** Consulta verificada del estado de un pago en la pasarela. */
  getPayment(db: Db, paymentId: string): Promise<GatewayPayment | null>;
  refund(db: Db, paymentId: string, amountMinor: number, idempotencyKey: string): Promise<{ refundId: string }>;
  /** Verifica la autenticidad de una notificación entrante. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  /** Alta / vinculación de la cuenta de cobro del proveedor. */
  createPayoutAccount(db: Db, providerId: string): Promise<{ accountRef: string; onboardingUrl: string | null }>;
  /** Transferencia / liquidación al proveedor (si el modelo de la pasarela lo requiere). */
  transfer(db: Db, accountRef: string, amountMinor: number, reference: string): Promise<{ transferId: string; status: "processing" | "paid" | "failed" }>;
}
