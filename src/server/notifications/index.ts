import type { Db } from "@/server/db/client";
import { claimOutbox, finishOutbox } from "@/server/outbox/lease";
import { sql } from "@/server/db/client";
import { env } from "@/server/env";
import type { WaNotice } from "@/server/whatsapp/templates";

export type NotificationType =
  | "request_received"
  | "invitation"
  | "quote_received"
  | "quote_accepted"
  | "job_status"
  | "reschedule"
  | "extra"
  | "payment"
  | "job_finished"
  | "dispute"
  | "payout"
  | "provider_review"
  | "message"
  | "review"
  /** Alertas operativas para el equipo (vigilancia). */
  | "system";

/**
 * Crea notificaciones internas y encola emails en el outbox (persistente, con reintentos).
 * Se ejecuta dentro de la misma transacción que el cambio que la origina: si la transacción
 * falla, no queda una notificación huérfana; si el email falla, el outbox lo reintenta.
 */
export async function notify(
  db: Db,
  userIds: (string | null | undefined)[],
  n: { type: NotificationType; title: string; body?: string; link?: string; email?: boolean; whatsapp?: WaNotice },
) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  for (const userId of ids) {
    await db`insert into notifications (user_id, type, title, body, link)
      values (${userId}, ${n.type}, ${n.title}, ${n.body ?? ""}, ${n.link ?? null})`;
    if (n.email !== false) {
      await db`insert into outbox (channel, recipient_user_id, payload)
        values ('email', ${userId}, ${db.json({ subject: n.title, text: n.body ?? "", link: n.link ?? null } as never)})`;
    }
    // Push: solo si la persona tiene la app con avisos permitidos en algún dispositivo.
    await db`insert into outbox (channel, recipient_user_id, payload)
      select 'push', ${userId}, ${db.json({ title: n.title, body: n.body ?? "", link: n.link ?? null } as never)}
      where exists (select 1 from push_devices where user_id = ${userId} and disabled_at is null)`;
    // WhatsApp solo a quienes vincularon su número (lo hicieron escribiéndonos: hay consentimiento).
    // Los avisos de profesionales, además, solo si los activaron (y no se dieron de baja).
    // Quien se anotó por WhatsApp no tiene email: todo aviso que no tenga su propio mensaje de WhatsApp le llega igual por ahí.
    if (!n.whatsapp) {
      const notice: WaNotice = { template: "notice", params: [n.title.slice(0, 120)], requestId: "whatsapp", text: `${n.title}${n.body ? `\n${n.body}` : ""}`, audience: "account" };
      await db`insert into outbox (channel, recipient_user_id, payload)
        select 'whatsapp', id, ${db.json(notice as never)} from users
        where id = ${userId} and (email_placeholder or not email_verified) and whatsapp_phone is not null and disabled_at is null`;
    }
    if (n.whatsapp) {
      const providerOnly = n.whatsapp.audience === "provider";
      await db`insert into outbox (channel, recipient_user_id, payload)
        select 'whatsapp', id, ${db.json(n.whatsapp as never)} from users
        where id = ${userId} and whatsapp_phone is not null and disabled_at is null and (${!providerOnly} or wa_provider_alerts)`;
    }
  }
}

/** Destinatarios del lado cliente de una solicitud: creador, responsable y admins de la organización. */
export async function clientRecipients(db: Db, requestId: string): Promise<string[]> {
  const rows = await db<{ id: string }[]>`
    select r.created_by as id from service_requests r where r.id = ${requestId}
    union select r.responsible_user_id from service_requests r where r.id = ${requestId} and r.responsible_user_id is not null
    union select m.user_id from service_requests r join organization_members m on m.organization_id = r.organization_id and m.role = 'admin'
      where r.id = ${requestId}`;
  return rows.map((r) => r.id);
}

