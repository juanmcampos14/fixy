import { describe, expect, it } from "vitest";
import { tradeMatches, tradeSlugsFromText } from "@/lib/trades";

describe("oficios como los dice la gente", () => {
  it("reconoce los oficios en el orden en que aparecen", () => {
    expect(tradeSlugsFromText("Soy gasista matriculado y también plomero")).toEqual(["gas", "plomeria"]);
    expect(tradeSlugsFromText("hago aires y heladeras")).toEqual(["climatizacion", "electrodomesticos"]);
    expect(tradeSlugsFromText("vitralista")).toEqual([]);
  });

  it("el buscador encuentra por nombre del rubro, por cómo se llama al que lo hace o por sinónimos", () => {
    const plom = { slug: "plomeria", name: "Plomería" };
    expect(tradeMatches(plom, "plome")).toBe(true);
    expect(tradeMatches(plom, "plomero")).toBe(true);
    expect(tradeMatches(plom, "canilla")).toBe(true);
    expect(tradeMatches(plom, "pintor")).toBe(false);
    expect(tradeMatches({ slug: "climatizacion", name: "Aire acondicionado" }, "split")).toBe(true);
    expect(tradeMatches({ slug: "electricidad", name: "Electricidad" }, "ELECTRICISTA")).toBe(true);
  });
});
