import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { sql } from "@/server/db/client";
import { consumeWhatsAppLink, handleInbound, parseWebhook, type Inbound } from "@/server/whatsapp/bot";
import { toGraphPayload, verifySignature } from "@/server/whatsapp/client";
import { actor, catId, invitationFor, providerId, simpleQuote, zoneId, fakeJpeg } from "./helpers";
import * as props from "@/server/modules/properties";
import * as requests from "@/server/modules/requests";
import { storeFile } from "@/server/storage";
import { processWhatsAppOutbox } from "@/server/whatsapp/outbox";

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

  it("fotos por WhatsApp se adjuntan al pedido y el aviso de presupuesto llega por WhatsApp (texto en ventana, plantilla fuera)", async () => {
    const PHONE2 = "5491155550202";
    const carla = await actor("carla");
    await sql()`update users set whatsapp_phone = null where whatsapp_phone = ${PHONE2}`;
    await sql()`update users set whatsapp_phone = ${PHONE2}, whatsapp_linked_at = now() where id = ${carla.id}`;
    await sql()`delete from whatsapp_conversations where phone = ${PHONE2}`;
    const m2 = (m: Partial<Inbound>) => msg({ from: PHONE2, ...m });

    // Foto con texto: arranca el pedido y queda guardada (privada, sin dueño) hasta enviarlo.
    const jpeg = fakeJpeg();
    const fileId = await storeFile(sql(), { data: jpeg, originalName: "foto.jpg", uploadedBy: carla.id, purpose: "request_photo", ownerType: null, ownerId: null, allowPdf: false });
    await sql()`insert into whatsapp_media (phone, file_id) values (${PHONE2}, ${fileId})`;
    await handleInbound(m2({ type: "image", fileId, text: "Pierde agua la canilla del baño y gotea todo el día" }));
    expect(listIds(await lastOut(PHONE2))).toContain("loc:new"); // tiene lugares guardados: elige "otra dirección"
    await handleInbound(m2({ type: "interactive", replyId: "loc:new" }));
    // Un id de archivo ajeno no se adjunta aunque llegue en el estado.
    const otherFile = await storeFile(sql(), { data: jpeg, originalName: "ajena.jpg", uploadedBy: null, purpose: "request_photo", ownerType: null, ownerId: null, allowPdf: false });
    await sql()`update whatsapp_conversations set state = jsonb_set(state, '{photos}', ${sql().json([fileId, otherFile] as never)}) where phone = ${PHONE2}`;

    await handleInbound(m2({ text: "Av. Santa Fe 3500, Palermo" }));
    await handleInbound(m2({ type: "interactive", replyId: "quotes" }));
    expect(outText(await lastOut(PHONE2))).toContain("Fotos: 2");
    await handleInbound(m2({ type: "interactive", replyId: "send" }));
    const code = outText(await lastOut(PHONE2)).match(/S-\d+/)![0];
    const [req] = await sql()<{ id: string }[]>`select id from service_requests where code = ${code}`;
    const att = await sql()<{ file_id: string }[]>`select file_id from request_attachments where request_id = ${req.id}`;
    expect(att.map((a) => a.file_id)).toEqual([fileId]);
    const [f] = await sql()<{ owner_type: string; owner_id: string }[]>`select owner_type, owner_id from files where id = ${fileId}`;
    expect(f).toEqual({ owner_type: "request", owner_id: req.id });

    // Un profesional presupuesta → aviso por WhatsApp. Escribió hace instantes: va como texto común.
    const lucia = await actor("lucia");
    const pid = await providerId("Plomería Sosa");
    await simpleQuote(lucia, await invitationFor(req.id, pid));
    const [ob] = await sql()<{ id: string }[]>`select id from outbox where channel = 'whatsapp' and recipient_user_id = ${carla.id} order by created_at desc limit 1`;
    expect(ob).toBeTruthy();
    await processWhatsAppOutbox();
    const inWindow = await lastOut(PHONE2);
    expect(inWindow?.type).toBe("text");
    expect(outText(inWindow)).toContain(`/app/solicitudes/${req.id}`);

    // Fuera de la ventana de 24 h: plantilla aprobada, con el nombre y el botón al pedido.
    await sql()`update whatsapp_conversations set last_inbound_at = now() - interval '2 days' where phone = ${PHONE2}`;
    await sql()`update outbox set status = 'pending', next_attempt_at = now() where id = ${ob.id}`;
    await processWhatsAppOutbox();
    const tpl = (await lastOut(PHONE2)) as { type: string; template: { name: string; components: { type: string; parameters: { text: string }[] }[] } };
    expect(tpl.type).toBe("template");
    expect(tpl.template.name).toBe("fixy_presupuesto_recibido");
    expect(tpl.template.components[0].parameters[0].text).toBe(carla.fullName.split(" ")[0]);
    expect(tpl.template.components[1].parameters[0].text).toBe(req.id);
  });

  it("ubicación compartida: deduce la zona (sin preguntar CABA/GBA), no habla de pocos profesionales y pide la calle solo al final", async () => {
    const PHONE3 = "5491155550303";
    await sql()`delete from whatsapp_conversations where phone = ${PHONE3}`;
    const m3 = (m: Partial<Inbound>) => msg({ from: PHONE3, ...m });
    await handleInbound(m3({ text: "Necesito un electricista, se corta la luz en la cocina" }));
    await handleInbound(m3({ type: "location", location: { lat: -34.343273, lng: -58.722935, name: "Malba Puertos", address: "B1623 Escobar" } }));
    const outs = await sql()<{ body: Record<string, unknown> }[]>`select body from whatsapp_messages where phone = ${PHONE3} and direction = 'out' order by id`;
    const all = outs.map((o) => outText(o.body)).join("\n");
    expect(all).not.toContain("¿En qué zona es?");
    expect(all).not.toMatch(/pocos profesionales/i);
    // Sin profesionales en Escobar en los datos de prueba: va directo al último dato (calle), sin aviso de escasez.
    const last = outText(await lastOut(PHONE3));
    expect(last).toMatch(/calle y altura|Ver profesionales/);
    if (/calle y altura/.test(last)) {
      await handleInbound(m3({ text: "Mendoza 1234" }));
      const summary = outText(await lastOut(PHONE3));
      expect(summary).toContain("Tu pedido");
      expect(summary).toContain("Mendoza 1234 (Escobar)");
    }
  });

  it("con pedidos abiertos entiende si quiere sumar detalles o saber cómo va (no lo trata como pedido nuevo)", async () => {
    const PHONE4 = "5491155550404";
    const diego = await actor("diego");
    await sql()`update users set whatsapp_phone = null where whatsapp_phone = ${PHONE4}`;
    await sql()`update users set whatsapp_phone = ${PHONE4} where id = ${diego.id}`;
    await sql()`delete from whatsapp_conversations where phone = ${PHONE4}`;
    const propId = await props.createProperty(diego, { kind: "home", label: `Depto ${Date.now()}`, addressLine: "Av. Santa Fe 3500", zoneId: await zoneId("caba-palermo") });
    const reqId = await requests.createRequest(diego, {
      propertyId: propId, categoryId: await catId("electricidad"), title: "Necesito un electricista", description: "Se corta la luz cuando prendo el horno.",
      answers: {}, urgency: "normal", preferredWindows: [],
    });
    const [req] = await sql()<{ id: string; code: string }[]>`select id, code from service_requests where id = ${reqId}`;
    const m4 = (m: Partial<Inbound>) => msg({ from: PHONE4, ...m });

    await handleInbound(m4({ text: "puedo agregar por aca mas detalles a mi pedido?" }));
    const first = outText(await lastOut(PHONE4));
    expect(first).not.toMatch(/No me queda claro qué oficio/);
    if (listIds(await lastOut(PHONE4)).length) await handleInbound(m4({ type: "interactive", replyId: `upd:${req.id}` }));
    await handleInbound(m4({ text: "El tablero está en el pasillo, al lado de la puerta" }));
    const [r] = await sql()<{ description: string }[]>`select description from service_requests where id = ${req.id}`;
    expect(r.description).toContain("Agregado por el cliente");
    expect(r.description).toContain("al lado de la puerta");

    await handleInbound(m4({ type: "interactive", replyId: "add_done" }));
    await handleInbound(m4({ text: "encontraron candidatos?" }));
    const outs = await sql()<{ body: Record<string, unknown> }[]>`select body from whatsapp_messages where phone = ${PHONE4} and direction = 'out' order by id desc limit 2`;
    expect(outs.map((o) => outText(o.body)).join(" ")).toContain(req.code);
  });
});
