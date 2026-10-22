/**
 * Envía los avisos de WhatsApp encolados en el outbox.
 * - Si la persona nos escribió en las últimas 24 h, va un mensaje común (gratis, sin plantilla).
 * - Si no, la plantilla aprobada por Meta (única forma permitida de escribir primero).
 * Reintentos con backoff y jitter, igual que el email; se envía sin transacción abierta (src/server/outbox/lease.ts).
 */
import { sql } from "@/server/db/client";
import { claimOutbox, finishOutbox } from "@/server/outbox/lease";
import { env } from "@/server/env";
import { sendWhatsApp } from "./client";
import { WA_LANGUAGE, WA_TEMPLATES, waParam, type WaNotice } from "./templates";

const MAX_ATTEMPTS = 6;

export async function processWhatsAppOutbox(limit = 50) {
  let sent = 0;
  let failed = 0;
  const base = env().APP_URL.replace(/\/$/, "");
  const rows = await claimOutbox<WaNotice>("whatsapp", limit);
  if (!rows.length) return { sent, failed };
  const info = new Map((await sql()<{ id: string; phone: string | null; full_name: string; in_window: boolean }[]>`
    select u.id, u.whatsapp_phone as phone, u.full_name, coalesce(c.last_inbound_at > now() - interval '23 hours', false) as in_window
    from users u left join whatsapp_conversations c on c.phone = u.whatsapp_phone
    where u.id in ${sql()(rows.map((r) => r.recipient_user_id!))}`).map((u) => [u.id, u]));
  for (const r of rows) {
    const u = info.get(r.recipient_user_id!);
    if (!u?.phone) {
      await finishOutbox(r, "whatsapp", { ok: false, error: "Sin número vinculado", retry: false, maxAttempts: MAX_ATTEMPTS, baseSeconds: 60, maxSeconds: 3600 });
      continue;
    }
    const first = u.full_name.split(" ")[0] || "¡hola!";
    const t = WA_TEMPLATES[r.payload.template];
    const path = t?.path ?? "/app/solicitudes/";
    const body = r.payload.audience === "account"
      ? `${r.payload.text}\n\nPara verlo en tu panel, escribí *entrar*.`
      : `${r.payload.text}\n\n${r.payload.audience === "provider" ? "Para verlo y responder por acá, escribí *pedidos*.\n\nO abrilo en la web: " : ""}${base}${path}${r.payload.requestId}`;
    // Envío sin transacción abierta.
    const result = await (u.in_window || !t
      ? sendWhatsApp(u.phone, { kind: "text", text: body })
      : sendWhatsApp(u.phone, { kind: "template", name: t.name, language: WA_LANGUAGE, params: [waParam(first), ...r.payload.params.map((p) => waParam(p))], buttonParam: r.payload.requestId })
    ).catch(() => "failed" as const);
    if (result !== "failed") {
      await finishOutbox(r, "whatsapp", { ok: true });
      sent++;
    } else {
      await finishOutbox(r, "whatsapp", { ok: false, error: "Meta rechazó el envío (ver whatsapp_messages)", retry: true, maxAttempts: MAX_ATTEMPTS, baseSeconds: 60, maxSeconds: 3600 });
      failed++;
    }
  }
  return { sent, failed };
}
