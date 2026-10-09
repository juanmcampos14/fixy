import { describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/server/db/client";
import { handleInbound, type Inbound } from "@/server/whatsapp/bot";
import { byRules, looksLikeAddress, parseBudget } from "@/server/whatsapp/understand";
import { registerUser } from "@/server/modules/users";

let seq = 0;
const phoneFor = (n: number) => `54911${String(Date.now()).slice(-6)}${String(n).padStart(2, "0")}`;
const msg = (from: string, m: Partial<Inbound>): Inbound => ({ id: `wamid.flow.${Date.now()}.${seq++}`, from, type: "text", ...m });
const outs = async (phone: string, n = 4) =>
  (await sql()<{ body: Record<string, unknown> }[]>`select body from whatsapp_messages where phone = ${phone} and direction = 'out' order by id desc limit ${n}`).map((r) => JSON.stringify(r.body));
const state = async (phone: string) => (await sql()<{ state: { step: string; description?: string; address?: { addressLine?: string } } }[]>`select state from whatsapp_conversations where phone = ${phone}`)[0].state;
const ids = (s: string) => [...s.matchAll(/"id":"([^"]+)"/g)].map((m) => m[1]);

describe("WhatsApp: entiende preguntas en cualquier paso", () => {
  it("reglas: pregunta ≠ dirección; montos en pesos", () => {
    expect(looksLikeAddress("puedo agregar por aca mas detalles a mi pedido?")).toBe(false);
    expect(looksLikeAddress("Av. Cabildo 2000, Belgrano")).toBe(true);
    expect(looksLikeAddress("Escobar")).toBe(true);
    expect(byRules("puedo agregar por aca mas detalles a mi pedido?", { expecting: "address", open: [] }).kind).toBe("add_details");
    expect(byRules("Pero sabes de que trabajo me refiero?", { expecting: "details", open: [] }).kind).toBe("question");
    expect(parseBudget("60.000")).toBe(6_000_000);
    expect(parseBudget("$ 60000")).toBe(6_000_000);
    expect(parseBudget("60 mil")).toBe(6_000_000);
    expect(parseBudget("1,5 millones")).toBe(150_000_000);
    expect(parseBudget("no sé")).toBeNull();
  });

  it("sin cuenta vinculada: una pregunta sobre su pedido no arma un pedido nuevo y ofrece vincular", async () => {
    const phone = phoneFor(1);
    await handleInbound(msg(phone, { text: "puedo agregar por aca mas detalles a mi pedido?" }));
    const [last] = await outs(phone, 1);
    expect(last).toContain("vincul");
    expect(ids(last)).toContain("link_account");
    expect((await state(phone)).description).toBeUndefined();
  });

  it("en el paso de la dirección, una pregunta no se toma como dirección", async () => {
    const phone = phoneFor(2);
    await handleInbound(msg(phone, { text: "Se rompió el flotante del tanque de agua y no para de cargar" }));
    expect((await state(phone)).step).toBe("location");
    await handleInbound(msg(phone, { text: "puedo agregar por aca mas detalles a mi pedido?" }));
    const s = await state(phone);
    expect(s.step).toBe("location");
    expect(s.address?.addressLine ?? "").not.toContain("puedo");
    expect((await outs(phone, 3)).join(" ")).not.toContain("Tu pedido");
  });

  it("cuenta vinculada con un pedido sin enviar: se lo ofrece y lo envía desde WhatsApp", async () => {
    const phone = phoneFor(3);
    const email = `wa.flow.${Date.now()}@test.local`;
    const userId = await registerUser({ fullName: "Juana Flujo", email, password: "password-123", acceptTerms: true });
    await sql()`update users set whatsapp_phone = ${phone} where id = ${userId}`;
    const [zone] = await sql()<{ id: string }[]>`select id from zones where code <> 'otra-zona' order by sort limit 1`;
    const data = {
      description: "Necesito un electricista para cambiar un tomacorriente", title: "Cambiar un tomacorriente", categorySlug: "electricidad", serviceId: null,
      answers: {}, urgency: "normal", windows: [], propertyId: null, accessInfo: "", targetProviderSlug: null, previousJobId: null,
      newProperty: { kind: "home", label: "Casa", addressLine: "Av. Cabildo 2000", addressExtra: "", zoneId: zone.id },
    };
    await sql()`insert into whatsapp_links (token_hash, phone, data, used_at, used_by)
      values (${createHash("sha256").update(randomBytes(8)).digest("hex")}, ${phone}, ${sql().json(data as never)}, now(), ${userId})`;

    await handleInbound(msg(phone, { text: "como va mi pedido?" }));
    const [offer] = await outs(phone, 1);
    expect(offer).toContain("Cambiar un tomacorriente");
    expect(ids(offer)).toContain("draft_send");
    await handleInbound(msg(phone, { type: "interactive", replyId: "draft_send" }));
    const [{ n }] = await sql()<{ n: number }[]>`select count(*)::int as n from service_requests where created_by = ${userId} and channel = 'whatsapp'`;
    expect(n).toBe(1);
    expect((await outs(phone, 1))[0]).toMatch(/pedido \*S-\d+\* enviado/);
  });

  it("en los detalles, una pregunta se responde y no se suma al pedido; se puede decir cuánto pagar", async () => {
    const phone = phoneFor(4);
    await handleInbound(msg(phone, { text: "Gotea la canilla de la cocina y pierde agua abajo de la mesada" }));
    await handleInbound(msg(phone, { type: "location", location: { lat: -34.5889, lng: -58.4199 } }));
    const st = await state(phone);
    if (st.step !== "pros") return; // sin profesionales en la zona de prueba: no aplica la lista
    await handleInbound(msg(phone, { type: "interactive", replyId: "budget" }));
    expect((await state(phone)).step).toBe("budget");
    await handleInbound(msg(phone, { text: "60 mil" }));
    let s = await state(phone);
    if (s.step === "street") {
      await handleInbound(msg(phone, { text: "Av. Santa Fe 3500" }));
      s = await state(phone);
    }
    expect(s.step).toBe("confirm");
    expect((await outs(phone, 1))[0].replace(/\u00a0/g, " ")).toContain("60.000");
    await handleInbound(msg(phone, { type: "interactive", replyId: "details" }));
    await handleInbound(msg(phone, { text: "Pero sabes de que trabajo me refiero?" }));
    expect((await state(phone)) as { extra?: string }).not.toHaveProperty("extra");
  });
});
