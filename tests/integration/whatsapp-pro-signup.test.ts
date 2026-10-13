import { describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import { handleInbound, type Inbound } from "@/server/whatsapp/bot";
import { peekLoginLink, redeemLoginLink, refFromText, tradesFromText, wantsProSignup } from "@/server/whatsapp/pro-signup";
import { normalize } from "@/server/assistant/rules";
import { processOutbox } from "@/server/notifications";

let seq = 0;
const phoneFor = (n: number) => `54911${String(Date.now()).slice(-6)}${String(n).padStart(2, "0")}`;
const msg = (from: string, m: Partial<Inbound>): Inbound => ({ id: `wamid.pro.${Date.now()}.${seq++}`, from, type: "text", ...m });
const outs = async (phone: string, n = 3) =>
  (await sql()<{ body: Record<string, unknown> }[]>`select body from whatsapp_messages where phone = ${phone} and direction = 'out' order by id desc limit ${n}`).map((r) => JSON.stringify(r.body));
const state = async (phone: string) => (await sql()<{ state: { step: string } }[]>`select state from whatsapp_conversations where phone = ${phone}`)[0].state;
const say = (phone: string, text: string) => handleInbound(msg(phone, { text }));
const tap = (phone: string, replyId: string) => handleInbound(msg(phone, { type: "interactive", replyId, text: replyId }));

describe("alta de profesionales por WhatsApp", () => {
  it("reconoce la intención, los oficios y la invitación", () => {
    expect(wantsProSignup(normalize("Hola, quiero trabajar con Fixy"))).toBe(true);
    expect(wantsProSignup(normalize("soy plomero y quiero ofrecer mis servicios"))).toBe(true);
    expect(wantsProSignup(normalize("pierde la canilla de la cocina"))).toBe(false);
    expect(wantsProSignup(normalize("quiero un plomero que venga a trabajar a casa"))).toBe(false);
    expect(tradesFromText("soy plomero y gasista")).toEqual(["plomeria", "gas"]);
    expect(tradesFromText("arreglo aires y heladeras")).toEqual(["climatizacion", "electrodomesticos"]);
    expect(tradesFromText("corto el pasto y hago poda")).toEqual(["jardineria"]);
    expect(tradesFromText("xyz")).toEqual([]);
    expect(refFromText("Hola, quiero trabajar con Fixy (invitación plomeria-sosa-1a2b)")).toBe("plomeria-sosa-1a2b");
  });

  it("con tres respuestas y un botón queda la cuenta y el perfil, listo para recibir pedidos", async () => {
    const phone = phoneFor(1);
    await say(phone, "Hola, quiero trabajar con Fixy");
    expect((await state(phone)).step).toBe("pro_name");
    await say(phone, "juan carlos pérez");
    expect((await state(phone)).step).toBe("pro_trade");
    await say(phone, "soy plomero y gasista");
    expect((await state(phone)).step).toBe("pro_zone");
    await say(phone, "Morón, Buenos Aires");
    expect((await state(phone)).step).toBe("pro_terms");
    const [summary] = await outs(phone, 1);
    expect(summary).toContain("Juan Carlos Pérez");
    expect(summary).toContain("Plomería");
    expect(summary).toContain("Morón");
    // Sin aceptar no se crea nada.
    expect(await sql()`select 1 from users where whatsapp_phone = ${phone}`).toHaveLength(0);

    await tap(phone, "pro_accept");
    const [u] = await sql()<{ id: string; full_name: string; email_placeholder: boolean; password_hash: string | null; wa_provider_alerts: boolean }[]>`
      select id, full_name, email_placeholder, password_hash, wa_provider_alerts from users where whatsapp_phone = ${phone}`;
    expect(u).toMatchObject({ full_name: "Juan Carlos Pérez", email_placeholder: true, password_hash: null, wa_provider_alerts: true });
    const [p] = await sql()<{ id: string; status: string; accepting_jobs: boolean; signup_source: string; cats: string[]; zones: string[]; slots: number }[]>`
      select p.id, p.status, p.accepting_jobs, p.signup_source,
        (select array_agg(c.slug order by c.slug) from provider_categories pc join categories c on c.id = pc.category_id where pc.provider_id = p.id) as cats,
        (select array_agg(z.code) from provider_zones pz join zones z on z.id = pz.zone_id where pz.provider_id = p.id) as zones,
        (select count(*)::int from provider_availability a where a.provider_id = p.id) as slots
      from providers p join provider_members m on m.provider_id = p.id where m.user_id = ${u.id}`;
    expect(p).toMatchObject({ status: "pending", accepting_jobs: true, signup_source: "whatsapp", cats: ["gas", "plomeria"], zones: ["gba-moron"], slots: 6 });
    // Aceptó términos generales, privacidad y condiciones para profesionales.
    const kinds = await sql()<{ kind: string }[]>`select d.kind from policy_acceptances a join policy_documents d on d.id = a.policy_id where a.user_id = ${u.id} order by d.kind`;
    expect(kinds.map((k) => k.kind)).toEqual(["privacy", "provider_terms", "terms"]);
    const closing = (await outs(phone, 2)).join(" ");
    expect(closing).toContain("Ya estás en Fixy");
    expect(closing).toContain("pw_dni"); // ofrece verificar el perfil en el momento
    expect((await state(phone)).step).toBe("done");

    // No se le escribe a un email que no existe.
    await sql()`insert into outbox (channel, recipient_user_id, payload) values ('email', ${u.id}, ${sql().json({ subject: "x", text: "y", link: null })})`;
    await processOutbox(500);
    expect((await sql()<{ status: string }[]>`select status from outbox where recipient_user_id = ${u.id} and channel = 'email'`)[0].status).toBe("pending");

    // Si vuelve a escribir que quiere sumarse, no se duplica.
    await say(phone, "quiero trabajar con fixy");
    expect((await outs(phone, 1))[0]).toContain("Ya estás en Fixy como");
    expect(await sql()`select 1 from provider_members where user_id = ${u.id}`).toHaveLength(1);

    // "entrar": link de un solo uso para abrir su panel.
    await say(phone, "entrar");
    const token = (await outs(phone, 1))[0].match(/\/wa\/entrar\/([A-Za-z0-9_-]+)/)![1];
    expect(await peekLoginLink(token)).toEqual({ firstName: "Juan" });
    expect(await redeemLoginLink(token)).toEqual({ userId: u.id, home: "/proveedor" });
    expect(await redeemLoginLink(token)).toBeNull();
    expect(await peekLoginLink(token)).toBeNull();
  });

  it("no se traba si no entiende: repregunta una vez y sigue; se puede corregir y cancelar", async () => {
    const phone = phoneFor(2);
    await say(phone, "quiero sumarme a fixy como profesional");
    await say(phone, "Hola quiero trabajar");
    expect((await state(phone)).step).toBe("pro_name"); // eso no es un nombre
    await say(phone, "Marta Gómez");
    await say(phone, "hago de todo un poco");
    expect((await state(phone)).step).toBe("pro_zone"); // "de todo" → arreglos generales
    await say(phone, "asdfgh");
    expect((await state(phone)).step).toBe("pro_zone");
    expect((await outs(phone, 1))[0]).toContain("localidad y la provincia");
    await say(phone, "Córdoba capital");
    expect((await outs(phone, 1))[0]).toContain("Córdoba capital");
    await tap(phone, "pro_fix");
    expect((await state(phone)).step).toBe("pro_name");
    await say(phone, "cancelar");
    expect((await state(phone)).step).toBe("idle");
    expect(await sql()`select 1 from users where whatsapp_phone = ${phone}`).toHaveLength(0);
  });

  it("si el oficio viene en el primer mensaje, se saltea esa pregunta; y acepta la ubicación compartida", async () => {
    const phone = phoneFor(3);
    await say(phone, "Hola soy electricista y quiero trabajar con Fixy");
    await say(phone, "Pedro Ruiz");
    expect((await state(phone)).step).toBe("pro_zone");
    await handleInbound(msg(phone, { type: "location", location: { lat: -32.95, lng: -60.65 } }));
    expect((await outs(phone, 1))[0]).toContain("Rosario");
    await say(phone, "acepto");
    const [p] = await sql()<{ cats: string[] }[]>`
      select (select array_agg(c.slug) from provider_categories pc join categories c on c.id = pc.category_id where pc.provider_id = p.id) as cats
      from providers p join provider_members m on m.provider_id = p.id join users u on u.id = m.user_id where u.whatsapp_phone = ${phone}`;
    expect(p.cats).toEqual(["electricidad"]);
  });

  it("un número sin cuenta que escribe «entrar» recibe cómo sumarse, no un link", async () => {
    const phone = phoneFor(4);
    await say(phone, "entrar");
    const [last] = await outs(phone, 1);
    expect(last).not.toContain("/wa/entrar/");
    expect(last).toContain("quiero trabajar con Fixy");
  });
});

describe("cuenta de WhatsApp que suma email y clave", () => {
  it("puede entrar con email y clave; no recibe correos ni enlaces de recuperación; puede cambiarlos", async () => {
    const { authenticate, requestPasswordReset, setEmailAccess, registerUser } = await import("@/server/modules/users");
    const { loadActor } = await import("@/server/auth/actor");
    const { systemTx } = await import("@/server/db/client");
    const { notify } = await import("@/server/notifications");
    const phone = phoneFor(9);
    await say(phone, "Hola, quiero trabajar con Fixy");
    await say(phone, "Clara Benítez");
    await say(phone, "pintora");
    await say(phone, "Tandil, Buenos Aires");
    await tap(phone, "pro_accept");
    const [u] = await sql()<{ id: string; email: string }[]>`select id, email from users where whatsapp_phone = ${phone}`;
    const me = async () => (await systemTx((tx) => loadActor(tx, u.id)))!;
    expect((await me()).hasEmail).toBe(false);

    const email = `clara.${Date.now()}@test.local`;
    await expect(setEmailAccess(await me(), { email, password: "corta" })).rejects.toThrow();
    // No puede quedarse con el email de otra cuenta.
    const otherEmail = `otra.${Date.now()}@test.local`;
    await registerUser({ fullName: "Otra Persona", email: otherEmail, password: "password-123", acceptTerms: true, phone: "1155550000" });
    await expect(setEmailAccess(await me(), { email: otherEmail, password: "clave-segura-1" })).rejects.toThrow(/Ya hay una cuenta/);

    await setEmailAccess(await me(), { email: email.toUpperCase(), password: "clave-segura-1" });
    expect(await authenticate(email, "clave-segura-1")).toBe(u.id);
    const actor = await me();
    expect(actor).toMatchObject({ email, hasEmail: true, emailVerified: false });
    expect((await sql()<{ contact_email: string }[]>`select p.contact_email from providers p join provider_members m on m.provider_id = p.id where m.user_id = ${u.id}`)[0].contact_email).toBe(email);

    // El email no está verificado: no hay enlace de recuperación ni correos; las novedades siguen por WhatsApp.
    await requestPasswordReset(email);
    expect(await sql()`select 1 from password_resets where user_id = ${u.id}`).toHaveLength(0);
    await systemTx((tx) => notify(tx, [u.id], { type: "message", title: "Mensaje nuevo" }));
    expect(await sql()`select 1 from outbox where recipient_user_id = ${u.id} and channel = 'whatsapp' and payload->>'audience' = 'account'`).toHaveLength(1);
    await processOutbox(500);
    expect((await sql()<{ status: string }[]>`select status from outbox where recipient_user_id = ${u.id} and channel = 'email'`).every((r) => r.status === "pending")).toBe(true);

    // Puede cambiar la clave las veces que quiera (entrando con el link de WhatsApp).
    await setEmailAccess(actor, { email, password: "otra-clave-22" });
    await expect(authenticate(email, "clave-segura-1")).rejects.toThrow();
    expect(await authenticate(email, "otra-clave-22")).toBe(u.id);
  });

  it("una cuenta con email verificado no puede usar este camino para cambiarlo", async () => {
    const { setEmailAccess } = await import("@/server/modules/users");
    const { actor } = await import("./helpers");
    await expect(setEmailAccess(await actor("ana"), { email: `x.${Date.now()}@test.local`, password: "clave-segura-1" })).rejects.toThrow(/ya tiene un email/);
  });
});
