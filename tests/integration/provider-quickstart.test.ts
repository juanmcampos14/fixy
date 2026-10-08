import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { registerUser } from "@/server/modules/users";
import * as providers from "@/server/modules/providers";
import { catId, zoneId } from "./helpers";

describe("alta rápida de profesionales", () => {
  it("crea perfil, rubros, zonas, disponibilidad y precios en un paso; la fuerza del perfil lo refleja", async () => {
    const email = `nuevo-${Date.now()}@example.com`;
    const uid = await registerUser({ fullName: "Mario Gómez", email, password: "clave-segura-123", acceptTerms: true });
    const actor = (await systemTx((tx) => loadActor(tx, uid)))!;
    const [plom, palermo, belgrano] = await Promise.all([catId("plomeria"), zoneId("caba-palermo"), zoneId("caba-belgrano")]);
    const gas = await catId("gas");

    await expect(providers.quickStartProvider(actor, { kind: "individual", displayName: "Mario Plomero", contactPhone: "1155550000", description: "corto", categoryIds: [plom], zoneIds: [palermo] }))
      .rejects.toThrow();

    const pid = await providers.quickStartProvider(actor, {
      kind: "individual", displayName: "Mario Plomero", contactPhone: "1155550000",
      description: "Soy plomero hace 10 años. Destapaciones, cambio de canillas, flexibles y reparación de pérdidas en baños y cocinas. Trabajo prolijo y con garantía escrita.",
      yearsExperience: 10, categoryIds: [plom], zoneIds: [palermo, belgrano], baseZoneId: palermo,
      availability: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 1080 })),
      priceRefs: [{ categoryId: plom, title: "Cambio de flexible", fromMinor: 2_500_000 }, { categoryId: gas, title: "No ofrecido", fromMinor: 100 }],
      aiAssisted: true,
    });
    const [p] = await sql()<{ status: string; base_zone_id: string; profile_ai_assisted: boolean }[]>`select status, base_zone_id, profile_ai_assisted from providers where id = ${pid}`;
    expect(p).toEqual({ status: "pending", base_zone_id: palermo, profile_ai_assisted: true });
    const refs = await sql()<{ title: string }[]>`select title from provider_price_refs where provider_id = ${pid}`;
    expect(refs.map((r) => r.title)).toEqual(["Cambio de flexible"]); // el rubro no ofrecido se descarta
    const s = await providers.getProfileStrength(sql(), pid);
    // descripción 10 + tel 5 + años 5 + cobertura 10 + base 5 + horarios 10 + 1 precio 5 + matrículas (plomería no exige) 5
    expect(s!.score).toBe(55);
    expect(s!.items.find((i) => i.key === "photos")!.earned).toBe(0);
  });
});
