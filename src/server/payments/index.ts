import { env } from "@/server/env";
import type { GatewayName, PaymentGateway } from "./gateway";
import { mockGateway } from "./mock";
import { mercadoPagoGateway } from "./mercadopago";

export function activeGateway(): PaymentGateway {
  return env().PAYMENTS_GATEWAY === "mercadopago" ? mercadoPagoGateway : mockGateway;
}

export function gatewayByName(name: GatewayName): PaymentGateway {
  return name === "mercadopago" ? mercadoPagoGateway : mockGateway;
}
