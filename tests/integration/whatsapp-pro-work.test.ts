import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { notify } from "@/server/notifications";
import { handleInbound, type Inbound } from "@/server/whatsapp/bot";
import { parseDay } from "@/server/whatsapp/pro-work";
import { createProperty } from "@/server/modules/properties";
import * as requests from "@/server/modules/requests";
import { storeFile } from "@/server/storage";
import { actor, catId, zoneId } from "./helpers";

let seq = 0;
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, Math.floor(Math.random() * 200))]);
const phoneFor = (n: number) => `54911${String(Date.now()).slice(-6)}${String(n).padStart(2, "0")}`;
const msg = (from: string, m: Partial<Inbound>): Inbound => ({ id: `wamid.work.${Date.now()}.${seq++}`, from, type: "text", ...m });
const outs = async (phone: string, n = 2) =>
  (await sql()<{ body: Record<string, unknown> }[]>`select body from whatsapp_messages where phone = ${phone} and direction = 'out' order by id desc limit ${n}`).map((r) => JSON.stringify(r.body));
const last = async (phone: string) => (await outs(phone, 1))[0];
const step = async (phone: string) => (await sql()<{ state: { step: string } }[]>`select state from whatsapp_conversations where phone = ${phone}`)[0].state.step;
const say = (phone: string, text: string) => handleInbound(msg(phone, { text }));
const tap = (phone: string, replyId: string) => handleInbound(msg(phone, { type: "interactive", replyId, text: replyId }));

/** Se anota por WhatsApp un profesional de un rubro y zona que nadie más cubre: así los pedidos de prueba le llegan a él. */
async function signUp(phone: string, name: string, trade: string, zone: string, approved = true) {
  await say(phone, "Hola, quiero trabajar con Fixy");
  await say(phone, name);
  await say(phone, trade);
  await say(phone, zone);
  await tap(phone, "pro_accept");
  const [p] = await sql()<{ id: string; user_id: string }[]>`
    select p.id, m.user_id from providers p join provider_members m on m.provider_id = p.id join users u on u.id = m.user_id where u.whatsapp_phone = ${phone}`;
  if (approved) {
    await sql()`update providers set status = 'in_review' where id = ${p.id}`;
    await sql()`update providers set status = 'approved', identity_status = 'verified', approved_at = now() where id = ${p.id}`;
  }
  return p;
}
async function requestFor(zone: string, category: string, extra: Partial<Parameters<typeof requests.createRequest>[1]> = {}) {
  const ana = await actor("ana");
  const propertyId = await createProperty(ana, { kind: "home", label: `Casa ${Date.now()}-${seq++}`, addressLine: "Calle Falsa 123", zoneId: await zoneId(zone) });
  return requests.createRequest(ana, {
    propertyId, categoryId: await catId(category), title: "Arreglo de prueba", description: "Necesito a alguien que venga a ver este trabajo en casa.",
    answers: {}, urgency: "normal", preferredWindows: [], ...extra,
  });
}
const invitationOf = async (requestId: string, providerId: string) => (await sql()<{ id: string; status: string }[]>`select id, status from request_invitations where request_id = ${requestId} and provider_id = ${providerId}`)[0];

