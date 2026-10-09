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
import { nearestZoneCode } from "@/lib/zone-centroids";
import { downloadMedia, markRead, sendWhatsApp, type OutMessage } from "./client";
import { classifyIntent, type OpenRequest } from "./intent";
import { looksLikeAddress, looksLikeQuestion, parseBudget, understand, type Expecting, type Understood } from "./understand";
import { addRequestDetails, notifyRequestUpdate } from "@/server/modules/requests";
import { jobStatusLabel, requestStatusLabel } from "@/server/domain/labels";
import { storeFile } from "@/server/storage";
import { SUPPORT_EMAIL } from "@/lib/contact";

export type Inbound = {
  id: string;
  from: string;
  profileName?: string;
  type: "text" | "interactive" | "location" | "image" | "other";
  text?: string;
  replyId?: string;
  location?: { lat: number; lng: number; name?: string; address?: string };
  mediaId?: string;
  /** Archivo guardado de la foto recibida (lo completa handleInbound). */
  fileId?: string;
};

type Step = "idle" | "problem" | "location" | "address" | "street" | "pick_request" | "add_to" | "zone_region" | "zone" | "pros" | "budget" | "confirm" | "details" | "awaiting_account" | "done";
type State = {
  step: Step;
  description?: string;
  title?: string;
  categorySlug?: string;
  urgency?: RequestPayload["urgency"];
  propertyId?: string | null;
  address?: Partial<AddressValue>;
  pros?: { slug: string; name: string; visitFeeMinor: number; verified?: boolean }[];
  chosen?: string | null; // slug | "quotes" | "budget"
  /** Pedido con presupuesto: lo que la persona quiere pagar (centavos). */
  budgetMinor?: number;
  extra?: string;
  /** Fotos recibidas por WhatsApp para este pedido (ids de archivos privados). */
  photos?: string[];
  /** Pedido existente al que se le suman fotos o detalles. */
  targetRequestId?: string;
  /** Fotos recibidas antes de saber a qué pedido van. */
  pendingPhotos?: string[];
};

type Zone = { id: string; code: string; name: string; region: string; match_names: string[] };
type Ctx = { phone: string; name: string; userId: string | null; out: OutMessage[] };

