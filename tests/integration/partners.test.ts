import { describe, expect, it } from "vitest";
import { getPartnerDashboard } from "@/server/queries/partners";

describe("panel de socios", () => {
  it("calcula KPIs, series, embudo, oferta, calidad, canales y dinero sin errores", async () => {
    const d = await getPartnerDashboard(90);
    expect(d.series.requests).toHaveLength(12);
    expect(d.funnel.sent).toBeGreaterThanOrEqual(d.funnel.hired);
    expect(d.funnel.hired).toBeGreaterThanOrEqual(d.funnel.completed);
    expect(d.kpis.requests.current).toBeGreaterThan(0);
    expect(d.supply.byCategory.length).toBeGreaterThan(0);
    expect(typeof d.money.available).toBe("number");
  });
});
