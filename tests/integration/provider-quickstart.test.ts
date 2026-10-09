import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { registerUser } from "@/server/modules/users";
import * as providers from "@/server/modules/providers";
import { actor, catId, providerId, zoneId } from "./helpers";
import { getPublicProfile } from "@/server/queries/provider";
import { listBookableProviders } from "@/server/modules/booking";

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
    // descripción 10 + tel 5 + años 5 + cobertura 10 + base 5 + horarios 5 + 1 precio 5 + matrículas (plomería no exige) 5
    expect(s!.score).toBe(50);
    expect(s!.items.find((i) => i.key === "photos")!.earned).toBe(0);
  });

  it("la foto de perfil es pública, aparece al elegir profesional y suma a la fuerza del perfil", async () => {
    const lucia = await actor("lucia");
    const pid = await providerId("Plomería Sosa");
    const before = (await providers.getProfileStrength(sql(), pid))!.score;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0)]);
    await expect(providers.setProviderAvatar(await actor("martin"), pid, { data: png, name: "x.png" })).rejects.toThrow();
    const fileId = await providers.setProviderAvatar(lucia, pid, { data: png, name: "lucia.png" });
    const [f] = await sql()<{ visibility: string; purpose: string }[]>`select visibility, purpose from files where id = ${fileId}`;
    expect(f).toEqual({ visibility: "public", purpose: "provider_avatar" });
    expect((await providers.getProfileStrength(sql(), pid))!.score).toBe(before + 10);
    const [slug] = await sql()<{ slug: string }[]>`select slug from providers where id = ${pid}`;
    expect((await getPublicProfile(slug.slug))!.provider.avatarUrl).toBe(`/api/files/${fileId}`);
    const list = await listBookableProviders(sql(), { categoryId: await catId("plomeria"), zoneId: await zoneId("caba-palermo"), preferredWindows: [] });
    expect(list.find((p) => p.id === pid)?.avatarUrl).toBe(`/api/files/${fileId}`);
  });
});