const PRIVACY = "Tu dirección la ve y la protege solo Fixy: el profesional la recibe recién cuando se confirma la visita.";
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
        } else if (m.type === "image") {
          const img = m.image as { id?: string; caption?: string };
          out.push({ ...base, type: "image", text: String(img?.caption ?? ""), mediaId: img?.id ? String(img.id) : undefined });
        }
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
  if (msg.type === "image" && msg.mediaId) msg.fileId = (await saveIncomingPhoto(msg.from, msg.mediaId)) ?? undefined;

  const out: OutMessage[] = [];
  await systemTx(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"wa:" + msg.from}))`;
    await tx`insert into whatsapp_conversations (phone, profile_name) values (${msg.from}, ${msg.profileName ?? null}) on conflict (phone) do nothing`;
    const [conv] = await tx<{ state: State; profile_name: string | null; stale: boolean }[]>`
      select state, profile_name, updated_at < now() - interval '12 hours' as stale from whatsapp_conversations where phone = ${msg.from} for update`;
    const [user] = await tx<{ id: string; full_name: string }[]>`select id, full_name from users where whatsapp_phone = ${msg.from} and disabled_at is null`;
    const ctx: Ctx = { phone: msg.from, name: (user?.full_name ?? msg.profileName ?? conv.profile_name ?? "").split(" ")[0], userId: user?.id ?? null, out };
    // Una conversación a medias de hace horas no sigue: el mensaje nuevo se interpreta desde cero.
    const current: State = !conv.state || (conv.stale && !["idle", "done"].includes(conv.state.step)) ? { step: "idle" } : conv.state;
    const next = await step(current, msg, ctx);
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
    ctx.out.push({ kind: "text", text: `Te ayudo a conseguir un profesional para tu casa u oficina. Contame el problema en una oración. Escribí *cambiar* si el oficio no es el correcto, o *cancelar* para empezar de nuevo.\n\nSi preferís hablar con una persona del equipo, escribinos a ${SUPPORT_EMAIL}.` });
    return s;
  }
  if (wantsHuman(t)) {
    ctx.out.push({ kind: "text", text: `Para hablar con una persona del equipo de Fixy, escribinos a ${SUPPORT_EMAIL} y te respondemos por mail. Si querés, mientras tanto sigo ayudándote por acá con tu pedido.` });
    return s;
  }
  if (reply === "link_account") return sendLinkOnly(s, ctx);
  if (reply === "new_req" && !ctx.userId) {
    ctx.out.push({ kind: "text", text: "Dale. Contame qué problema tenés y te muestro profesionales que pueden ir." });
    return { step: "problem" };
  }
  // Pedidos existentes (solo con número vinculado a una cuenta)
  if (ctx.userId) {
    if (reply === "draft_send") return sendPendingDraft(ctx);
    if (reply === "my_requests") return showStatus(s, ctx);
    if (reply === "add_details") return askWhichRequest({ ...s, step: "pick_request" }, ctx);
    if (reply === "new_req") {
      ctx.out.push({ kind: "text", text: "Dale. Contame qué problema tenés y te muestro profesionales que pueden ir." });
      return { step: "problem", photos: s.pendingPhotos };
    }
    if (reply === "add_done") {
      ctx.out.push({ kind: "text", text: "Listo. Si necesitás algo más, escribime cuando quieras." });
      return { step: "done" };
    }
    if (reply.startsWith("upd:")) return startAddTo(s, reply.slice(4), ctx);
    if (msg.type === "image" && (s.step === "add_to" || s.step === "pick_request" || ["idle", "done"].includes(s.step))) return onPhotoForExisting(s, msg, ctx);
  }
  if (msg.type === "image") return onPhoto(s, msg, ctx);
  if ((reply === "change_cat" || t === "cambiar") && s.description) return askCategory(s, ctx);
  if (reply.startsWith("cat:") && s.description) {
    const next = { ...s, categorySlug: reply.slice(4) };
    return next.address?.zoneId || next.propertyId ? goPros(next, ctx) : askLocation(next, ctx);
  }

  switch (s.step) {
    case "idle":
    case "done":
    case "awaiting_account": {
      if (s.step === "awaiting_account" && !text) return s;
      if (!text) return s;
      const open = ctx.userId ? await openRequests(ctx.userId) : [];
      const draft = ctx.userId ? await pendingDraft(ctx.userId, ctx.phone) : null;
      if (isGreeting(text)) return greet(ctx, open, draft);
      const u = await understand(text, { expecting: "nothing", open, linked: !!ctx.userId, draftTitle: draft?.title ?? null });
      if (u.kind === "new_request" || u.kind === "data") return onProblem({ step: "problem" }, text, ctx);
      return handleOffScript(u, { step: "idle" }, ctx, open, draft);
    }

    case "pick_request":
      return askWhichRequest(s, ctx);

    case "add_to": {
      if (!s.targetRequestId || !text) return s;
      if (/^(listo|nada mas|nada más|eso es todo|gracias|ok)$/.test(t)) {
        ctx.out.push({ kind: "text", text: "Perfecto. Te aviso por acá cuando haya novedades." });
        return { step: "done" };
      }
      if (looksLikeQuestion(text)) {
        const open = await openRequests(ctx.userId!);
        const u = await understand(text, { expecting: "details", open, linked: true });
        if (u.kind !== "data") return handleOffScript(u, s, ctx, open, null, "Si querés sumar algo más al pedido, escribilo o mandá fotos.");
      }
      try {
        const actor = await systemTx((tx) => loadActor(tx, ctx.userId!));
        await addRequestDetails(actor!, s.targetRequestId, text);
        ctx.out.push({ kind: "buttons", text: "Listo, lo sumé al pedido y le avisamos al profesional. ¿Algo más? Podés mandar fotos o escribir.", buttons: [{ id: "add_done", title: "Eso es todo" }] });
      } catch (e) {
        ctx.out.push({ kind: "text", text: isDomainError(e) ? e.message : "No pude sumarlo. Probá de nuevo." });
      }
      return s;
    }

    case "problem":
      if (text && (looksLikeQuestion(text) || isGreeting(text))) {
        const open = ctx.userId ? await openRequests(ctx.userId) : [];
        const u = await understand(text, { expecting: "problem", open, linked: !!ctx.userId });
        if (u.kind !== "data" && u.kind !== "new_request") return handleOffScript(u, s, ctx, open, null, "Cuando quieras, contame en una oración qué problema tenés.");
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
      if (text && !looksLikeAddress(text)) return offScriptAt(s, text, "address", ctx, `Seguimos con tu pedido: ¿dónde es? Tocá *Enviar ubicación* o escribí calle, altura y localidad. ${PRIVACY}`);
      if (text.length >= 3) return onAddressText(s, text, ctx);
      ctx.out.push({ kind: "location_request", text: `Para mostrarte profesionales cerca necesito saber dónde es. Tocá *Enviar ubicación* o escribí la dirección (calle, altura y localidad). ${PRIVACY}` });
      return s;

    case "address":
      if (msg.type === "location" && msg.location) return onLocation(s, msg.location, ctx);
      if (text && !looksLikeAddress(text)) return offScriptAt(s, text, "address", ctx, "Seguimos: escribime la calle y la altura (por ejemplo: Av. Cabildo 2000).");
      if (text.length < 5) {
        ctx.out.push({ kind: "text", text: "Escribime la calle y la altura (por ejemplo: Av. Cabildo 2000)." });
        return s;
      }
      return onAddressText(s, text, ctx, true);

    case "street":
      if (text && !looksLikeAddress(text)) return offScriptAt(s, text, "address", ctx, "Seguimos: ¿calle y altura? (por ejemplo: Av. Cabildo 2000).");
      if (text.length < 5) {
        ctx.out.push({ kind: "text", text: "Escribime la calle y la altura (por ejemplo: Av. Cabildo 2000)." });
        return s;
      }
      return confirm({ ...s, address: { ...s.address, addressLine: text.split("\n")[0].slice(0, 200) } }, ctx);

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
      if (reply === "budget") return askBudget(s, ctx);
      if (text && looksLikeQuestion(text)) return offScriptAt(s, text, "nothing", ctx, "Elegí un profesional de la lista, pedí presupuestos varios o decí cuánto querés pagar.");
      return goPros(s, ctx);

    case "budget": {
      const amount = parseBudget(text);
      if (amount == null) {
        if (text && looksLikeQuestion(text)) return offScriptAt(s, text, "budget", ctx, "¿Cuánto querés pagar por el trabajo? Por ejemplo: 60.000.");
        ctx.out.push({ kind: "text", text: "No entendí el monto. Escribilo en pesos, por ejemplo: *60.000* o *60 mil*." });
        return s;
      }
      if (amount < 500_000) {
        ctx.out.push({ kind: "text", text: "El presupuesto mínimo es de $ 5.000. ¿Cuánto querés pagar?" });
        return s;
      }
      return confirm({ ...s, chosen: "budget", budgetMinor: amount }, ctx);
    }

    case "confirm":
      if (reply === "send" || /^(enviar|si|sí|dale|ok|listo)$/.test(t)) return send(s, ctx);
      if (reply === "details") {
        ctx.out.push({ kind: "text", text: "Contame en un mensaje lo que quieras sumar: horarios que te quedan bien, piso o depto, cómo entrar, si es barrio cerrado. También podés mandarme fotos del problema." });
        return { ...s, step: "details" };
      }
      if (reply === "change_pro") return goPros(s, ctx);
      if (text && !reply) {
        const u = await understand(text, { expecting: "confirmation", open: ctx.userId ? await openRequests(ctx.userId) : [], linked: !!ctx.userId });
        if (u.kind === "data" && !looksLikeQuestion(text)) return confirm({ ...s, extra: [s.extra, text].filter(Boolean).join("\n").slice(0, 1000) }, ctx);
        if (u.kind === "question" || u.kind === "greeting" || u.kind === "human") {
          await answerOffScript(u, ctx);
          return confirm(s, ctx);
        }
      }
      return confirm(s, ctx);

    case "details":
      if (text && looksLikeQuestion(text)) {
        const u = await understand(text, { expecting: "details", open: ctx.userId ? await openRequests(ctx.userId) : [], linked: !!ctx.userId });
        if (u.kind !== "data") {
          await answerOffScript(u, ctx);
          return confirm(s, ctx);
        }
      }
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
  const coords = { lat: loc.lat.toFixed(6), lng: loc.lng.toFixed(6) };
  const geo = await reverseGeocode(loc.lat, loc.lng);
  if (geo) {
    const r = componentsToAddress(geo.components, geo.formatted, loc.lat, loc.lng, geo.placeId, zones);
    const zoneId = r.value.zoneId || zoneFromLocation(zones, loc);
    if (!zoneId) return askZone({ ...s, propertyId: null, address: { ...r.value } }, ctx);
    // Con la zona alcanza para mostrar profesionales; la calle y la altura se piden al final si faltan.
    return goPros({ ...s, propertyId: null, address: { ...r.value, zoneId, addressLine: r.hasStreetNumber ? r.value.addressLine : "" } }, ctx);
  }
  // Sin geocodificación en el servidor: zona por el barrio o la localidad que manda WhatsApp, o por cercanía.
  const zoneId = zoneFromLocation(zones, loc);
  const next: State = { ...s, propertyId: null, address: { ...coords, addressLine: streetFrom(loc.address), formattedAddress: loc.address ?? "", zoneId: zoneId ?? "" } };
  return zoneId ? goPros(next, ctx) : askZone(next, ctx);
}

/** Zona desde lo que trae la ubicación de WhatsApp: primero el texto (barrio, localidad), si no, la cercanía. */
function zoneFromLocation(zones: Zone[], loc: NonNullable<Inbound["location"]>): string | null {
  const text = norm(`${loc.name ?? ""} ${loc.address ?? ""}`);
  const byText = zones.find((z) => z.match_names.some((n) => text.includes(n)));
  if (byText) return byText.id;
  const code = nearestZoneCode(loc.lat, loc.lng);
  return (code ? zones.find((z) => z.code === code)?.id : zones.find((z) => z.code === "otra-zona")?.id) ?? null;
}

/** Calle y altura si el texto las tiene ("Av. Cabildo 2000, ..."); no un código postal ("B1623 Escobar"). */
function streetFrom(address?: string): string {
  const first = (address ?? "").split(",")[0].trim();
  if (/^[A-Z]\d{4}/i.test(first)) return "";
  return /[a-zA-ZáéíóúñÑ]{3,}.*\s\d{1,5}\b/.test(first) ? first.slice(0, 200) : "";
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
  const pros = list.map((p) => ({ slug: p.slug, name: p.displayName, visitFeeMinor: p.visitFeeMinor, verified: p.verified }));
  if (!list.length) return confirm({ ...s, chosen: "quotes", pros }, ctx);
  ctx.out.push({
    kind: "list",
    text: `Estos profesionales de ${cat.name.toLowerCase()} pueden ir. Elegí uno (coordinan la visita por Fixy y te presupuesta en el lugar), pedí presupuestos varios o decí cuánto querés pagar.`,
    button: "Ver profesionales",
    sections: [
      {
        title: "Profesionales",
        rows: list.map((p) => ({
          id: `pro:${p.slug}`,
          title: p.displayName,
          description: [p.visitFeeMinor > 0 ? `Visita ${formatMoney(p.visitFeeMinor)}` : "Visita sin cargo", p.reviews ? `${p.rating}★ (${p.reviews})` : "Nuevo", p.verified ? "Verificado" : "Sin verificar"].filter(Boolean).join(" · "),
        })),
      },
      { title: "Otras opciones", rows: [
        { id: "quotes", title: "Presupuestos varios", description: "Invitamos a varios y comparás" },
        { id: "budget", title: "Digo cuánto pago", description: "Se anotan por tu precio o te ofrecen menos" },
      ] },
    ],
  });
  return { ...s, step: "pros", pros };
}

async function confirm(s: State, ctx: Ctx): Promise<State> {
  if (!s.propertyId && (s.address?.addressLine ?? "").trim().length < 5) {
    ctx.out.push({ kind: "text", text: `Último dato: ¿calle y altura? (por ejemplo: Av. Cabildo 2000). ${PRIVACY}` });
    return { ...s, step: "street" };
  }
  const pro = s.chosen && s.chosen !== "quotes" && s.chosen !== "budget" ? s.pros?.find((p) => p.slug === s.chosen) : null;
  const where = s.propertyId
    ? (await sql()<{ label: string; zone_name: string }[]>`select p.label, z.name as zone_name from properties p join zones z on z.id = p.zone_id where p.id = ${s.propertyId}`)[0]
    : null;
  const zoneName = !where && s.address?.zoneId ? (await sql()<{ name: string }[]>`select name from zones where id = ${s.address.zoneId}`)[0]?.name : null;
  const lines = [
    "*Tu pedido*",
    `Problema: ${s.title ?? s.description}`,
    `Dónde: ${where ? `${where.label} (${where.zone_name})` : `${s.address?.addressLine ?? ""}${zoneName ? ` (${zoneName})` : ""}`}`,
    pro ? `Profesional: ${pro.name} · ${pro.visitFeeMinor > 0 ? `visita ${formatMoney(pro.visitFeeMinor)}` : "visita sin cargo"}`
      : s.chosen === "budget" && s.budgetMinor ? `Ofrecés hasta ${formatMoney(s.budgetMinor)}: los profesionales de tu zona se anotan por ese precio o te ofrecen menos, y vos elegís. (Al contratar se suma el cargo de servicio de Fixy.)`
      : s.pros?.length ? "Recibís presupuestos de varios profesionales." : "Te conectamos con un profesional de tu zona y te avisamos por acá.",
    s.extra ? `Detalles: ${s.extra}` : "",
    s.photos?.length ? `Fotos: ${s.photos.length}` : "",
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
    accessInfo: s.extra ?? "", targetProviderSlug: s.chosen && s.chosen !== "quotes" && s.chosen !== "budget" ? s.chosen : null, previousJobId: null,
    budgetMinor: s.chosen === "budget" && s.budgetMinor ? s.budgetMinor : null,
  };
}

async function send(s: State, ctx: Ctx): Promise<State> {
  const base = env().APP_URL.replace(/\/$/, "");
  if (ctx.userId) {
    try {
      const actor = await systemTx((tx) => loadActor(tx, ctx.userId!));
      const id = await submitRequestPayload(actor!, payloadOf(s));
      await attachWhatsAppPhotos(id, { phone: ctx.phone, fileIds: s.photos ?? [] });
      await sql()`update service_requests set channel = 'whatsapp' where id = ${id}`;
      const [r] = await sql()<{ code: string }[]>`select code from service_requests where id = ${id}`;
      const pro = s.chosen && s.chosen !== "quotes" && s.chosen !== "budget" ? s.pros?.find((p) => p.slug === s.chosen) : null;
      ctx.out.push({
        kind: "text", previewUrl: false,
        text: `Listo, pedido *${r.code}* enviado. ${pro ? (pro.verified === false ? `${pro.name} todavía no verificó su identidad: le pedimos que se verifique antes de aceptar. Te aviso por acá apenas responda.` : `${pro.name} tiene unas horas para aceptar y proponerte día y horario; te aviso por acá.`) : s.chosen === "budget" ? "Les avisamos a los profesionales de tu zona; te aviso por acá cuando lleguen ofertas." : "Te aviso por acá cuando haya novedades."}\n\nSeguilo en: ${base}/app/solicitudes/${id}`,
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
    text: `Último paso: creá tu cuenta o ingresá desde este link y tu pedido se envía (lo guardamos 7 días).${s.photos?.length ? " Las fotos que me mandaste se suman solas." : ""} Así también quedan vinculados tu WhatsApp y tu cuenta.\n\n${base}/wa/${token}`,
  });
  return { ...s, step: "awaiting_account" };
}

// ───────────────────────── Fuera del guion: preguntas, estado, sumar datos ─────────────────────────

type Draft = { linkId: string; title: string; data: RequestPayload };

/** Pedido armado por WhatsApp que quedó sin enviar en la web después de vincular la cuenta (últimos 7 días). */
async function pendingDraft(userId: string, phone: string): Promise<Draft | null> {
  const [l] = await sql()<{ id: string; data: RequestPayload }[]>`
    select l.id, l.data from whatsapp_links l
    where l.phone = ${phone} and l.used_by = ${userId} and l.used_at > now() - interval '7 days' and coalesce(l.data->>'description', '') <> ''
      and not exists (select 1 from service_requests r where r.created_by = ${userId} and r.created_at > l.created_at)
    order by l.created_at desc limit 1`;
  return l ? { linkId: l.id, title: l.data.title || l.data.description.slice(0, 60), data: l.data } : null;
}

async function sendPendingDraft(ctx: Ctx): Promise<State> {
  const draft = await pendingDraft(ctx.userId!, ctx.phone);
  if (!draft) {
    ctx.out.push({ kind: "text", text: "Ese pedido ya se envió o venció. Contame qué problema tenés y armamos uno nuevo." });
    return { step: "problem" };
  }
  try {
    const actor = await systemTx((tx) => loadActor(tx, ctx.userId!));
    const id = await submitRequestPayload(actor!, draft.data);
    await attachWhatsAppPhotos(id, { claimedBy: ctx.userId! });
    await sql()`update service_requests set channel = 'whatsapp' where id = ${id}`;
    const [r] = await sql()<{ code: string }[]>`select code from service_requests where id = ${id}`;
    ctx.out.push({ kind: "text", previewUrl: false, text: `Listo, pedido *${r.code}* enviado (${draft.title}). Te aviso por acá cuando haya novedades.\n\nSeguilo en: ${env().APP_URL.replace(/\/$/, "")}/app/solicitudes/${id}` });
    return { step: "done" };
  } catch (e) {
    ctx.out.push({ kind: "text", text: `No pude enviarlo: ${isDomainError(e) ? e.message : "hubo un error"}. Contame el problema y lo armamos de nuevo.` });
    return { step: "problem" };
  }
}

/** Link para vincular este WhatsApp a una cuenta existente, sin pedido (para ver y actualizar pedidos por acá). */
async function sendLinkOnly(s: State, ctx: Ctx): Promise<State> {
  if (ctx.userId) {
    ctx.out.push({ kind: "text", text: "Tu WhatsApp ya está vinculado a tu cuenta de Fixy." });
    return s;
  }
  const token = randomBytes(24).toString("base64url");
  await sql()`insert into whatsapp_links (token_hash, phone, data) values (${hash(token)}, ${ctx.phone}, ${sql().json({} as never)})`;
  ctx.out.push({
    kind: "text", previewUrl: true,
    text: `Ingresá a tu cuenta desde este link y confirmá que este WhatsApp es tuyo. Después vas a poder ver tus pedidos y sumarles fotos o datos por acá.\n\n${env().APP_URL.replace(/\/$/, "")}/wa/${token}`,
  });
  return { ...s, step: "idle" };
}

function greet(ctx: Ctx, open: OpenRequest[], draft: Draft | null): State {
  const hi = `Hola${ctx.name ? ` ${ctx.name}` : ""}`;
  if (draft) return offerDraft(ctx, draft, `${hi}, ¿en qué te ayudo?`);
  if (open.length) {
    ctx.out.push({
      kind: "buttons", text: `${hi}, ¿en qué te ayudo? Tenés ${open.length === 1 ? `el pedido *${open[0].code}* abierto` : `${open.length} pedidos abiertos`}.`,
      buttons: [{ id: "my_requests", title: "Cómo van mis pedidos" }, { id: "add_details", title: "Sumar fotos o datos" }, { id: "new_req", title: "Pedido nuevo" }],
    });
    return { step: "done" };
  }
  ctx.out.push({ kind: "text", text: `${hi}, soy Fixy. Contame qué problema tenés (por ejemplo: «gotea la canilla de la cocina») y te muestro profesionales que pueden ir. Si querés, mandame fotos: se suman al pedido.` });
  return { step: "problem" };
}

function offerDraft(ctx: Ctx, draft: Draft, lead: string): State {
  ctx.out.push({
    kind: "buttons", text: `${lead} Tu pedido «${draft.title}» quedó armado pero sin enviar. ¿Lo envío ahora?`,
    buttons: [{ id: "draft_send", title: "Sí, enviarlo" }, { id: "new_req", title: "Es otro pedido" }],
  });
  return { step: "done" };
}

async function answerOffScript(u: Understood, ctx: Ctx) {
  if (u.kind === "human") {
    ctx.out.push({ kind: "text", text: `Para hablar con una persona del equipo de Fixy, escribinos a ${SUPPORT_EMAIL} y te respondemos por mail.` });
    return;
  }
  const answer = u.answer ?? (u.kind === "greeting" ? null : `Te ayudo por acá a hacer un pedido, ver cómo van tus pedidos o sumarles fotos y detalles. Para hablar con una persona del equipo, escribinos a ${SUPPORT_EMAIL}.`);
  if (answer) ctx.out.push({ kind: "text", text: answer });
}

/**
 * El mensaje no es el dato que esperábamos: respondemos la pregunta o atendemos lo que pide (estado, sumar datos)
 * y, si veníamos armando un pedido, se lo recordamos sin perder lo que ya cargó.
 */
async function handleOffScript(u: Understood, s: State, ctx: Ctx, open: OpenRequest[], draft: Draft | null, reprompt?: string): Promise<State> {
  const midFlow = !["idle", "done", "awaiting_account"].includes(s.step);
  if (u.kind === "status" || u.kind === "add_details") {
    if (!ctx.userId) {
      ctx.out.push({
        kind: "buttons", text: "Todavía no tengo este WhatsApp vinculado a una cuenta de Fixy, así que no puedo ver tus pedidos. Si ya tenés cuenta, vinculalo y te los muestro por acá.",
        buttons: [{ id: "link_account", title: "Vincular mi cuenta" }, { id: "new_req", title: "Pedido nuevo" }],
      });
      return midFlow ? s : { step: "idle" };
    }
    if (!open.length) {
      if (draft) return offerDraft(ctx, draft, "No veo pedidos enviados con este número.");
      ctx.out.push({ kind: "text", text: `No veo pedidos abiertos con este número.${midFlow && reprompt ? ` ${reprompt}` : " Contame qué problema tenés y armamos uno."}` });
      return midFlow ? s : { step: "problem" };
    }
    if (u.kind === "status") return showStatus(s, ctx);
    return u.requestId ? startAddTo(s, u.requestId, ctx) : askWhichRequest({ ...s, step: "pick_request" }, ctx);
  }
  await answerOffScript(u, ctx);
  if (midFlow) {
    if (reprompt) ctx.out.push({ kind: "text", text: reprompt });
    return s;
  }
  if (draft) return offerDraft(ctx, draft, "Por cierto:");
  if (open.length) {
    ctx.out.push({ kind: "buttons", text: "¿Querés hacer algo más?", buttons: [{ id: "my_requests", title: "Cómo van mis pedidos" }, { id: "add_details", title: "Sumar fotos o datos" }, { id: "new_req", title: "Pedido nuevo" }] });
    return { step: "done" };
  }
  if (u.kind !== "greeting") ctx.out.push({ kind: "text", text: "Si necesitás un profesional, contame qué problema tenés y te muestro quiénes pueden ir." });
  return { step: "problem" };
}

/** En un paso que espera un dato (dirección, presupuesto…) llegó otra cosa: lo entendemos y volvemos a pedir el dato. */
async function offScriptAt(s: State, text: string, expecting: Expecting, ctx: Ctx, reprompt: string): Promise<State> {
  const open = ctx.userId ? await openRequests(ctx.userId) : [];
  const u = await understand(text, { expecting, open, linked: !!ctx.userId });
  if (u.kind === "data" && expecting === "address" && !looksLikeQuestion(text)) return onAddressText(s, text, ctx, s.step === "address");
  if (u.kind === "data") {
    ctx.out.push({ kind: "text", text: reprompt });
    return s;
  }
  return handleOffScript(u, s, ctx, open, null, reprompt);
}

function askBudget(s: State, ctx: Ctx): State {
  ctx.out.push({ kind: "text", text: "¿Cuánto querés pagar por el trabajo (mano de obra y materiales)? Escribilo en pesos, por ejemplo *60.000* o *60 mil*. Al contratar se suma el cargo de servicio de Fixy (10 %)." });
  return { ...s, step: "budget" };
}

async function allZones(): Promise<Zone[]> {
  return sql()<Zone[]>`select id, code, name, region, match_names from zones where active order by sort, name`;
}

/** Pide hablar con una persona: la atención humana es por mail. */
export function wantsHuman(t: string): boolean {
  return /\b(humano|una persona|persona real|representante|asesor|operador|atencion al cliente|hablar con alguien|alguien del equipo)\b/.test(t);
}

// ───────────────────────── Vinculación desde el link ─────────────────────────

/** Datos para la pantalla de confirmación: solo los últimos dígitos del número, nunca el pedido. */
export async function peekWhatsAppLink(token: string): Promise<{ phoneTail: string; usedBy: string | null; hasRequest: boolean } | null> {
  const [l] = await sql()<{ phone: string; used_by: string | null; has_request: boolean }[]>`
    select phone, used_by, coalesce(data->>'description', '') <> '' as has_request from whatsapp_links where token_hash = ${hash(token)} and created_at > now() - interval '7 days'`;
  return l ? { phoneTail: l.phone.slice(-4), usedBy: l.used_by, hasRequest: l.has_request } : null;
}

/**
 * Valida el link (7 días, un solo uso) y vincula el número a la cuenta. Devuelve el pedido guardado.
 * Se llama solo desde una acción con confirmación explícita (nunca desde un GET), y nunca reemplaza
 * un WhatsApp ya vinculado a la cuenta: así nadie puede atar su teléfono a la cuenta de otra persona.
 */
export async function consumeWhatsAppLink(token: string, userId: string): Promise<{ data: RequestPayload; phone: string } | { error: string }> {
  return systemTx(async (tx) => {
    const [l] = await tx<{ id: string; phone: string; data: RequestPayload; used_by: string | null }[]>`
      select id, phone, data, used_by from whatsapp_links where token_hash = ${hash(token)} and created_at > now() - interval '7 days' for update`;
    if (!l) return { error: "El link venció o no es válido. Escribinos de nuevo por WhatsApp." };
    if (l.used_by && l.used_by !== userId) return { error: "Este link ya se usó con otra cuenta." };
    const [owner] = await tx<{ id: string }[]>`select id from users where whatsapp_phone = ${l.phone} and id <> ${userId}`;
    if (owner) return { error: "Ese WhatsApp ya está vinculado a otra cuenta de Fixy." };
    const [me] = await tx<{ whatsapp_phone: string | null }[]>`select whatsapp_phone from users where id = ${userId} for update`;
    if (me?.whatsapp_phone && me.whatsapp_phone !== l.phone) return { error: "Tu cuenta ya tiene otro WhatsApp vinculado. Escribinos desde ese número." };
    await tx`update users set whatsapp_phone = ${l.phone}, whatsapp_linked_at = coalesce(whatsapp_linked_at, now()) where id = ${userId}`;
    await tx`update whatsapp_links set used_at = coalesce(used_at, now()), used_by = ${userId} where id = ${l.id}`;
    // Las fotos que mandó por WhatsApp quedan reservadas para el pedido que termine en la web.
    await tx`update whatsapp_media set claimed_by = ${userId} where phone = ${l.phone} and request_id is null and created_at > now() - interval '7 days'`;
    await tx`update whatsapp_conversations set state = '{"step":"done"}'::jsonb, updated_at = now() where phone = ${l.phone}`;
    return { data: l.data, phone: l.phone };
  });
}


// ───────────────────────── Fotos ─────────────────────────

const MAX_PHOTOS = 6;

async function saveIncomingPhoto(phone: string, mediaId: string): Promise<string | null> {
  const media = await downloadMedia(mediaId);
  if (!media) return null;
  try {
    const [u] = await sql()<{ id: string }[]>`select id from users where whatsapp_phone = ${phone}`;
    const fileId = await storeFile(sql(), { data: media.data, originalName: "foto-whatsapp.jpg", uploadedBy: u?.id ?? null, purpose: "request_photo", ownerType: null, ownerId: null, allowPdf: false });
    await sql()`insert into whatsapp_media (phone, file_id) values (${phone}, ${fileId})`;
    return fileId;
  } catch {
    console.warn("[whatsapp] foto recibida con formato no admitido o demasiado grande");
    return null;
  }
}

async function onPhoto(s: State, msg: Inbound, ctx: Ctx): Promise<State> {
  const caption = (msg.text ?? "").trim();
  if (!msg.fileId) {
    ctx.out.push({ kind: "text", text: "No pude guardar esa foto. Probá mandarla de nuevo (JPG o PNG, hasta 8 MB)." });
    return s;
  }
  const fresh = ["idle", "done", "awaiting_account"].includes(s.step);
  const base: State = fresh ? { step: "problem" } : s;
  const photos = [...(base.photos ?? []), msg.fileId].slice(0, MAX_PHOTOS);
  const next: State = { ...base, photos };
  if (next.step === "problem") {
    if (caption.length >= 10 && !isGreeting(caption)) return onProblem(next, caption, ctx);
    ctx.out.push({ kind: "text", text: `Recibí la foto${photos.length > 1 ? ` (${photos.length})` : ""}. Contame en una oración qué pasa y te muestro profesionales que pueden ir.` });
    return next;
  }
  ctx.out.push({ kind: "text", text: photos.length >= MAX_PHOTOS ? `Sumé la foto. Ya tenés ${MAX_PHOTOS}, el máximo por pedido.` : `Sumé la foto al pedido (${photos.length}).` });
  return next.step === "confirm" ? confirm(next, ctx) : next;
}

/**
 * Adjunta al pedido las fotos recibidas por WhatsApp. Solo fotos del mismo número (bot) o reservadas para esa cuenta
 * al usar el link (web); nunca ids que vengan del navegador.
 */
export async function attachWhatsAppPhotos(requestId: string, who: { phone: string; fileIds: string[] } | { claimedBy: string }) {
  await systemTx(async (tx) => {
    const rows = "phone" in who
      ? who.fileIds.length
        ? await tx<{ id: number; file_id: string }[]>`select id, file_id from whatsapp_media where phone = ${who.phone} and request_id is null and file_id in ${tx(who.fileIds)}`
        : []
      : await tx<{ id: number; file_id: string }[]>`select id, file_id from whatsapp_media where claimed_by = ${who.claimedBy} and request_id is null and created_at > now() - interval '7 days' order by id limit ${MAX_PHOTOS}`;
    for (const r of rows.slice(0, MAX_PHOTOS)) {
      await tx`insert into request_attachments (request_id, file_id) values (${requestId}, ${r.file_id}) on conflict do nothing`;
      await tx`update files set owner_type = 'request', owner_id = ${requestId} where id = ${r.file_id} and owner_id is null`;
      await tx`update whatsapp_media set request_id = ${requestId} where id = ${r.id}`;
    }
  });
}

// ───────────────────────── Pedidos existentes ─────────────────────────

/** Pedidos abiertos del cliente: sin contratar todavía o con un trabajo en curso. */
async function openRequests(userId: string) {
  return sql()<{ id: string; code: string; title: string }[]>`
    select r.id, r.code, r.title from service_requests r
    where (r.created_by = ${userId} or r.responsible_user_id = ${userId})
      and (r.status in ('submitted','searching','with_quotes','no_coverage')
        or (r.status = 'converted' and exists (select 1 from jobs j where j.request_id = r.id and j.status not in ('completed','cancelled'))))
    order by r.created_at desc limit 9`;
}

async function askWhichRequest(s: State, ctx: Ctx): Promise<State> {
  const open = await openRequests(ctx.userId!);
  if (!open.length) {
    ctx.out.push({ kind: "text", text: "No tenés pedidos abiertos. Contame qué problema tenés y armamos uno nuevo." });
    return { step: "problem", photos: s.pendingPhotos };
  }
  if (open.length === 1) return startAddTo(s, open[0].id, ctx);
  ctx.out.push({
    kind: "list", text: "¿A qué pedido querés sumarle fotos o datos?", button: "Elegir pedido",
    sections: [{ title: "Tus pedidos", rows: [...open.map((o) => ({ id: `upd:${o.id}`, title: o.code, description: o.title })), { id: "new_req", title: "Pedido nuevo" }] }],
  });
  return { ...s, step: "pick_request" };
}

async function startAddTo(s: State, requestId: string, ctx: Ctx): Promise<State> {
  const open = await openRequests(ctx.userId!);
  const r = open.find((o) => o.id === requestId);
  if (!r) return askWhichRequest(s, ctx);
  const next: State = { step: "add_to", targetRequestId: r.id };
  if (s.pendingPhotos?.length) {
    await attachWhatsAppPhotos(r.id, { phone: ctx.phone, fileIds: s.pendingPhotos });
    await systemTx((tx) => notifyRequestUpdate(tx, r.id, r.code, "sumó fotos"));
    ctx.out.push({ kind: "buttons", text: `Sumé ${s.pendingPhotos.length === 1 ? "la foto" : `las ${s.pendingPhotos.length} fotos`} a *${r.code}* (${r.title}) y le avisamos al profesional. ¿Algo más?`, buttons: [{ id: "add_done", title: "Eso es todo" }] });
    return next;
  }
  ctx.out.push({ kind: "buttons", text: `Pedido *${r.code}* (${r.title}). Mandame las fotos o escribí lo que quieras sumar.`, buttons: [{ id: "add_done", title: "Nada más" }] });
  return next;
}

async function onPhotoForExisting(s: State, msg: Inbound, ctx: Ctx): Promise<State> {
  if (!msg.fileId) {
    ctx.out.push({ kind: "text", text: "No pude guardar esa foto. Probá mandarla de nuevo (JPG o PNG, hasta 8 MB)." });
    return s;
  }
  if (s.step === "add_to" && s.targetRequestId) {
    const [r] = await sql()<{ code: string }[]>`select code from service_requests where id = ${s.targetRequestId}`;
    await attachWhatsAppPhotos(s.targetRequestId, { phone: ctx.phone, fileIds: [msg.fileId] });
    await systemTx((tx) => notifyRequestUpdate(tx, s.targetRequestId!, r.code, "sumó fotos"));
    if ((msg.text ?? "").trim().length >= 3) {
      const actor = await systemTx((tx) => loadActor(tx, ctx.userId!));
      await addRequestDetails(actor!, s.targetRequestId, msg.text!.trim()).catch(() => null);
    }
    ctx.out.push({ kind: "buttons", text: "Foto sumada al pedido. ¿Algo más?", buttons: [{ id: "add_done", title: "Eso es todo" }] });
    return s;
  }
  const open = await openRequests(ctx.userId!);
  if (!open.length) return onPhoto(s, msg, ctx);
  // Foto con texto: si describe un problema nuevo, arranca un pedido nuevo; si es para uno existente, va ahí.
  const caption = (msg.text ?? "").trim();
  if (caption.length >= 10) {
    const { intent, requestId } = await classifyIntent(caption, open);
    if (intent === "new_request") return onPhoto(s, msg, ctx);
    if (intent === "add_details" && requestId) return startAddTo({ ...s, pendingPhotos: [msg.fileId] }, requestId, ctx);
  }
  const pendingPhotos = [...(s.pendingPhotos ?? []), msg.fileId].slice(0, MAX_PHOTOS);
  ctx.out.push({
    kind: "list", text: "Recibí la foto. ¿Es para un pedido que ya hiciste o para uno nuevo?", button: "Elegir",
    sections: [{ title: "Tus pedidos", rows: [...open.map((o) => ({ id: `upd:${o.id}`, title: o.code, description: o.title })), { id: "new_req", title: "Pedido nuevo" }] }],
  });
  return { step: "pick_request", pendingPhotos };
}

/** Cómo va cada pedido abierto, en lenguaje simple. */
async function showStatus(s: State, ctx: Ctx): Promise<State> {
  const base = env().APP_URL.replace(/\/$/, "");
  const rows = await sql()<{ id: string; code: string; title: string; status: string; request_mode: string; target: string | null; inv_status: string | null; respond_by: Date | null; invited: number; quotes: number; job_status: string | null; job_pro: string | null }[]>`
    select r.id, r.code, r.title, r.status, r.request_mode, tp.display_name as target,
      (select i.status from request_invitations i where i.request_id = r.id and i.provider_id = r.target_provider_id order by i.created_at desc limit 1) as inv_status,
      (select i.respond_by from request_invitations i where i.request_id = r.id and i.provider_id = r.target_provider_id order by i.created_at desc limit 1) as respond_by,
      (select count(*)::int from request_invitations i where i.request_id = r.id) as invited,
      (select count(*)::int from quotes q where q.request_id = r.id and q.status = 'sent') as quotes,
      (select j.status from jobs j where j.request_id = r.id and j.status <> 'cancelled' order by j.created_at desc limit 1) as job_status,
      (select pp.display_name from jobs j join provider_public pp on pp.id = j.provider_id where j.request_id = r.id and j.status <> 'cancelled' order by j.created_at desc limit 1) as job_pro
    from service_requests r left join provider_public tp on tp.id = r.target_provider_id
    where r.id in ${sql()((await openRequests(ctx.userId!)).map((o) => o.id).concat("00000000-0000-0000-0000-000000000000"))}
    order by r.created_at desc`;
  if (!rows.length) {
    ctx.out.push({ kind: "buttons", text: "No tenés pedidos abiertos en este momento.", buttons: [{ id: "new_req", title: "Pedido nuevo" }] });
    return { step: "done" };
  }
  const line = (r: (typeof rows)[number]) => {
    let st: string;
    if (r.job_status) st = `${jobStatusLabel[r.job_status] ?? r.job_status}${r.job_pro ? ` con ${r.job_pro}` : ""}.`;
    else if (r.request_mode === "direct" && r.target) {
      st = r.inv_status === "quoted" ? `${r.target} aceptó y propuso día para la visita: confirmala en Fixy.`
        : r.inv_status === "declined" || r.inv_status === "expired" ? `${r.target} no pudo tomarlo. Elegí otro profesional en Fixy.`
        : `Esperando la respuesta de ${r.target}.`;
    } else if (r.quotes > 0) st = `Tenés ${r.quotes} presupuesto${r.quotes === 1 ? "" : "s"} para comparar.`;
    else if (r.invited > 0) st = `Lo enviamos a ${r.invited} profesional${r.invited === 1 ? "" : "es"}; todavía no respondieron.`;
    else st = requestStatusLabel[r.status] === "Buscando a mano" ? "Nuestro equipo está buscando un profesional para vos." : `${requestStatusLabel[r.status] ?? r.status}.`;
    return `*${r.code}* · ${r.title}\n${st}\n${base}/app/solicitudes/${r.id}`;
  };
  ctx.out.push({ kind: "text", previewUrl: false, text: rows.map(line).join("\n\n") });
  ctx.out.push({ kind: "buttons", text: "¿Querés hacer algo más?", buttons: [{ id: "add_details", title: "Sumar fotos o datos" }, { id: "new_req", title: "Pedido nuevo" }] });
  return { step: "done" };
}
