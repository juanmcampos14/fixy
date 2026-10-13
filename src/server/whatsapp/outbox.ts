/**
 * Envía los avisos de WhatsApp encolados en el outbox.
 * - Si la persona nos escribió en las últimas 24 h, va un mensaje común (gratis, sin plantilla).
 * - Si no, la plantilla aprobada por Meta (única forma permitida de escribir primero).
 * Reintentos con backoff, igual que el email.
 */
import { sql } from "@/server/db/client";
import { env } from "@/server/env";
import { sendWhatsApp } from "./client";
import { WA_LANGUAGE, WA_TEMPLATES, waParam, type WaNotice } from "./templates";

const MAX_ATTEMPTS = 6;

export async function processWhatsAppOutbox(limit = 50) {
  let sent = 0;
  let failed = 0;
  const base = env().APP_URL.replace(/\/$/, "");
  await sql().begin(async (tx) => {
    const rows = await tx<{ id: string; payload: WaNotice; attempts: number; phone: string | null; full_name: string; in_window: boolean }[]>`
      select o.id, o.payload, o.attempts, u.whatsapp_phone as phone, u.full_name,
        coalesce(c.last_inbound_at > now() - interval '23 hours', false) as in_window
      from outbox o join users u on u.id = o.recipient_user_id left join whatsapp_conversations c on c.phone = u.whatsapp_phone
      where o.channel = 'whatsapp' and o.status in ('pending','failed') and o.next_attempt_at <= now()
      order by o.created_at limit ${limit} for update of o skip locked`;
    for (const r of rows) {
      if (!r.phone) {
        await tx`update outbox set status = 'dead', last_error = 'Sin número vinculado' where id = ${r.id}`;
        continue;
      }
      const first = r.full_name.split(" ")[0] || "¡hola!";
      const t = WA_TEMPLATES[r.payload.template];
      const path = t?.path ?? "/app/solicitudes/";
      const body = r.payload.audience === "account"
        ? `${r.payload.text}\n\nPara verlo en tu panel, escribí *entrar*.`
        : `${r.payload.text}\n\n${r.payload.audience === "provider" ? "Para verlo y responder por acá, escribí *pedidos*.\n\nO abrilo en la web: " : ""}${base}${path}${r.payload.requestId}`;
      const result = r.in_window || !t
        ? await sendWhatsApp(r.phone, { kind: "text", text: body })
        : await sendWhatsApp(r.phone, { kind: "template", name: t.name, language: WA_LANGUAGE, params: [waParam(first), ...r.payload.params.map((p) => waParam(p))], buttonParam: r.payload.requestId });
      if (result !== "failed") {
        await tx`update outbox set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = ${r.id}`;
        await tx`insert into delivery_attempts (outbox_id, adapter, ok) values (${r.id}, 'whatsapp', true)`;
        sent++;
      } else {
        const attempts = r.attempts + 1;
        await tx`update outbox set attempts = ${attempts}, last_error = 'Meta rechazó el envío (ver whatsapp_messages)',
          status = ${attempts >= MAX_ATTEMPTS ? "dead" : "failed"}, next_attempt_at = now() + make_interval(secs => ${Math.min(3600, 60 * 2 ** attempts)}) where id = ${r.id}`;
        await tx`insert into delivery_attempts (outbox_id, adapter, ok, error) values (${r.id}, 'whatsapp', false, 'envío rechazado')`;
        failed++;
      }
    }
  });
  return { sent, failed };
}
