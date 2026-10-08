/**
 * Cálculos monetarios con enteros (centavos). Nunca usar punto flotante para importes.
 * Las tasas se expresan en puntos básicos (bps): 1000 bps = 10 %.
 */

export const CURRENCY = "ARS" as const;
export type Currency = typeof CURRENCY;

export function assertMinor(n: number, label = "importe"): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label} inválido: debe ser un entero no negativo en centavos`);
  return n;
}

/** amount × bps / 10000 con redondeo half-up, en aritmética entera (BigInt). */
export function applyBps(amountMinor: number, bps: number): number {
  assertMinor(amountMinor);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10000) throw new Error("Tasa inválida");
  const r = (BigInt(amountMinor) * BigInt(bps) + BigInt(5000)) / BigInt(10000);
  return Number(r);
}

/** Convierte un texto en pesos ("12.500,50" o "12500.5" o "12500") a centavos, sin floats. */
export function parseArsToMinor(input: string): number | null {
  const s = input.trim().replace(/\s|\$/g, "");
  if (!s) return null;
  // Formato argentino: punto de miles y coma decimal. También aceptamos punto decimal si no hay coma.
  let intPart: string;
  let decPart = "";
  if (s.includes(",")) {
    const [i, d = ""] = s.split(",");
    intPart = i.replace(/\./g, "");
    decPart = d;
  } else {
    const parts = s.split(".");
    if (parts.length === 2 && parts[1].length <= 2) {
      intPart = parts[0];
      decPart = parts[1];
    } else {
      intPart = s.replace(/\./g, "");
    }
  }
  if (!/^\d+$/.test(intPart) || !/^\d{0,2}$/.test(decPart)) return null;
  const minor = BigInt(intPart) * BigInt(100) + BigInt((decPart + "00").slice(0, 2));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(minor);
}

export type CommissionRule = {
  providerRateBps: number;
  clientRateBps: number;
  clientFeeTaxBps: number;
};

export type PriceBreakdown = {
  laborMinor: number;
  materialsMinor: number;
  visitMinor: number;
  subtotalMinor: number;
  clientFeeMinor: number;
  clientFeeTaxMinor: number;
  providerFeeMinor: number;
  totalMinor: number; // lo que paga el cliente
  providerNetMinor: number; // lo que recibe el proveedor
  platformRevenueMinor: number; // ingreso de la plataforma (sin impuestos)
  rule: CommissionRule;
};

export function computeBreakdown(
  parts: { laborMinor: number; materialsMinor: number; visitMinor: number },
  rule: CommissionRule,
): PriceBreakdown {
  const laborMinor = assertMinor(parts.laborMinor, "mano de obra");
  const materialsMinor = assertMinor(parts.materialsMinor, "materiales");
  const visitMinor = assertMinor(parts.visitMinor, "visita");
  const subtotalMinor = laborMinor + materialsMinor + visitMinor;
  const clientFeeMinor = applyBps(subtotalMinor, rule.clientRateBps);
  const clientFeeTaxMinor = applyBps(clientFeeMinor, rule.clientFeeTaxBps);
  const providerFeeMinor = applyBps(subtotalMinor, rule.providerRateBps);
  const totalMinor = subtotalMinor + clientFeeMinor + clientFeeTaxMinor;
  const providerNetMinor = subtotalMinor - providerFeeMinor;
  return {
    laborMinor,
    materialsMinor,
    visitMinor,
    subtotalMinor,
    clientFeeMinor,
    clientFeeTaxMinor,
    providerFeeMinor,
    totalMinor,
    providerNetMinor,
    platformRevenueMinor: clientFeeMinor + providerFeeMinor,
    rule,
  };
}

/**
 * Reparte un reembolso entre la parte del proveedor y la de la plataforma, proporcionalmente
 * al cobro original. La parte del proveedor se redondea hacia abajo; el resto va a plataforma.
 */
export function splitRefund(refundMinor: number, chargeAmountMinor: number, chargeProviderNetMinor: number) {
  assertMinor(refundMinor);
  if (refundMinor > chargeAmountMinor) throw new Error("El reembolso supera el cobro");
  const providerPart = Number((BigInt(refundMinor) * BigInt(chargeProviderNetMinor)) / BigInt(chargeAmountMinor));
  return { providerPartMinor: providerPart, platformPartMinor: refundMinor - providerPart };
}
