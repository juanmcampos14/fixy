import { describe, expect, it } from "vitest";
import { normalizeArPhone } from "@/lib/phone-ar";

describe("teléfonos argentinos", () => {
  it("reconoce el mismo número escrito de formas distintas", () => {
    const k = "1130388764";
    for (const raw of ["+54 9 11 3038-8764", "+54 11 3038-8764", "5491130388764", "011 3038 8764", "11 15 3038-8764", "1130388764", "54 9 11 3038 8764"]) {
      expect(normalizeArPhone(raw)?.key).toBe(k);
    }
    expect(normalizeArPhone("+54 9 11 3038-8764")?.whatsapp).toBe("5491130388764");
  });

  it("líneas fijas del interior y números inválidos", () => {
    expect(normalizeArPhone("(0230) 442-2216")?.key).toBe("2304422216");
    expect(normalizeArPhone("+")).toBeNull();
    expect(normalizeArPhone("")).toBeNull();
    expect(normalizeArPhone("1234")).toBeNull();
  });
});
