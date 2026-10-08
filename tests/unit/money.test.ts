import { describe, expect, it } from "vitest";
import { applyBps, computeBreakdown, parseArsToMinor, splitRefund } from "@/server/domain/money";

describe("dinero en enteros", () => {
  it("aplica tasas con redondeo half-up sin floats", () => {
    expect(applyBps(10_000, 1000)).toBe(1000);
    expect(applyBps(1, 5000)).toBe(1); // 0,5 → 1
    expect(applyBps(3, 1500)).toBe(0); // 0,45 → 0
    expect(applyBps(999_999_999_99, 1234)).toBe(12_340_000_000); // grandes importes sin pérdida
  });

  it("calcula total del cliente, comisión y neto del proveedor", () => {
    const b = computeBreakdown({ laborMinor: 4_500_000, materialsMinor: 1_800_000, visitMinor: 1_500_000 }, { providerRateBps: 1000, clientRateBps: 500, clientFeeTaxBps: 2100 });
    expect(b.subtotalMinor).toBe(7_800_000);
    expect(b.clientFeeMinor).toBe(390_000);
    expect(b.clientFeeTaxMinor).toBe(81_900);
    expect(b.totalMinor).toBe(7_800_000 + 390_000 + 81_900);
    expect(b.providerFeeMinor).toBe(780_000);
    expect(b.providerNetMinor).toBe(7_020_000);
    expect(b.platformRevenueMinor).toBe(1_170_000);
    // Invariante: lo que paga el cliente = neto proveedor + ingresos plataforma + impuestos
    expect(b.totalMinor).toBe(b.providerNetMinor + b.platformRevenueMinor + b.clientFeeTaxMinor);
  });

  it("rechaza importes no enteros o negativos", () => {
    expect(() => computeBreakdown({ laborMinor: 10.5, materialsMinor: 0, visitMinor: 0 }, { providerRateBps: 0, clientRateBps: 0, clientFeeTaxBps: 0 })).toThrow();
    expect(() => computeBreakdown({ laborMinor: -1, materialsMinor: 0, visitMinor: 0 }, { providerRateBps: 0, clientRateBps: 0, clientFeeTaxBps: 0 })).toThrow();
  });

  it("interpreta importes en formato argentino", () => {
    expect(parseArsToMinor("12.500")).toBe(1_250_000);
    expect(parseArsToMinor("12.500,50")).toBe(1_250_050);
    expect(parseArsToMinor("$ 1.234.567,8")).toBe(123_456_780);
    expect(parseArsToMinor("45000")).toBe(4_500_000);
    expect(parseArsToMinor("10.5")).toBe(1050);
    expect(parseArsToMinor("abc")).toBeNull();
    expect(parseArsToMinor("1,234")).toBeNull();
  });

  it("reparte reembolsos proporcionalmente y sin perder centavos", () => {
    const r = splitRefund(1001, 8_190_000, 7_020_000);
    expect(r.providerPartMinor + r.platformPartMinor).toBe(1001);
    expect(r.providerPartMinor).toBe(858);
    expect(() => splitRefund(10, 5, 4)).toThrow();
  });
});
