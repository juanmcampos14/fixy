import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { registerUser } from "@/server/modules/users";
import * as providers from "@/server/modules/providers";
import * as requests from "@/server/modules/requests";
import * as quotes from "@/server/modules/quotes";
import { listBookableProviders } from "@/server/modules/booking";
import { actor, catId, invitationFor, propertyOf, zoneId } from "./helpers";

describe("profesionales sin verificar", () => {
  it("se muestran (después de los verificados), el cliente puede elegirlos y deben verificarse para aceptar", async () => {
    const uid = await registerUser({ fullName: "Nuevo Plomero", email: `sinverificar-${Date.now()}@example.com`, password: "clave-segura-123", acceptTerms: true });
    const me = (await systemTx((tx) => loadActor(tx, uid)))!;
    const [plom, palermo] = await Promise.all([catId("plomeria"), zoneId("caba-palermo")]);
    const pid = await providers.quickStartProvider(me, {
      kind: "individual", displayName: "Plomero Sin Verificar", contactPhone: "1155559999",
      description: "Arreglo pérdidas, canillas y destapaciones en Palermo con materiales de primera calidad.", categoryIds: [plom], zoneIds: [palermo],
    });

    const list = await listBookableProviders(sql(), { categoryId: plom, zoneId: palermo, preferredWindows: [] });
    const mine = list.find((p) => p.id === pid);
    expect(mine).toBeTruthy();
    expect(mine!.verified).toBe(false);
    const firstUnverified = list.findIndex((p) => !p.verified);
    expect(list.slice(firstUnverified).every((p) => !p.verified)).toBe(true); // verificados primero

    const ana = await actor("ana");
    const reqId = await requests.createRequest(ana, {
      propertyId: await propertyOf("ana", "Casa"), categoryId: plom, title: "Pierde la canilla", description: "Gotea la canilla del baño todo el día.",
      answers: {}, urgency: "urgent", preferredWindows: [], targetProviderId: pid,
    });
    const [inv] = await sql()<{ id: string; hours: number }[]>`
      select id, extract(epoch from (respond_by - created_at)) / 3600 as hours from request_invitations where request_id = ${reqId} and provider_id = ${pid}`;
    expect(Math.round(inv.hours)).toBe(48); // más tiempo para verificarse, aunque sea urgente
    const [n] = await sql()<{ body: string }[]>`select n.body from notifications n join provider_members m on m.user_id = n.user_id where m.provider_id = ${pid} and n.type = 'invitation' order by n.created_at desc limit 1`;
    expect(n.body).toMatch(/verificá tu cuenta/);
    const [staff] = await sql()<{ n: number }[]>`select count(*)::int as n from notifications where title like ${"Verificación prioritaria%"}`;
    expect(staff.n).toBeGreaterThan(0);

    await expect(quotes.acceptBooking(me, await invitationFor(reqId, pid), { proposedDate: "2026-12-10", proposedWindow: "Mañana", note: "" })).rejects.toThrow(/verificá tu cuenta/);
  });
});