describe("el profesional trabaja desde WhatsApp", () => {
  it("entiende los días que escribe la gente", () => {
    expect(parseDay("hoy")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseDay("mañana")).not.toBe(parseDay("hoy"));
    expect(parseDay("el viernes")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parseDay("cualquier día")).toBeNull();
    expect(parseDay("32/13")).toBeNull();
  });

  it("pedido de presupuestos: lo ve con «pedidos», pasa su precio y queda enviado al cliente", async () => {
    const phone = phoneFor(1);
    const p = await signUp(phone, "Lucas Marmolero", "marmolero", "Tandil, Buenos Aires");
    await say(phone, "pedidos");
    expect(await last(phone)).toContain("no hay pedidos");

    const reqId = await requestFor("pba-tandil", "marmoleria");
    const inv = await invitationOf(reqId, p.id);
    expect(inv.status).toBe("invited");

    await say(phone, "pedidos");
    expect(await last(phone)).toContain(`pw:inv:${inv.id}`);
    await tap(phone, `pw:inv:${inv.id}`);
    const detail = await last(phone);
    expect(detail).toContain("Arreglo de prueba");
    expect(detail).toContain("Tandil");
    expect(detail).not.toContain("Calle Falsa"); // la dirección no se muestra
    expect((await invitationOf(reqId, p.id)).status).toBe("viewed");

    await tap(phone, "pw_price");
    await say(phone, "cuarenta y cinco");
    expect(await step(phone)).toBe("pw_price"); // no es un número: repregunta
    await say(phone, "45000");
    expect(await last(phone)).toContain("45.000");
    await tap(phone, "pw_send");
    const [q] = await sql()<{ status: string; subtotal_minor: number; materials_included: boolean }[]>`select status, subtotal_minor::int as subtotal_minor, materials_included from quotes where invitation_id = ${inv.id}`;
    expect(q).toEqual({ status: "sent", subtotal_minor: 4_500_000, materials_included: true });
    expect(await step(phone)).toBe("done");
  });

  it("pedido con precio del cliente: se anota por ese precio, u ofrece menos", async () => {
    const phone = phoneFor(2);
    const p = await signUp(phone, "Nora Tapicera", "tapicera", "Junín, Buenos Aires");
    const first = await requestFor("pba-junin", "tapiceria", { budgetMinor: 6_000_000 });
    const inv1 = await invitationOf(first, p.id);
    await tap(phone, `pw:inv:${inv1.id}`);
    expect(await last(phone)).toContain("60.000");
    await tap(phone, "pw_accept");
    expect((await sql()<{ s: number }[]>`select subtotal_minor::int as s from quotes where invitation_id = ${inv1.id}`)[0].s).toBe(6_000_000);

    const second = await requestFor("pba-junin", "tapiceria", { budgetMinor: 6_000_000 });
    const inv2 = await invitationOf(second, p.id);
    await tap(phone, `pw:inv:${inv2.id}`);
    await tap(phone, "pw_lower");
    await say(phone, "70000");
    expect(await last(phone)).toContain("por debajo"); // no puede ofrecer más que el cliente
    await say(phone, "50 mil");
    await tap(phone, "pw_send");
    expect((await sql()<{ s: number }[]>`select subtotal_minor::int as s from quotes where invitation_id = ${inv2.id}`)[0].s).toBe(5_000_000);
  });

  it("el cliente lo eligió: acepta proponiendo día y horario; o dice que no puede", async () => {
    const phone = phoneFor(3);
    const p = await signUp(phone, "Raúl Ascensorista", "ascensores", "Olavarría, Buenos Aires");
    const reqId = await requestFor("pba-olavarria", "ascensores", { targetProviderId: p.id });
    const inv = await invitationOf(reqId, p.id);
    await tap(phone, `pw:inv:${inv.id}`);
    expect(await last(phone)).toContain("te eligió a vos");
    await tap(phone, "pw_accept");
    await say(phone, "no sé");
    expect(await step(phone)).toBe("pw_day");
    await tap(phone, "d_1");
    await tap(phone, "w_pm");
    const [q] = await sql()<{ mode: string; proposed_window: string; proposed_date: string | null }[]>`select mode, proposed_window, proposed_date::text from quotes where invitation_id = ${inv.id}`;
    expect(q.mode).toBe("diagnostic");
    expect(q.proposed_window).toContain("tarde");
    expect(q.proposed_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const other = await requestFor("pba-olavarria", "ascensores", { targetProviderId: p.id });
    const inv2 = await invitationOf(other, p.id);
    await tap(phone, `pw:inv:${inv2.id}`);
    await tap(phone, "pw_decline");
    expect((await invitationOf(other, p.id)).status).toBe("declined");
  });

  it("verifica su perfil mandando el DNI y carga dónde cobrar", async () => {
    const phone = phoneFor(4);
    const p = await signUp(phone, "Elsa Domótica", "domotica", "Luján, Buenos Aires", false);
    // Sin verificar ve el pedido, pero para responderlo primero le pedimos el DNI (misma regla que en el panel).
    const reqId = await requestFor("pba-lujan", "domotica");
    await tap(phone, `pw:inv:${(await invitationOf(reqId, p.id)).id}`);
    expect((await outs(phone, 2)).join(" ")).toContain("verificar tu identidad");
    expect(await step(phone)).toBe("pw_dni");
    await say(phone, "después");
    const photo = async () => {
      const fileId = await storeFile(sql(), { data: jpeg(), originalName: "wa.jpg", uploadedBy: p.user_id, purpose: "request_photo", ownerType: null, ownerId: null, allowPdf: false });
      await sql()`insert into whatsapp_media (phone, file_id) values (${phone}, ${fileId})`;
      return fileId;
    };
    await tap(phone, "pw_dni");
    expect(await last(phone)).toContain("frente");
    await say(phone, "ya va");
    expect(await step(phone)).toBe("pw_dni");
    const front = await photo();
    await handleInbound(msg(phone, { type: "image", fileId: front }));
    expect(await last(phone)).toContain("dorso");
    await handleInbound(msg(phone, { type: "image", fileId: await photo() }));
    expect(await last(phone)).toContain("verificado");
    const docs = await sql()<{ kind: string }[]>`select kind from provider_documents where provider_id = ${p.id}`;
    expect(docs).toHaveLength(2);
    const [f] = await sql()<{ purpose: string; owner_type: string; owner_id: string }[]>`select purpose, owner_type, owner_id from files where id = ${front}`;
    expect(f).toEqual({ purpose: "provider_document", owner_type: "provider", owner_id: p.id });
    expect(await sql()`select 1 from whatsapp_media where file_id = ${front}`).toHaveLength(0); // no queda suelta para un pedido
    const [prov] = await sql()<{ identity_status: string; status: string }[]>`select identity_status, status from providers where id = ${p.id}`;
    expect(prov).toEqual({ identity_status: "pending", status: "in_review" });

    await say(phone, "cobro");
    await say(phone, "hola");
    expect(await step(phone)).toBe("pw_bank_account"); // eso no es un alias
    await say(phone, "elsa.domo.mp");
    await tap(phone, "bank_self");
    await say(phone, "123");
    expect(await step(phone)).toBe("pw_bank_tax");
    await say(phone, "27-12345678-9");
    const [b] = await sql()<{ alias: string; holder_name: string; holder_tax_id: string }[]>`select alias, holder_name, holder_tax_id from provider_bank_accounts where provider_id = ${p.id}`;
    expect(b).toEqual({ alias: "elsa.domo.mp", holder_name: "Elsa Domótica", holder_tax_id: "27123456789" });
    expect((await sql()<{ s: string }[]>`select payouts_status as s from providers where id = ${p.id}`)[0].s).toBe("enabled");
  });

  it("sin email, cualquier novedad le llega por WhatsApp", async () => {
    const phone = phoneFor(6);
    const p = await signUp(phone, "Omar Solar", "paneles solares", "Tandil, Buenos Aires");
    await systemTx((tx) => notify(tx, [p.user_id], { type: "provider_review", title: "Tu perfil quedó verificado", body: "Ya podés responder pedidos.", link: "/proveedor" }));
    const rows = await sql()<{ channel: string; payload: { template?: string; audience?: string; text?: string } }[]>`
      select channel, payload from outbox where recipient_user_id = ${p.user_id} and payload->>'audience' = 'account'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "whatsapp", payload: { template: "notice" } });
    expect(rows[0].payload.text).toContain("Tu perfil quedó verificado");
    // Una cuenta con email no recibe este aviso duplicado por WhatsApp.
    const ana = await actor("ana");
    await systemTx((tx) => notify(tx, [ana.id], { type: "message", title: "Mensaje nuevo", email: false }));
    expect(await sql()`select 1 from outbox where recipient_user_id = ${ana.id} and payload->>'audience' = 'account'`).toHaveLength(0);
  });

  it("quien no es profesional no entra a estos flujos", async () => {
    const phone = phoneFor(5);
    await say(phone, "dni");
    expect(await last(phone)).toContain("profesionales registrados");
    expect(await step(phone)).not.toMatch(/^pw_/);
  });
});
