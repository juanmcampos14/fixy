/**
 * Bot de pedidos por WhatsApp. Mismo guion que la web (docs/flujo-pedido.md):
 *   problema → (oficio sugerido) → ubicación → profesionales → resumen → enviar.
 * - Número vinculado a una cuenta: el pedido se crea directo.
 * - Sin cuenta: mandamos un link para crear la cuenta o ingresar; al usarlo se vincula el número y se envía el pedido.
 * - La dirección nunca se comparte con profesionales hasta que se confirma la visita (misma regla que la web).
 */
import { createHash, randomBytes } from "node:crypto";
import { sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { env } from "@/server/env";
import { triage } from "@/server/assistant";
import { isDomainError } from "@/server/domain/errors";
import { listBookableProviders } from "@/server/modules/booking";
import { submitRequestPayload, type RequestPayload } from "@/server/modules/request-submit";
import { componentsToAddress, type AddressValue } from "@/lib/address";
import { formatMoney } from "@/lib/format";
import { geocodeAddress, reverseGeocode } from "@/server/geo";
import { markRead, sendWhatsApp, type OutMessage } from "./client";

export type Inbound = {
  id: string;
  from: string;
  profileName?: string;
  type: "text" | "interactive" | "location" | "image" | "other";
  text?: string;
  replyId?: string;
  location?: { lat: number; lng: number; name?: string; address?: string };
};

type Step = "idle" | "problem" | "location" | "address" | "zone_region" | "zone" | "pros" | "confirm" | "details" | "awaiting_account" | "done";
type State = {
  step: Step;
  description?: string;
  title?: string;
  categorySlug?: string;
  urgency?: RequestPayload["urgency"];
  propertyId?: string | null;
  address?: Partial<AddressValue>;
  pros?: { slug: string; name: string; visitFeeMinor: number }[];
  chosen?: string | null; // slug | "quotes"
  extra?: string;
};

type Zone = { id: string; code: string; name: string; region: string; match_names: string[] };
type Ctx = { phone: string; name: string; userId: string | null; out: OutMessage[] };

const PRIVACY = "Tu dirección la ve y la protege solo Fixy: el profesional la recibe recién cuando se confirma la visita.";
const FEW_PROS = "Todavía tenemos pocos profesionales en esa zona para este trabajo. Podés hacer el pedido igual: lo revisa nuestro equipo y te avisamos apenas consigamos a alguien.";
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const isGreeting = (t: string) => /^(hola|holis|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|que tal|hi|hello)[\s!.,]*$/.test(norm(t));

/** Mensajes del webhook de Meta → entradas normalizadas (ignora estados de entrega). */
export function parseWebhook(body: unknown): Inbound[] {
  const out: Inbound[] = [];
  const entries = (body as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] })?.entry ?? [];
  for (const e of entries) {
    for (const c of e.changes ?? []) {
      const v = c.value as { contacts?: { wa_id: string; profile?: { name?: string } }[]; messages?: Record<string, unknown>[] } | undefined;
      for (const m of v?.messages ?? []) {
        const from = String(m.from ?? "");
        if (!/^\d{8,16}$/.test(from) || typeof m.id !== "string") continue;
        const profileName = v?.contacts?.find((x) => x.wa_id === from)?.profile?.name;
        const base = { id: m.id, from, profileName };
        if (m.type === "text") out.push({ ...base, type: "text", text: String((m.text as { body?: string })?.body ?? "") });
        else if (m.type === "interactive") {
          const i = m.interactive as { button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } };
          const r = i?.button_reply ?? i?.list_reply;
          out.push({ ...base, type: "interactive", replyId: r?.id, text: r?.title });
        } else if (m.type === "button") out.push({ ...base, type: "interactive", replyId: String((m.button as { payload?: string })?.payload ?? ""), text: String((m.button as { text?: string })?.text ?? "") });
        else if (m.type === "location") {
          const l = m.location as { latitude: number; longitude: number; name?: string; address?: string };
          out.push({ ...base, type: "location", location: { lat: Number(l.latitude), lng: Number(l.longitude), name: l.name, address: l.address } });
        } else if (m.type === "image") out.push({ ...base, type: "image", text: String((m.image as { caption?: string })?.caption ?? "") });
        else out.push({ ...base, type: "other" });
      }
    }
  }
  return out;
}

