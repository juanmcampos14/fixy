import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { sql } from "@/server/db/client";
import { consumeWhatsAppLink, handleInbound, parseWebhook, type Inbound } from "@/server/whatsapp/bot";
import { toGraphPayload, verifySignature } from "@/server/whatsapp/client";
import { actor } from "./helpers";

let seq = 0;
const PHONE = "5491155550101";
const msg = (m: Partial<Inbound>): Inbound => ({ id: `wamid.test.${Date.now()}.${seq++}`, from: PHONE, type: "text", ...m });
const lastOut = async (phone = PHONE) => (await sql()<{ body: Record<string, unknown> }[]>`select body from whatsapp_messages where phone = ${phone} and direction = 'out' order by id desc limit 1`)[0]?.body;
const outText = (b: Record<string, unknown> | undefined) => JSON.stringify(b ?? {});
const listIds = (b: Record<string, unknown> | undefined) =>
  ((b?.interactive as { action?: { sections?: { rows: { id: string }[] }[] } })?.action?.sections ?? []).flatMap((s) => s.rows.map((r) => r.id));

describe("WhatsApp", () => {
  it("parsea el webhook de Meta y verifica la firma", () => {
    const body = { entry: [{ changes: [{ value: {
      contacts: [{ wa_id: PHONE, profile: { name: "Juan" } }],
      messages: [
        { from: PHONE, id: "wamid.a", type: "text", text: { body: "hola" } },
        { from: PHONE, id: "wamid.b", type: "interactive", interactive: { list_reply: { id: "pro:x", title: "X" } } },
        { from: PHONE, id: "wamid.c", type: "location", location: { latitude: -34.58, longitude: -58.42 } },
      ],
      statuses: [{ id: "wamid.z", status: "delivered" }],
    } }] }] };
    const parsed = parseWebhook(body);
    expect(parsed.map((p) => p.type)).toEqual(["text", "interactive", "location"]);
    expect(parsed[0].profileName).toBe("Juan");
    expect(parsed[1].replyId).toBe("pro:x");
    expect(parsed[2].location).toMatchObject({ lat: -34.58, lng: -58.42 });
    const raw = JSON.stringify(body);
    const sig = "sha256=" + createHmac("sha256", "secreto-de-prueba").update(raw).digest("hex");
    expect(verifySignature(raw, sig, "secreto-de-prueba")).toBe(true);
    expect(verifySignature(raw + " ", sig, "secreto-de-prueba")).toBe(false);
    expect(verifySignature(raw, null, "secreto-de-prueba")).toBe(false);
  });

  it("respeta los límites de Meta en botones y listas", () => {
    const p = toGraphPayload(PHONE, { kind: "list", text: "x", button: "Ver profesionales y más", sections: [{ title: "A", rows: Array.from({ length: 14 }, (_, i) => ({ id: `r${i}`, title: "Un nombre muy largo para una fila" })) }] }) as { interactive: { action: { button: string; sections: { rows: { title: string }[] }[] } } };
    expect(p.interactive.action.sections[0].rows).toHaveLength(10);
    expect(p.interactive.action.sections[0].rows[0].title.length).toBeLessThanOrEqual(24);
    expect(p.interactive.action.button.length).toBeLessThanOrEqual(20);
  });

  it("pedido completo: problema → dirección → profesional → link de cuenta → vinculación → segundo pedido directo", async () => {
    await sql()`delete from whatsapp_conversations where phone = ${PHONE}`;
    await handleInbound(msg({ text: "Hola", profileName: "Ana" }));
    expect(outText(await lastOut())).toContain("Contame qué problema tenés");

    await handleInbound(msg({ text: "Gotea la canilla de la cocina y pierde agua abajo de la mesada" }));
    const outs = await sql()<{ body: Record<string, unknown> }[]>`select body from whatsapp_messages where phone = ${PHONE} and direction = 'out' order by id desc limit 2`;
    expect(outText(outs[1].body)).toContain("Plomería");
    expect(outText(outs[0].body)).toContain("location_request_message");

    // Sin geocodificación en el servidor: reconoce la zona por el barrio escrito.
    await handleInbound(msg({ text: "Av. Santa Fe 3500, Palermo" }));
    const prosMsg = await lastOut();
    const ids = listIds(prosMsg);
    const pro = ids.find((i) => i.startsWith("pro:"));
    expect(pro).toBeTruthy();
    expect(ids).toContain("quotes");

    const dupe = msg({ type: "interactive", replyId: pro });
    await handleInbound(dupe);
    await handleInbound(dupe); // Meta reintenta: no se procesa dos veces
    const [{ n }] = await sql()<{ n: number }[]>`select count(*)::int as n from whatsapp_messages where wa_message_id = ${dupe.id}`;
    expect(n).toBe(1);
    expect(outText(await lastOut())).toContain("Tu pedido");

    await handleInbound(msg({ type: "interactive", replyId: "send" }));
    const linkText = outText(await lastOut());
    const token = linkText.match(/\/wa\/([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    // La dirección no viaja en ningún mensaje saliente ni se comparte con profesionales todavía.
    const [{ requests }] = await sql()<{ requests: number }[]>`select count(*)::int as requests from service_requests r join properties p on p.id = r.property_id where p.address_line = 'Av. Santa Fe 3500'`;
    expect(requests).toBe(0);

    const ana = await actor("ana");
    await sql()`update users set whatsapp_phone = null where whatsapp_phone = ${PHONE}`;
    const r = await consumeWhatsAppLink(token!, ana.id);
    expect("data" in r && r.data.targetProviderSlug).toBe(pro!.slice(4));
    const [u] = await sql()<{ whatsapp_phone: string }[]>`select whatsapp_phone from users where id = ${ana.id}`;
    expect(u.whatsapp_phone).toBe(PHONE);
    expect("error" in (await consumeWhatsAppLink(token!, (await actor("bruno")).id))).toBe(true); // un solo dueño

    // Ya vinculada: el segundo pedido se crea directo desde WhatsApp, eligiendo un lugar guardado.
    await handleInbound(msg({ text: "Se corta la luz cuando prendo el horno eléctrico" }));
    const places = listIds(await lastOut());
    const place = places.find((i) => i.startsWith("prop:"));
    expect(place).toBeTruthy();
    await handleInbound(msg({ type: "interactive", replyId: place }));
    await handleInbound(msg({ type: "interactive", replyId: "quotes" }));
    await handleInbound(msg({ type: "interactive", replyId: "send" }));
    const done = outText(await lastOut());
    expect(done).toMatch(/pedido \*S-\d+\* enviado/);
    const code = done.match(/S-\d+/)![0];
    const [req] = await sql()<{ created_by: string; category: string }[]>`
      select r.created_by, c.slug as category from service_requests r left join categories c on c.id = r.category_id where r.code = ${code}`;
    expect(req).toEqual({ created_by: ana.id, category: "electricidad" });
  });

  it("'cancelar' reinicia la conversación", async () => {
    await handleInbound(msg({ text: "cancelar" }));
    expect(outText(await lastOut())).toContain("empezamos de nuevo");
  });
});
