import { describe, expect, it } from "vitest";
import { asUser, sql } from "@/server/db/client";
import * as requests from "@/server/modules/requests";
import * as quotes from "@/server/modules/quotes";
import { listRecoveries, settleRecoveryManually, waiveRecovery } from "@/server/modules/withdrawals";
import { actor, catId, invitationFor, ledgerBalance, propertyOf, providerId, totalOf } from "./helpers";

describe("pedido con presupuesto del cliente", () => {
  it("los profesionales se anotan por el presupuesto u ofrecen menos; pueden bajar su oferta y el cliente elige", async () => {
    const [ana, roberto] = await Promise.all([actor("ana"), actor("roberto")]);
    const pid = await providerId("Servicios Integrales Norte");
    const reqId = await requests.createRequest(ana, {
      propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title: "Cambiar el depósito del inodoro",
      description: "El depósito pierde agua y quiero cambiarlo por uno nuevo.", answers: {}, urgency: "normal", preferredWindows: [],
      budgetMinor: 6_000_000,
    });
    const [r] = await sql()<{ request_mode: string; budget_minor: number }[]>`select request_mode, budget_minor::int as budget_minor from service_requests where id = ${reqId}`;
    expect(r).toEqual({ request_mode: "budget", budget_minor: 6_000_000 });
    const invId = await invitationFor(reqId, pid);
    expect(invId).toBeTruthy();
    const [n] = await sql()<{ title: string }[]>`select n.title from notifications n join provider_members m on m.user_id = n.user_id where m.provider_id = ${pid} order by n.created_at desc limit 1`;
    expect(n.title).toContain("ofrece");

    // No puede ofertar por encima del presupuesto; sí por el presupuesto
    await expect(quotes.placeBid(roberto, { invitationId: invId, amountMinor: 6_500_000 })).rejects.toThrow(/no puede superarlo/);
    const q1 = await quotes.placeBid(roberto, { invitationId: invId, amountMinor: 6_000_000, materialsIncluded: true });
    // Mejorar la oferta: solo para abajo
    await expect(quotes.placeBid(roberto, { invitationId: invId, amountMinor: 6_000_000, replacing: q1 })).rejects.toThrow(/menor/);
    const q2 = await quotes.placeBid(roberto, { invitationId: invId, amountMinor: 5_200_000, replacing: q1 });
    const states = await sql()<{ id: string; status: string; subtotal_minor: number; materials_included: boolean }[]>`select id, status, subtotal_minor, materials_included from quotes where request_id = ${reqId} order by created_at`;
    expect(states.map((s) => s.status)).toEqual(["withdrawn", "sent"]);
    expect(states[1]).toMatchObject({ id: q2, subtotal_minor: 5_200_000, materials_included: true });

    // La mejor oferta la ven los invitados (sin nombres), no otros usuarios
    const best = async (uid: string) => (await asUser(uid, (tx) => tx<{ v: number | null }[]>`select app.best_offer_minor(${reqId})::int as v`))[0].v;
    expect(await best(roberto.id)).toBe(5_200_000);
    expect(await best((await actor("bruno")).id)).toBeNull();

    // El cliente contrata la oferta como cualquier presupuesto
    const { jobId } = await quotes.acceptQuote(ana, q2, { totalMinor: await totalOf(q2), acceptedTerms: true });
    expect(jobId).toBeTruthy();
  });
});

describe("recuperos desde Finanzas", () => {
  it("la operación registra la devolución del profesional; solo un administrador condona", async () => {
    const pid = await providerId("Servicios Integrales Norte");
    const [{ id: jobId }] = await sql()<{ id: string }[]>`select id from jobs where provider_id = ${pid} limit 1`;
    const mk = async (amount: number) => (await sql()<{ id: string }[]>`
      insert into provider_recoveries (provider_id, job_id, amount_minor, reason, is_test) values (${pid}, ${jobId}, ${amount}, 'Prueba de recupero', true) returning id`)[0].id;
    const a = await mk(10_000);
    const b = await mk(20_000);
    expect((await listRecoveries(sql())).some((x) => x.id === a)).toBe(true);
    const [operador, admin, roberto] = await Promise.all([actor("operador"), actor("admin"), actor("roberto")]);
    await expect(settleRecoveryManually(roberto, a, "TRF-1")).rejects.toThrow();
    await settleRecoveryManually(operador, a, "TRF-REC-1");
    await expect(settleRecoveryManually(operador, a, "TRF-REC-1")).rejects.toThrow(/pendientes/);
    await expect(waiveRecovery(operador, b, "Error de la plataforma al cobrar")).rejects.toThrow();
    await waiveRecovery(admin, b, "Error de la plataforma al cobrar");
    const rows = await sql()<{ id: string; status: string }[]>`select id, status from provider_recoveries where id in (${a}, ${b}) order by amount_minor`;
    expect(rows.map((r) => r.status)).toEqual(["settled", "waived"]);
    expect(await ledgerBalance()).toBe(0);
  });
});
