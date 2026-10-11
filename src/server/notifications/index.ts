import type { Db } from "@/server/db/client";
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
  | "review";

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
  send(msg: { to: string; subject: string; text: string; link: string | null }): Promise<void>;
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
  async send(msg) {
    const e = env();
    if (!e.RESEND_API_KEY) throw new Error("Falta RESEND_API_KEY");
    const link = msg.link ? `${e.APP_URL}${msg.link}` : null;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${e.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: e.EMAIL_FROM,
        to: [msg.to],
        subject: msg.subject,
        text: `${msg.text}${link ? `\n\nVer en Fixy: ${link}` : ""}\n\n— Fixy · fixy.solutions`,
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

/** Procesa el outbox con backoff exponencial. Seguro para correr en paralelo (SKIP LOCKED). */
export async function processOutbox(limit = 20, adapter: EmailAdapter = emailAdapter()) {
  let sent = 0;
  let failed = 0;
  await sql().begin(async (tx) => {
    const rows = await tx<{ id: string; payload: { subject: string; text: string; link: string | null }; attempts: number; email: string }[]>`
      select o.id, o.payload, o.attempts, u.email from outbox o join users u on u.id = o.recipient_user_id
      where o.channel = 'email' and not u.sandbox and o.status in ('pending','failed') and o.next_attempt_at <= now()
      order by o.created_at limit ${limit} for update of o skip locked`;
    for (const r of rows) {
      try {
        await adapter.send({ to: r.email, ...r.payload });
        await tx`update outbox set status = 'sent', sent_at = now(), attempts = attempts + 1 where id = ${r.id}`;
        await tx`insert into delivery_attempts (outbox_id, adapter, ok) values (${r.id}, ${adapter.name}, true)`;
        sent++;
      } catch (e) {
        const attempts = r.attempts + 1;
        const err = e instanceof Error ? e.message.slice(0, 300) : "error";
        const delaySec = Math.min(3600, 30 * 2 ** attempts);
        await tx`update outbox set attempts = ${attempts}, last_error = ${err},
          status = ${attempts >= MAX_ATTEMPTS ? "dead" : "failed"},
          next_attempt_at = now() + make_interval(secs => ${delaySec}) where id = ${r.id}`;
        await tx`insert into delivery_attempts (outbox_id, adapter, ok, error) values (${r.id}, ${adapter.name}, false, ${err})`;
        failed++;
      }
    }
  });
  return { sent, failed };
}
