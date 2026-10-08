import { describe, expect, it } from "vitest";
import { triageByRules } from "@/server/assistant/rules";

describe("asistente por reglas", () => {
  it("sugiere categoría con confianza", () => {
    expect(triageByRules("Se tapó la pileta de la cocina y no desagota").categorySlug).toBe("plomeria");
    expect(triageByRules("Salta la térmica cuando prendo el horno").categorySlug).toBe("electricidad");
    expect(triageByRules("El split no enfría, creo que le falta carga de gas del aire").categorySlug).toBe("climatizacion");
    expect(triageByRules("Me quedé afuera, perdí las llaves").categorySlug).toBe("cerrajeria");
    expect(triageByRules("El lavarropas no centrifuga").categorySlug).toBe("electrodomesticos");
  });

  it("deriva casos ambiguos a revisión humana", () => {
    const r = triageByRules("Hay algo raro en casa, no sé bien qué es");
    expect(r.categorySlug).toBeNull();
    expect(r.needsReview).toBe(true);
  });

  it("muestra orientación de seguridad sin instrucciones de reparación", () => {
    const r = triageByRules("Siento olor a gas en la cocina");
    expect(r.safety?.level).toBe("emergency");
    expect(r.suggestedUrgency).toBe("urgent");
    expect(r.safety?.guidance.join(" ")).toMatch(/911|emergencia/);
    expect(triageByRules("El enchufe tira chispas").safety?.level).toBe("caution");
  });

  it("no inventa precios ni disponibilidad", () => {
    const r = triageByRules("Necesito pintar dos ambientes");
    expect(JSON.stringify(r)).not.toMatch(/\$|precio|disponible ya/i);
  });
});
