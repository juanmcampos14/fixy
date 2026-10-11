import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { authenticate } from "@/server/modules/users";
import { ensureReviewAccounts, REVIEW_CLIENT_EMAIL, REVIEW_PROVIDER_EMAIL } from "@/server/modules/review-accounts";
import { findCandidates } from "@/server/modules/requests";
import * as requests from "@/server/modules/requests";
import { actor, catId, propertyOf } from "./helpers";

describe("cuentas para la revisión de las tiendas", () => {
  it("solo el dueño las genera", async () => {
    await expect(ensureReviewAccounts(await actor("ana"))).rejects.toThrow(/dueño/);
  });

  it("crea cliente y profesional de prueba que solo se cruzan entre sí, y renueva la contraseña cada vez", async () => {
    const admin = await actor("admin");
    const first = await ensureReviewAccounts(admin);
    const clientId = await authenticate(REVIEW_CLIENT_EMAIL, first.password);
    await authenticate(REVIEW_PROVIDER_EMAIL, first.password);
    const second = await ensureReviewAccounts(admin);
    expect(second.password).not.toBe(first.password);
    await expect(authenticate(REVIEW_CLIENT_EMAIL, first.password)).rejects.toThrow();

    const [sandboxProvider] = await sql()<{ id: string; status: string }[]>`select id, status from providers where sandbox`;
    expect(sandboxProvider.status).toBe("approved");
    expect(await sql()`select 1 from providers where sandbox`).toHaveLength(1);

    // Pedido del revisor: solo aparece el profesional de prueba.
    const reviewer = (await systemTx((tx) => loadActor(tx, clientId)))!;
    const [prop] = await sql()<{ id: string }[]>`select id from properties where owner_user_id = ${clientId}`;
    const reqId = await requests.createRequest(reviewer, {
      propertyId: prop.id, categoryId: await catId("plomeria"), title: "Pierde la canilla", description: "Gotea la canilla de la cocina todo el día.",
      answers: {}, urgency: "normal", preferredWindows: [],
    });
    const invited = await sql()<{ provider_id: string }[]>`select provider_id from request_invitations where request_id = ${reqId}`;
    expect(invited.map((i) => i.provider_id)).toEqual([sandboxProvider.id]);

    // Pedido de un cliente real: el profesional de prueba nunca es candidato.
    const ana = await actor("ana");
    const realReq = await requests.createRequest(ana, {
      propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title: "Pierde el inodoro", description: "Pierde agua la mochila del inodoro del baño.",
      answers: {}, urgency: "normal", preferredWindows: [],
    });
    const candidates = await systemTx((tx) => findCandidates(tx, realReq));
    expect(candidates.some((c) => c.providerId === sandboxProvider.id)).toBe(false);
    const realInvited = await sql()<{ provider_id: string }[]>`select provider_id from request_invitations where request_id = ${realReq}`;
    expect(realInvited.some((i) => i.provider_id === sandboxProvider.id)).toBe(false);
  });
});
