/**
 * Interfaz de pasarela de pagos. El dominio nunca habla directamente con una pasarela concreta.
 * - MockGateway: modo de prueba, sin dinero real (por defecto).
 * - MercadoPagoGateway: Checkout Pro; ver docs/payments.md.
 * Nunca se llama con una transacción de base abierta: el dominio guarda la intención, confirma y la ejecuta un
 * procesador (src/server/modules/payment-commands.ts). Por eso todas las operaciones que mueven dinero reciben una
 * clave idempotente estable: reintentar con la misma clave devuelve la misma operación.
 */
import type { Db } from "@/server/db/client";

export type GatewayName = "mock" | "mercadopago";

export type GatewayPaymentStatus =
  | "pending" | "approved" | "rejected" | "refunded" | "partially_refunded"
  /** El cliente abrió un reclamo en la pasarela: el dinero queda retenido hasta que se resuelva. */
  | "in_mediation"
  /** El banco devolvió el pago al cliente (contracargo). */
  | "charged_back";

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

/**
 * Error de la pasarela clasificado. `retryable`: timeouts, 5xx, límites de frecuencia (se reintenta con la misma clave).
 * No reintentable: la pasarela rechazó la operación (datos inválidos, pago no reembolsable…).
 */
export class GatewayError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "GatewayError";
  }
}

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
  /** Pagos asociados a una referencia de Fixy (el más reciente primero). Lo usa la conciliación. */
  searchPayments(db: Db, externalReference: string): Promise<GatewayPayment[]>;
  /** Idempotente por clave: la misma clave devuelve el mismo reembolso. */
  refund(db: Db, paymentId: string, amountMinor: number, idempotencyKey: string): Promise<{ refundId: string }>;
  /** Verifica la autenticidad de una notificación entrante. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  /** Alta / vinculación de la cuenta de cobro del proveedor. */
  createPayoutAccount(db: Db, providerId: string): Promise<{ accountRef: string; onboardingUrl: string | null }>;
  /** Transferencia / liquidación al proveedor (si el modelo de la pasarela lo requiere). */
  transfer(db: Db, accountRef: string, amountMinor: number, reference: string): Promise<{ transferId: string; status: "processing" | "paid" | "failed" }>;
}