/** Procesa un mensaje entrante (idempotente: Meta reintenta). Serializa por número con un lock de transacción. */
export async function handleInbound(msg: Inbound): Promise<void> {
  const [logged] = await sql()<{ id: number }[]>`
    insert into whatsapp_messages (wa_message_id, phone, direction, kind, body) values (${msg.id}, ${msg.from}, 'in', ${msg.type}, ${sql().json(msg as never)})
    on conflict (wa_message_id) do nothing returning id`;
  if (!logged) return; // duplicado
  void markRead(msg.id);

  const out: OutMessage[] = [];
  await systemTx(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"wa:" + msg.from}))`;
    await tx`insert into whatsapp_conversations (phone, profile_name) values (${msg.from}, ${msg.profileName ?? null}) on conflict (phone) do nothing`;
    const [conv] = await tx<{ state: State; profile_name: string | null }[]>`select state, profile_name from whatsapp_conversations where phone = ${msg.from} for update`;
    const [user] = await tx<{ id: string; full_name: string }[]>`select id, full_name from users where whatsapp_phone = ${msg.from} and disabled_at is null`;
    const ctx: Ctx = { phone: msg.from, name: (user?.full_name ?? msg.profileName ?? conv.profile_name ?? "").split(" ")[0], userId: user?.id ?? null, out };
    const next = await step(conv.state ?? { step: "idle" }, msg, ctx);
    await tx`update whatsapp_conversations set state = ${tx.json(next as never)}, profile_name = coalesce(${msg.profileName ?? null}, profile_name),
      last_inbound_at = now(), updated_at = now() where phone = ${msg.from}`;
  });
  for (const m of out) await sendWhatsApp(msg.from, m);
}

// ───────────────────────── Máquina de estados ─────────────────────────

async function step(s: State, msg: Inbound, ctx: Ctx): Promise<State> {
  const text = (msg.text ?? "").trim();
  const t = norm(text);
  const reply = msg.replyId ?? "";

  // Comandos globales
  if (reply === "cancel" || /^(cancelar|salir|empezar de nuevo|reiniciar|nuevo pedido|nuevo)$/.test(t)) {
    ctx.out.push({ kind: "text", text: "Listo, empezamos de nuevo. Contame qué problema tenés y te muestro profesionales que pueden ir." });
    return { step: "problem" };
  }
  if (/^(ayuda|menu|menú)$/.test(t)) {
    ctx.out.push({ kind: "text", text: "Te ayudo a conseguir un profesional para tu casa u oficina. Contame el problema en una oración. Escribí *cambiar* si el oficio no es el correcto, o *cancelar* para empezar de nuevo." });
    return s;
  }
  if ((reply === "change_cat" || t === "cambiar") && s.description) return askCategory(s, ctx);
  if (reply.startsWith("cat:") && s.description) {
    const next = { ...s, categorySlug: reply.slice(4) };
    return next.address?.zoneId || next.propertyId ? goPros(next, ctx) : askLocation(next, ctx);
  }

  switch (s.step) {
    case "idle":
    case "done":
    case "awaiting_account":
      if (s.step === "awaiting_account" && !text) return s;
      if (msg.type === "text" && text.length >= 12 && !isGreeting(text)) return onProblem({ step: "problem" }, text, ctx);
      ctx.out.push({ kind: "text", text: `Hola${ctx.name ? ` ${ctx.name}` : ""}, soy Fixy. Contame qué problema tenés (por ejemplo: «gotea la canilla de la cocina») y te muestro profesionales que pueden ir.` });
      return { step: "problem" };

    case "problem":
      if (msg.type === "image" && text.length < 10) {
        ctx.out.push({ kind: "text", text: "Gracias por la foto. Contame en una oración qué pasa y te muestro profesionales. (Las fotos las podés sumar al pedido desde la web.)" });
        return s;
      }
      if (text.length < 10) {
        ctx.out.push({ kind: "text", text: "Contame un poco más, con una oración alcanza. Por ejemplo: «se corta la luz cuando prendo el horno»." });
        return s;
      }
      return onProblem(s, text, ctx);

    case "location":
      if (reply.startsWith("prop:")) return goPros({ ...s, propertyId: reply.slice(5), address: undefined }, ctx);
      if (reply === "loc:new") return askLocationRequest(s, ctx);
      if (msg.type === "location" && msg.location) return onLocation(s, msg.location, ctx);
      if (text.length >= 5) return onAddressText(s, text, ctx);
      ctx.out.push({ kind: "location_request", text: `Para mostrarte profesionales cerca necesito saber dónde es. Tocá *Enviar ubicación* o escribí la dirección (calle, altura y localidad). ${PRIVACY}` });
      return s;

    case "address":
      if (msg.type === "location" && msg.location) return onLocation(s, msg.location, ctx);
      if (text.length < 5) {
        ctx.out.push({ kind: "text", text: "Escribime la calle y la altura (por ejemplo: Av. Cabildo 2000)." });
        return s;
      }
      return onAddressText(s, text, ctx, true);

    case "zone_region":
    case "zone": {
      const zones = await allZones();
      if (reply.startsWith("zone:")) {
        const z = zones.find((x) => x.id === reply.slice(5));
        if (z) return goPros({ ...s, address: { ...s.address, zoneId: z.id } }, ctx);
      }
      if (reply.startsWith("region:")) return askZoneList(s, reply.slice(7), zones, ctx);
      return askZone(s, ctx);
    }

    case "pros":
      if (reply.startsWith("pro:") || reply === "quotes") return confirm({ ...s, chosen: reply === "quotes" ? "quotes" : reply.slice(4) }, ctx);
      return goPros(s, ctx);

    case "confirm":
      if (reply === "send" || /^(enviar|si|sí|dale|ok|listo)$/.test(t)) return send(s, ctx);
      if (reply === "details") {
        ctx.out.push({ kind: "text", text: "Contame en un mensaje lo que quieras sumar: horarios que te quedan bien, piso o depto, cómo entrar, si es barrio cerrado. (Las fotos las podés sumar después desde la web.)" });
        return { ...s, step: "details" };
      }
      if (reply === "change_pro") return goPros(s, ctx);
      return confirm(s, ctx);

    case "details":
      if (text) return confirm({ ...s, extra: [s.extra, text].filter(Boolean).join("\n").slice(0, 1000) }, ctx);
      return s;
  }
}

async function onProblem(s: State, text: string, ctx: Ctx): Promise<State> {
  const r = await triage(text.slice(0, 2000), null).catch(() => null);
  const next: State = {
    ...s, description: text.slice(0, 4000), title: (r?.suggestedTitle || text.split(/[.\n]/)[0]).slice(0, 120),
    categorySlug: r?.categorySlug ?? "otro", urgency: (r?.suggestedUrgency as State["urgency"]) ?? "normal", chosen: null,
  };
  if (r?.safety) ctx.out.push({ kind: "text", text: `*${r.safety.title}*\n${r.safety.guidance.map((g) => `• ${g}`).join("\n")}` });
  const [cat] = await sql()<{ name: string; requires_review: boolean }[]>`select name, requires_review from categories where slug = ${next.categorySlug!}`;
  ctx.out.push({
    kind: "buttons",
    text: cat && !cat.requires_review ? `Entendido. Parece trabajo de *${cat.name}*.` : "Entendido. No me queda claro qué oficio necesitás: una persona del equipo lo revisa y te propone profesionales.",
    buttons: [{ id: "change_cat", title: cat && !cat.requires_review ? "No es eso" : "Elegir oficio" }],
  });
  return askLocation(next, ctx);
}

async function askCategory(s: State, ctx: Ctx): Promise<State> {
  const cats = await sql()<{ slug: string; name: string }[]>`select slug, name from categories where active order by sort, name`;
  const main = cats.filter((c) => c.slug !== "otro").slice(0, 9);
  ctx.out.push({
    kind: "list", text: "¿Qué tipo de profesional necesitás?", button: "Ver oficios",
    sections: [{ title: "Oficios", rows: [...main.map((c) => ({ id: `cat:${c.slug}`, title: c.name })), { id: "cat:otro", title: "Otro / no sé", description: "Lo revisa una persona del equipo" }] }],
  });
  return s;
}

async function askLocation(s: State, ctx: Ctx): Promise<State> {
  if (ctx.userId) {
    const props = await sql()<{ id: string; label: string; zone_name: string }[]>`
      select p.id, p.label, z.name as zone_name from properties p join zones z on z.id = p.zone_id
      where p.archived_at is null and (p.owner_user_id = ${ctx.userId} or p.organization_id in (select organization_id from organization_members where user_id = ${ctx.userId}))
      order by p.created_at limit 9`;
    if (props.length) {
      ctx.out.push({
        kind: "list", text: `¿Dónde es? ${PRIVACY}`, button: "Elegir lugar",
        sections: [{ title: "Tus lugares", rows: [...props.map((p) => ({ id: `prop:${p.id}`, title: p.label, description: p.zone_name })), { id: "loc:new", title: "Otra dirección" }] }],
      });
      return { ...s, step: "location" };
    }
  }
  return askLocationRequest(s, ctx);
}

function askLocationRequest(s: State, ctx: Ctx): State {
  ctx.out.push({ kind: "location_request", text: `¿Dónde es? Tocá *Enviar ubicación* o escribí la dirección (calle, altura y localidad). ${PRIVACY}` });
  return { ...s, step: "location", propertyId: null };
}

async function onLocation(s: State, loc: NonNullable<Inbound["location"]>, ctx: Ctx): Promise<State> {
  const zones = await allZones();
  const geo = await reverseGeocode(loc.lat, loc.lng);
  const base: Partial<AddressValue> = { lat: loc.lat.toFixed(6), lng: loc.lng.toFixed(6) };
  if (geo) {
    const r = componentsToAddress(geo.components, geo.formatted, loc.lat, loc.lng, geo.placeId, zones);
    const next: State = { ...s, propertyId: null, address: { ...r.value } };
    if (!r.hasStreetNumber) {
      ctx.out.push({ kind: "text", text: `Recibí tu ubicación (${r.zone?.name ?? "zona sin identificar"}). ¿Me pasás la calle y la altura? Ej.: ${r.value.addressLine || "Av. Cabildo"} 2000.` });
      return { ...next, step: "address" };
    }
    return goPros(next, ctx);
  }
  // Sin geocodificación en el servidor: usamos lo que mande WhatsApp y pedimos lo que falte.
  const line = loc.address?.split(",")[0] ?? "";
  const next: State = { ...s, propertyId: null, address: { ...base, addressLine: line, formattedAddress: loc.address ?? "" } };
  if (line.length < 5) {
    ctx.out.push({ kind: "text", text: "Recibí tu ubicación. ¿Me pasás la calle y la altura? (Ej.: Av. Cabildo 2000)" });
    return { ...next, step: "address" };
  }
  return askZone(next, ctx);
}

async function onAddressText(s: State, text: string, ctx: Ctx, keepZone = false): Promise<State> {
  const zones = await allZones();
  const geo = await geocodeAddress(text);
  if (geo) {
    const r = componentsToAddress(geo.components, geo.formatted, geo.lat, geo.lng, geo.placeId, zones, text.split(",")[0].slice(0, 200));
    return goPros({ ...s, propertyId: null, address: { ...r.value, ...(keepZone && s.address?.zoneId ? { zoneId: s.address.zoneId } : {}) } }, ctx);
  }
  // Sin geocodificación: probamos reconocer la zona por los nombres de barrios/partidos del texto.
  const guess = zones.find((z) => z.match_names.some((n) => norm(text).includes(n)));
  const next: State = { ...s, propertyId: null, address: { ...s.address, addressLine: text.split(",")[0].slice(0, 200), formattedAddress: text.slice(0, 300), zoneId: keepZone && s.address?.zoneId ? s.address.zoneId : guess?.id ?? "" } };
  return next.address!.zoneId ? goPros(next, ctx) : askZone(next, ctx);
}

function askZone(s: State, ctx: Ctx): State {
  ctx.out.push({
    kind: "buttons", text: "¿En qué zona es?",
    buttons: [{ id: "region:CABA", title: "CABA" }, { id: "region:GBA_NORTE", title: "GBA Norte" }, { id: "region:OTRA", title: "Otro lugar" }],
  });
  return { ...s, step: "zone_region" };
}

function askZoneList(s: State, region: string, zones: Zone[], ctx: Ctx): State {
  const list = region === "OTRA" ? zones.filter((z) => ["GBA_OESTE", "GBA_SUR", "OTRA"].includes(z.region)) : zones.filter((z) => z.region === region);
  ctx.out.push({
    kind: "list", text: "Elegí la zona:", button: "Ver zonas",
    sections: [{ title: region === "CABA" ? "CABA" : region === "GBA_NORTE" ? "GBA Norte" : "Otras zonas", rows: list.slice(0, 10).map((z) => ({ id: `zone:${z.id}`, title: z.code === "otra-zona" ? "Fuera de CABA y GBA" : z.name })) }],
  });
  return { ...s, step: "zone" };
}

async function goPros(s: State, ctx: Ctx): Promise<State> {
  const zoneId = s.propertyId
    ? (await sql()<{ zone_id: string }[]>`select zone_id from properties where id = ${s.propertyId}`)[0]?.zone_id
    : s.address?.zoneId;
  if (!zoneId) return askZone(s, ctx);
  const [cat] = await sql()<{ id: string; requires_review: boolean; name: string }[]>`select id, requires_review, name from categories where slug = ${s.categorySlug ?? "otro"}`;
  if (!cat || cat.requires_review) return confirm({ ...s, chosen: "quotes", pros: [] }, ctx);
  const list = await listBookableProviders(sql(), { categoryId: cat.id, zoneId, preferredWindows: [], limit: 9 });
  const pros = list.map((p) => ({ slug: p.slug, name: p.displayName, visitFeeMinor: p.visitFeeMinor }));
  if (!list.length) {
    ctx.out.push({ kind: "buttons", text: FEW_PROS, buttons: [{ id: "quotes", title: "Hacer el pedido" }, { id: "cancel", title: "Cancelar" }] });
    return { ...s, step: "pros", pros };
  }
  ctx.out.push({
    kind: "list",
    text: `Estos profesionales de ${cat.name.toLowerCase()} pueden ir. Elegí uno: coordinan la visita por Fixy y te presupuesta el arreglo en el lugar.`,
    button: "Ver profesionales",
    sections: [
      {
        title: "Profesionales",
        rows: list.map((p) => ({
          id: `pro:${p.slug}`,
          title: p.displayName,
          description: [p.visitFeeMinor > 0 ? `Visita ${formatMoney(p.visitFeeMinor)}` : "Visita sin cargo", p.reviews ? `${p.rating}★ (${p.reviews})` : "Nuevo", p.identityVerified ? "Verificado" : ""].filter(Boolean).join(" · "),
        })),
      },
      { title: "Otra opción", rows: [{ id: "quotes", title: "Presupuestos varios", description: "Invitamos a varios y comparás" }] },
    ],
  });
  return { ...s, step: "pros", pros };
}

async function confirm(s: State, ctx: Ctx): Promise<State> {
  const pro = s.chosen && s.chosen !== "quotes" ? s.pros?.find((p) => p.slug === s.chosen) : null;
  const where = s.propertyId
    ? (await sql()<{ label: string; zone_name: string }[]>`select p.label, z.name as zone_name from properties p join zones z on z.id = p.zone_id where p.id = ${s.propertyId}`)[0]
    : null;
  const zoneName = !where && s.address?.zoneId ? (await sql()<{ name: string }[]>`select name from zones where id = ${s.address.zoneId}`)[0]?.name : null;
  const lines = [
    "*Tu pedido*",
    `Problema: ${s.title ?? s.description}`,
    `Dónde: ${where ? `${where.label} (${where.zone_name})` : `${s.address?.addressLine ?? ""}${zoneName ? ` (${zoneName})` : ""}`}`,
    pro ? `Profesional: ${pro.name} · ${pro.visitFeeMinor > 0 ? `visita ${formatMoney(pro.visitFeeMinor)}` : "visita sin cargo"}` : s.pros?.length ? "Recibís presupuestos de varios profesionales." : "Nuestro equipo busca un profesional para vos.",
    s.extra ? `Detalles: ${s.extra}` : "",
    "",
    pro ? "No pagás nada hasta confirmar la visita." : "Pedir es gratis.",
  ].filter((l, i, a) => l !== "" || i === a.length - 2);
  ctx.out.push({
    kind: "buttons", text: lines.join("\n"),
    buttons: [{ id: "send", title: "Enviar pedido" }, { id: "details", title: "Sumar detalles" }, { id: pro || s.pros?.length ? "change_pro" : "cancel", title: pro || s.pros?.length ? "Cambiar opción" : "Cancelar" }],
  });
  return { ...s, step: "confirm" };
}

function payloadOf(s: State): RequestPayload {
  return {
    description: s.description ?? "", title: s.title ?? (s.description ?? "").slice(0, 80), categorySlug: s.categorySlug ?? "otro", serviceId: null,
    answers: {}, urgency: s.urgency ?? "normal", windows: [],
    propertyId: s.propertyId ?? null,
    newProperty: s.propertyId ? null : {
      kind: "home", label: "Casa", addressLine: s.address?.addressLine ?? "", addressExtra: "", zoneId: s.address?.zoneId ?? "",
      lat: s.address?.lat ?? "", lng: s.address?.lng ?? "", placeId: s.address?.placeId ?? "", formattedAddress: s.address?.formattedAddress ?? "",
    },
    accessInfo: s.extra ?? "", targetProviderSlug: s.chosen && s.chosen !== "quotes" ? s.chosen : null, previousJobId: null,
  };
}

async function send(s: State, ctx: Ctx): Promise<State> {
  const base = env().APP_URL.replace(/\/$/, "");
  if (ctx.userId) {
    try {
      const actor = await systemTx((tx) => loadActor(tx, ctx.userId!));
      const id = await submitRequestPayload(actor!, payloadOf(s));
      const [r] = await sql()<{ code: string }[]>`select code from service_requests where id = ${id}`;
      const pro = s.chosen && s.chosen !== "quotes" ? s.pros?.find((p) => p.slug === s.chosen) : null;
      ctx.out.push({
        kind: "text", previewUrl: false,
        text: `Listo, pedido *${r.code}* enviado. ${pro ? `${pro.name} tiene unas horas para aceptar y proponerte día y horario; te aviso por acá.` : "Te aviso por acá cuando haya novedades."}\n\nSeguilo en: ${base}/app/solicitudes/${id}`,
      });
      return { step: "done" };
    } catch (e) {
      ctx.out.push({ kind: "text", text: `No pude enviar el pedido: ${isDomainError(e) ? e.message : "hubo un error"}. Probá de nuevo o escribí *cancelar*.` });
      return s;
    }
  }
  const token = randomBytes(24).toString("base64url");
  await sql()`insert into whatsapp_links (token_hash, phone, data) values (${hash(token)}, ${ctx.phone}, ${sql().json(payloadOf(s) as never)})`;
  ctx.out.push({
    kind: "text", previewUrl: true,
    text: `Último paso: creá tu cuenta o ingresá desde este link y tu pedido se envía (lo guardamos 7 días). Así también quedan vinculados tu WhatsApp y tu cuenta.\n\n${base}/wa/${token}`,
  });
  return { ...s, step: "awaiting_account" };
}

async function allZones(): Promise<Zone[]> {
  return sql()<Zone[]>`select id, code, name, region, match_names from zones where active order by sort, name`;
}

// ───────────────────────── Vinculación desde el link ─────────────────────────

/** Valida el link (7 días, un solo uso) y vincula el número a la cuenta. Devuelve el pedido guardado. */
export async function consumeWhatsAppLink(token: string, userId: string): Promise<{ data: RequestPayload; phone: string } | { error: string }> {
  return systemTx(async (tx) => {
    const [l] = await tx<{ id: string; phone: string; data: RequestPayload; used_by: string | null }[]>`
      select id, phone, data, used_by from whatsapp_links where token_hash = ${hash(token)} and created_at > now() - interval '7 days' for update`;
    if (!l) return { error: "El link venció o no es válido. Escribinos de nuevo por WhatsApp." };
    if (l.used_by && l.used_by !== userId) return { error: "Este link ya se usó con otra cuenta." };
    const [owner] = await tx<{ id: string }[]>`select id from users where whatsapp_phone = ${l.phone} and id <> ${userId}`;
    if (!owner) {
      await tx`update users set whatsapp_phone = ${l.phone}, whatsapp_linked_at = now() where id = ${userId}`;
    }
    await tx`update whatsapp_links set used_at = coalesce(used_at, now()), used_by = ${userId} where id = ${l.id}`;
    await tx`update whatsapp_conversations set state = '{"step":"done"}'::jsonb, updated_at = now() where phone = ${l.phone}`;
    return { data: l.data, phone: l.phone };
  });
}