/** Administradores activos de un proveedor (+ técnico asignado si se indica). */
export async function providerRecipients(db: Db, providerId: string, assignedUserId?: string | null): Promise<string[]> {
  const rows = await db<{ user_id: string }[]>`
    select user_id from provider_members where provider_id = ${providerId} and active and role = 'admin'`;
  return [...rows.map((r) => r.user_id), ...(assignedUserId ? [assignedUserId] : [])];
}

export async function staffRecipients(db: Db): Promise<string[]> {
  const rows = await db<{ id: string }[]>`select id from users where platform_role in ('operator','admin') and disabled_at is null`;
  return rows.map((r) => r.id);
}

// ───────── Adaptador de email ─────────
export interface EmailAdapter {
  name: string;
  send(msg: { to: string; subject: string; text: string; link: string | null; headers?: Record<string, string> }, opts?: { idempotencyKey?: string }): Promise<void>;
}

const consoleAdapter: EmailAdapter = {
  name: "console",
  async send(msg) {
    // No se registran direcciones completas en logs (minimización de datos).
    const masked = msg.to.replace(/^(.).*(@.*)$/, "$1***$2");
    console.info(`[email:console] → ${masked} · ${msg.subject}`);
  },
};

/** Resend (https://resend.com) vía HTTP. Requiere dominio verificado para EMAIL_FROM. */
const resendAdapter: EmailAdapter = {
  name: "resend",
  async send(msg, opts) {
    const e = env();
    if (!e.RESEND_API_KEY) throw new Error("Falta RESEND_API_KEY");
    const link = msg.link ? `${e.APP_URL}${msg.link}` : null;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      // Si un reintento repite el mismo aviso (el proceso se cayó después de enviarlo), Resend no lo manda dos veces.
      headers: { authorization: `Bearer ${e.RESEND_API_KEY}`, "content-type": "application/json", ...(opts?.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}) },
      body: JSON.stringify({
        from: e.EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: `${msg.text}${link ? `\n\nVer en Fixy: ${link}` : ""}\n\n— Fixy · fixy.solutions`,
        ...(msg.headers ? { headers: msg.headers } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend respondió ${res.status}`);
  },
};

export function emailAdapter(): EmailAdapter {
  switch (env().EMAIL_ADAPTER) {
    case "resend":
      return resendAdapter;
    default:
      return consoleAdapter;
  }
}

const MAX_ATTEMPTS = 6;

/**
 * Envía los emails pendientes. Reclama con lease y envía sin transacción abierta (ver src/server/outbox/lease.ts).
 * Solo a casillas reales y confirmadas (o el enlace que las confirma). La clave idempotente del proveedor es el id del aviso.
 */
export async function processOutbox(limit = 20, adapter: EmailAdapter = emailAdapter()) {
  let sent = 0;
  let failed = 0;
  const rows = await claimOutbox<{ subject: string; text: string; link: string | null }>("email", limit, sql()`
    and exists (select 1 from users u where u.id = o.recipient_user_id and not u.sandbox and not u.email_placeholder
      and (u.email_verified or o.payload->>'kind' = 'verify_email'))`);
  if (!rows.length) return { sent, failed };
  const emails = new Map((await sql()<{ id: string; email: string }[]>`select id, email from users where id in ${sql()(rows.map((r) => r.recipient_user_id!))}`).map((u) => [u.id, u.email]));
  for (const r of rows) {
    try {
      await adapter.send({ to: emails.get(r.recipient_user_id!)!, subject: r.payload.subject, text: r.payload.text, link: r.payload.link }, { idempotencyKey: `outbox-${r.id}` });
      await finishOutbox(r, adapter.name, { ok: true });
      sent++;
    } catch (e) {
      await finishOutbox(r, adapter.name, { ok: false, error: e instanceof Error ? e.message : "error", retry: true, maxAttempts: MAX_ATTEMPTS, baseSeconds: 30, maxSeconds: 3600 });
      failed++;
    }
  }
  return { sent, failed };
}
