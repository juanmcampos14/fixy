/** Rubro principal, estrellas por rubro y el panel "¿Cómo te llegan los pedidos?". */
import { describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import { findCandidatesFor } from "@/server/modules/requests";
import { setProviderCategoriesTx, updateCoverage } from "@/server/modules/providers";
import { providerReach } from "@/server/modules/provider-reach";
import { systemTx } from "@/server/db/client";
import { actor, catId, providerId } from "./helpers";

const primaryOf = async (pid: string) =>
  (await sql()<{ category_id: string }[]>`select category_id from provider_categories where provider_id = ${pid} and is_primary`).map((r) => r.category_id);

describe("rubro principal", () => {
  it("cada profesional con rubros tiene exactamente uno principal", async () => {
    const rows = await sql()<{ provider_id: string; n: number }[]>`
      select provider_id, count(*) filter (where is_primary)::int as n from provider_categories group by provider_id`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.n === 1)).toBe(true);
  });

  it("se elige al guardar los rubros; si no se indica, es el primero; tiene que estar entre los elegidos", async () => {
    const pid = await providerId("Plomería Sosa");
    const [plom, gas] = await Promise.all([catId("plomeria"), catId("gas")]);
    await systemTx((tx) => setProviderCategoriesTx(tx, pid, [plom, gas], gas));
    expect(await primaryOf(pid)).toEqual([gas]);
    await systemTx((tx) => setProviderCategoriesTx(tx, pid, [plom, gas]));
    expect(await primaryOf(pid)).toEqual([plom]);
    await expect(systemTx((tx) => setProviderCategoriesTx(tx, pid, [plom], gas))).rejects.toThrow(/principal/);
  });

  it("en su rubro principal suma puntos; en uno secundario aparece más abajo", async () => {
    const lucia = await actor("lucia");
    const pid = await providerId("Plomería Sosa");
    const [plom, gas] = await Promise.all([catId("plomeria"), catId("gas")]);
    const [z] = await sql()<{ zone_id: string; region: string }[]>`select pz.zone_id, z.region from provider_zones pz join zones z on z.id = pz.zone_id where pz.provider_id = ${pid} limit 1`;
    const originalCats = (await sql()<{ category_id: string }[]>`select category_id from provider_categories where provider_id = ${pid}`).map((r) => r.category_id);
    const scoreIn = async () => (await findCandidatesFor(sql(), { categoryId: plom, zoneId: z.zone_id, region: z.region, preferredWindows: [] })).find((c) => c.providerId === pid)!;
    await systemTx((tx) => setProviderCategoriesTx(tx, pid, [plom, gas], plom));
    const asPrimary = await scoreIn();
    await systemTx((tx) => setProviderCategoriesTx(tx, pid, [plom, gas], gas));
    const asSecondary = await scoreIn();
    expect(asPrimary.primary).toBe(true);
    expect(asSecondary.primary).toBe(false);
    expect(asPrimary.score - asSecondary.score).toBe(12);
    expect(asSecondary.reasons).toContain("Rubro secundario");
    // Lo deja como estaba, usando el mismo camino que el formulario (con sus zonas, horarios y máximo actuales).
    const zones = (await sql()<{ zone_id: string }[]>`select zone_id from provider_zones where provider_id = ${pid}`).map((r) => r.zone_id);
    const slots = await sql()<{ weekday: number; start_minute: number; end_minute: number }[]>`select weekday, start_minute, end_minute from provider_availability where provider_id = ${pid}`;
    const [prov] = await sql()<{ base_zone_id: string | null; max_active_jobs: number; accepting_jobs: boolean }[]>`select base_zone_id, max_active_jobs, accepting_jobs from providers where id = ${pid}`;
    await updateCoverage(lucia, pid, {
      categoryIds: originalCats, primaryCategoryId: plom, zoneIds: zones, baseZoneId: prov.base_zone_id ?? "", acceptingJobs: prov.accepting_jobs, maxActiveJobs: prov.max_active_jobs,
      availability: slots.map((x) => ({ weekday: x.weekday, startMinute: x.start_minute, endMinute: x.end_minute })),
    });
    expect(await primaryOf(pid)).toEqual([plom]);
  });
});

describe("estrellas por rubro", () => {
  it("la calificación en cada rubro sale solo de trabajos de ese rubro", async () => {
    const [r] = await sql()<{ provider_id: string; category_id: string }[]>`
      select provider_id, category_id from reviews_published where category_id is not null group by provider_id, category_id order by count(*) desc limit 1`;
    expect(r).toBeTruthy();
    const [exp] = await sql()<{ n: number; avg: number }[]>`
      select count(*)::int as n, round(avg(rating)::numeric, 1)::float as avg from reviews_published where provider_id = ${r.provider_id} and category_id = ${r.category_id}`;
    const [z] = await sql()<{ zone_id: string; region: string }[]>`select pz.zone_id, z.region from provider_zones pz join zones z on z.id = pz.zone_id where pz.provider_id = ${r.provider_id} limit 1`;
    await sql()`insert into provider_categories (provider_id, category_id) values (${r.provider_id}, ${r.category_id}) on conflict do nothing`;
    const c = (await findCandidatesFor(sql(), { categoryId: r.category_id, zoneId: z.zone_id, region: z.region, preferredWindows: [] })).find((x) => x.providerId === r.provider_id);
    expect(c).toBeTruthy();
    expect(c!.reviews).toBe(exp.n);
    expect(c!.rating).toBe(exp.avg);
    // En otro rubro sin reseñas: cero en ese rubro, pero conserva el general.
    const other = await catId("pintura");
    await sql()`insert into provider_categories (provider_id, category_id) values (${r.provider_id}, ${other}) on conflict do nothing`;
    const o = (await findCandidatesFor(sql(), { categoryId: other, zoneId: z.zone_id, region: z.region, preferredWindows: [] })).find((x) => x.providerId === r.provider_id);
    expect(o!.reviews).toBe(0);
    expect(o!.overallReviews).toBeGreaterThanOrEqual(exp.n);
    await sql()`delete from provider_categories where provider_id = ${r.provider_id} and category_id = ${other} and not is_primary`;
  });
});

describe("¿Cómo te llegan los pedidos?", () => {
  it("explica lo que lo deja afuera y lo que lo sube, con estrellas por rubro", async () => {
    const pid = await providerId("Plomería Sosa");
    await sql()`update providers set accepting_jobs = false where id = ${pid}`;
    try {
      const r = await providerReach(sql(), pid);
      expect(r.tips.find((t) => t.key === "paused")).toMatchObject({ kind: "blocker" });
      expect(r.categories.filter((c) => c.primary)).toHaveLength(1);
      expect(r.categories[0].primary).toBe(true); // el principal, primero
      expect(r.stats.invitations30d).toBeGreaterThanOrEqual(0);
    } finally {
      await sql()`update providers set accepting_jobs = true where id = ${pid}`;
    }
  });
});
