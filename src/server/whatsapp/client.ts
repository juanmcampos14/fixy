/**
 * Cliente de WhatsApp Cloud API (Meta). Sin credenciales funciona en modo simulado: registra los mensajes salientes
 * en whatsapp_messages sin enviarlos (desarrollo y tests). Nunca registra el token.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { sql } from "@/server/db/client";
import { env } from "@/server/env";

export type OutButton = { id: string; title: string };
export type OutRow = { id: string; title: string; description?: string };
export type OutMessage =
  | { kind: "text"; text: string; previewUrl?: boolean }
  | { kind: "buttons"; text: string; buttons: OutButton[] }
  | { kind: "list"; text: string; button: string; sections: { title: string; rows: OutRow[] }[] }
  | { kind: "location_request"; text: string };

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export const whatsappConfigured = () => {
  const e = env();
  return !!(e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID);
};

/** Arma el cuerpo de la API respetando los límites de Meta (3 botones de 20 caracteres, listas de 10 filas, etc.). */
export function toGraphPayload(to: string, m: OutMessage) {
  const base = { messaging_product: "whatsapp", recipient_type: "individual", to };
  switch (m.kind) {
    case "text":
      return { ...base, type: "text", text: { body: cut(m.text, 4096), preview_url: !!m.previewUrl } };
    case "buttons":
      return {
        ...base, type: "interactive",
        interactive: { type: "button", body: { text: cut(m.text, 1024) }, action: { buttons: m.buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: cut(b.id, 256), title: cut(b.title, 20) } })) } },
      };
    case "list": {
      let left = 10;
      const sections = m.sections.map((s) => {
        const rows = s.rows.slice(0, left).map((r) => ({ id: cut(r.id, 200), title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) }));
        left -= rows.length;
        return { title: cut(s.title, 24), rows };
      }).filter((s) => s.rows.length);
      return { ...base, type: "interactive", interactive: { type: "list", body: { text: cut(m.text, 4096) }, action: { button: cut(m.button, 20), sections } } };
    }
    case "location_request":
      return { ...base, type: "interactive", interactive: { type: "location_request_message", body: { text: cut(m.text, 1024) }, action: { name: "send_location" } } };
  }
}

export async function sendWhatsApp(to: string, m: OutMessage): Promise<void> {
  const payload = toGraphPayload(to, m);
  if (!whatsappConfigured()) {
    await sql()`insert into whatsapp_messages (phone, direction, kind, body, status) values (${to}, 'out', ${m.kind}, ${sql().json(payload as never)}, 'simulated')`;
    return;
  }
  const e = env();
  let status = "sent";
  let waId: string | null = null;
  try {
    const res = await fetch(`https://graph.facebook.com/${e.WHATSAPP_API_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) {
      status = "failed";
      console.warn(`[whatsapp] envío falló (${res.status}${json.error?.code ? `/${json.error.code}` : ""})`);
    } else waId = json.messages?.[0]?.id ?? null;
  } catch {
    status = "failed";
    console.warn("[whatsapp] envío falló (red)");
  }
  await sql()`insert into whatsapp_messages (wa_message_id, phone, direction, kind, body, status)
    values (${waId}, ${to}, 'out', ${m.kind}, ${sql().json(payload as never)}, ${status}) on conflict (wa_message_id) do nothing`;
}

export async function markRead(messageId: string) {
  if (!whatsappConfigured()) return;
  const e = env();
  await fetch(`https://graph.facebook.com/${e.WHATSAPP_API_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
}

/** Verifica X-Hub-Signature-256 (HMAC-SHA256 del cuerpo crudo con el App Secret). */
export function verifySignature(rawBody: string, header: string | null, appSecret = env().WHATSAPP_APP_SECRET): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex"));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}
