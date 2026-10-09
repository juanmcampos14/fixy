import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { asUser, sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { authenticate, registerUser, signInWithGoogle } from "@/server/modules/users";
import { sendMessage } from "@/server/modules/messaging";
import { consumeWhatsAppLink, peekWhatsAppLink } from "@/server/whatsapp/bot";
import { processPaymentWebhook } from "@/server/modules/payments";
import { actor } from "./helpers";

const reload = async (id: string) => (await systemTx((tx) => loadActor(tx, id)))!;
const isClient = async (userId: string, requestId: string) =>
  (await sql()<{ ok: boolean }[]>`select app.is_request_client(${userId}, ${requestId}) as ok`)[0].ok;

describe("revisión de seguridad", () => {
  it("quien deja la organización pierde el acceso a los pedidos que creó o tenía a cargo", async () => {
    const diego = await actor("diego");
    const [m] = await sql()<{ organization_id: string; role: string }[]>`select organization_id, role from organization_members where user_id = ${diego.id} limit 1`;
    const [r] = await sql()<{ id: string }[]>`
      select id from service_requests where organization_id = ${m.organization_id} and (created_by = ${diego.id} or responsible_user_id = ${diego.id}) limit 1`;
    expect(r).toBeTruthy();
    expect(await isClient(diego.id, r.id)).toBe(true);
    const responsibleOf = await sql()<{ id: string }[]>`select id from service_requests where responsible_user_id = ${diego.id}`;
    try {
      await sql()`delete from organization_members where organization_id = ${m.organization_id} and user_id = ${diego.id}`;
      expect(await isClient(diego.id, r.id)).toBe(false);
      expect(await asUser(diego.id, (tx) => tx`select id from service_requests where organization_id = ${m.organization_id}`)).toHaveLength(0);
      expect(await sql()`select id from service_requests where responsible_user_id = ${diego.id}`).toHaveLength(0);
    } finally {
      await sql()`insert into organization_members (organization_id, user_id, role) values (${m.organization_id}, ${diego.id}, ${m.role}) on conflict do nothing`;
      for (const x of responsibleOf) await sql()`update service_requests set responsible_user_id = ${diego.id} where id = ${x.id}`;
    }
  });

  it("un miembro del equipo que solo ve no puede escribir como Fixy en conversaciones", async () => {
    const email = `socio.${Date.now()}@test.local`;
    const id = await registerUser({ fullName: "Socio Lector", email, password: "password-123", acceptTerms: true });
    await sql()`update users set platform_role = 'team' where id = ${id}`;
    await sql()`insert into admin_permissions (user_id, section, level) values (${id}, 'socios', 'view')`;
    const [conv] = await sql()<{ id: string }[]>`select id from conversations limit 1`;
    await expect(sendMessage(await reload(id), conv.id, "Llamame al 11 5555 0000")).rejects.toThrow();
    const [{ n }] = await sql()<{ n: number }[]>`select count(*)::int as n from messages where sender_id = ${id}`;
    expect(n).toBe(0);
  });

  it("vincular Google a una cuenta creada con contraseña anula esa contraseña (podía ser de otra persona)", async () => {
    const email = `previo.${Date.now()}@gmail.com`;
    const id = await registerUser({ fullName: "Cuenta Previa", email, password: "password-123", acceptTerms: true });
    await sql()`insert into sessions (token_hash, user_id, expires_at) values (${randomBytes(16).toString("hex")}, ${id}, now() + interval '1 day')`;
    expect((await signInWithGoogle({ sub: `g-prev-${Date.now()}`, email, emailVerified: true, name: "Dueña Real" })).userId).toBe(id);
    await expect(authenticate(email, "password-123")).rejects.toThrow();
    expect(await sql()`select 1 from sessions where user_id = ${id}`).toHaveLength(0);
  });

  it("el link de WhatsApp muestra solo el final del número y no reemplaza un WhatsApp ya vinculado", async () => {
    const token = randomBytes(24).toString("base64url");
    const phone = `54911${String(Date.now()).slice(-8)}`;
    await sql()`insert into whatsapp_links (token_hash, phone, data) values (${createHash("sha256").update(token).digest("hex")}, ${phone}, ${sql().json({} as never)})`;
    expect(await peekWhatsAppLink(token)).toEqual({ phoneTail: phone.slice(-4), usedBy: null });
    const email = `con.wa.${Date.now()}@test.local`;
    const id = await registerUser({ fullName: "Ya Vinculada", email, password: "password-123", acceptTerms: true });
    await sql()`update users set whatsapp_phone = ${`54911${String(Date.now() + 7).slice(-8)}`} where id = ${id}`;
    const r = await consumeWhatsAppLink(token, id);
    expect("error" in r && r.error).toMatch(/otro WhatsApp/);
    const [u] = await sql()<{ whatsapp_phone: string }[]>`select whatsapp_phone from users where id = ${id}`;
    expect(u.whatsapp_phone).not.toBe(phone);
  });

  it("un aviso de pago sin firma válida no se guarda ni bloquea el aviso real con el mismo id", async () => {
    const eventId = `evt-falso-${Date.now()}`;
    const body = JSON.stringify({ id: eventId, type: "payment", data: { id: "123456" } });
    expect(await processPaymentWebhook("mock", body, new Headers({ "x-mock-signature": "0".repeat(64) }))).toBe("rejected");
    expect(await sql()`select 1 from payment_events where external_event_id = ${eventId}`).toHaveLength(0);
  });

  it("las notas del barrio que nombran el barrio o la calle quedan ocultas hasta revelar la dirección", async () => {
    const m = async (notes: string) =>
      (await sql()<{ ok: boolean }[]>`select app.mentions_place(${notes}, ${"Los Álamos"}, ${"Av. Santa Fe 3500, CABA"}) as ok`)[0].ok;
    expect(await m("Avisame 24 h antes")).toBe(false);
    expect(await m("Barrio los álamos, lote 214")).toBe(true);
    expect(await m("Entrada por av. santa fe")).toBe(true);
  });
});
