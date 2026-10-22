import { createHash, randomBytes } from "node:crypto";
import { systemTx, type Tx } from "@/server/db/client";
import { audit } from "@/server/audit";
import { DomainError } from "@/server/domain/errors";
import type { Actor } from "@/server/auth/actor";

/**
 * Confirmación de email (auditoría H-01): el registro clásico no prueba que la casilla sea de quien se registra.
 * Mandamos un enlace de un solo uso (en la base solo queda su hash) y, hasta abrirlo, la cuenta no recibe otros correos
 * ni puede pagar, cobrar ni sumarse al equipo de Fixy.
 */
const TTL_HOURS = 48;
const MAX_PER_HOUR = 3;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Payload que el outbox de email deja salir aunque la casilla no esté confirmada (es justamente lo que la confirma). */
export const VERIFY_EMAIL_KIND = "verify_email";

/**
 * Genera un enlace nuevo, anula los anteriores y lo encola. Devuelve false si se alcanzó el límite por hora
 * (para no llenarle la casilla a nadie) o si no hay nada que confirmar.
 */
export async function sendEmailVerificationTx(tx: Tx, userId: string): Promise<boolean> {
  const [u] = await tx<{ email: string; email_verified: boolean; email_placeholder: boolean }[]>`
    select email, email_verified, email_placeholder from users where id = ${userId} and disabled_at is null for update`;
  if (!u || u.email_verified || u.email_placeholder) return false;
  const [{ n }] = await tx<{ n: number }[]>`
    select count(*)::int as n from email_verifications where user_id = ${userId} and created_at > now() - interval '1 hour'`;
  if (n >= MAX_PER_HOUR) return false;
  await tx`update email_verifications set used_at = now() where user_id = ${userId} and used_at is null`;
  const token = randomBytes(32).toString("base64url");
  await tx`insert into email_verifications (token_hash, user_id, email, expires_at)
    values (${hashToken(token)}, ${userId}, ${u.email}, now() + make_interval(hours => ${TTL_HOURS}))`;
  await tx`insert into outbox (channel, recipient_user_id, payload) values ('email', ${userId}, ${tx.json({
    kind: VERIFY_EMAIL_KIND,
    subject: "Confirmá tu email en Fixy",
    text: `Abrí el enlace para confirmar que este email es tuyo. Vence en ${TTL_HOURS} horas. Si no creaste una cuenta en Fixy, ignorá este mensaje.`,
    link: `/verificar-email/${token}`,
  } as never)})`;
  return true;
}

/** "Reenviarme el enlace" desde el panel. Responde siempre igual para no revelar límites internos. */
export async function requestEmailVerification(actor: Actor) {
  if (actor.hasEmail === false || actor.emailVerified !== false) return;
  await systemTx((tx) => sendEmailVerificationTx(tx, actor.id));
}

/**
 * Canjea el enlace. Funciona aunque se abra en otro dispositivo sin sesión: el token es la prueba de la casilla.
 * Si el email de la cuenta cambió desde que se mandó el enlace, no confirma el nuevo.
 */
export async function confirmEmail(token: string): Promise<{ userId: string }> {
  return systemTx(async (tx) => {
    const [v] = await tx<{ user_id: string; email: string }[]>`
      update email_verifications set used_at = now()
      where token_hash = ${hashToken(token)} and used_at is null and expires_at > now()
      returning user_id, email`;
    if (!v) throw new DomainError("expired", "El enlace venció o ya fue usado. Entrá a Fixy y pedí uno nuevo.");
    const [u] = await tx<{ id: string }[]>`
      update users set email_verified = true
      where id = ${v.user_id} and lower(email) = lower(${v.email}) and not email_placeholder and disabled_at is null
      returning id`;
    if (!u) throw new DomainError("expired", "El enlace ya no corresponde al email de tu cuenta. Entrá a Fixy y pedí uno nuevo.");
    await tx`update email_verifications set used_at = now() where user_id = ${v.user_id} and used_at is null`;
    await audit(tx, null, "user.email_verified", "user", v.user_id, null);
    return { userId: v.user_id };
  });
}

/**
 * Exige un contacto probado antes de mover dinero o tomar permisos: email confirmado o WhatsApp vinculado
 * (quien se anotó por WhatsApp probó su número). Las cuentas de demostración y de revisión de tiendas quedan exentas.
 */
export async function assertContactVerified(tx: Tx, userId: string, what: string) {
  const [u] = await tx<{ ok: boolean }[]>`
    select (email_verified or whatsapp_phone is not null or is_demo or sandbox) as ok from users where id = ${userId}`;
  if (!u?.ok) throw new DomainError("not_eligible", `Para ${what} primero confirmá tu email: te mandamos un enlace. Si no te llegó, pedí otro desde el aviso de arriba.`);
}
