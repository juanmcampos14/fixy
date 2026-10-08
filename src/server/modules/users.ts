import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { sql, systemTx } from "@/server/db/client";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { DomainError, conflict } from "@/server/domain/errors";

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Ingresá tu nombre.").max(120),
  email: z.string().trim().toLowerCase().email("Ingresá un email válido."),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres.").max(200),
  acceptTerms: z.literal(true, { error: "Tenés que aceptar los términos y la política de privacidad." }),
});

/** Registro abierto. Nunca asigna roles de plataforma: eso solo ocurre desde administración. */
export async function registerUser(input: z.infer<typeof registerSchema>, opts: { isDemo?: boolean } = {}) {
  const d = registerSchema.parse(input);
  const hash = await hashPassword(d.password);
  return systemTx(async (tx) => {
    const [exists] = await tx`select 1 from users where lower(email) = ${d.email}`;
    if (exists) throw conflict("Ya existe una cuenta con ese email. Probá ingresar.");
    const [u] = await tx<{ id: string }[]>`
      insert into users (email, password_hash, full_name, phone, is_demo) values (${d.email}, ${hash}, ${d.fullName}, ${d.phone || null}, ${!!opts.isDemo})
      returning id`;
    const policies = await tx<{ id: string }[]>`select distinct on (kind) id from policy_documents where kind in ('terms','privacy') order by kind, published_at desc`;
    for (const p of policies) await tx`insert into policy_acceptances (user_id, policy_id) values (${u.id}, ${p.id}) on conflict do nothing`;
    return u.id;
  });
}

export async function authenticate(email: string, password: string): Promise<string> {
  const [u] = await sql()<{ id: string; password_hash: string; disabled_at: Date | null }[]>`
    select id, password_hash, disabled_at from users where lower(email) = lower(${email.trim()})`;
  // Mismo mensaje para email inexistente o contraseña incorrecta.
  const fail = new DomainError("unauthenticated", "Email o contraseña incorrectos.");
  if (!u) {
    await hashPassword(password); // tiempo similar para no revelar si el email existe
    throw fail;
  }
  if (u.disabled_at || !(await verifyPassword(password, u.password_hash))) throw fail;
  return u.id;
}

// ───────── Recuperación de contraseña ─────────
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Siempre responde igual (no revela si el email existe). El enlace llega por email vía outbox. */
export async function requestPasswordReset(email: string) {
  const normalized = email.trim().toLowerCase();
  await systemTx(async (tx) => {
    const [u] = await tx<{ id: string }[]>`select id from users where lower(email) = ${normalized} and disabled_at is null`;
    if (!u) return;
    const token = randomBytes(32).toString("base64url");
    await tx`insert into password_resets (token_hash, user_id, expires_at) values (${hashToken(token)}, ${u.id}, now() + interval '1 hour')`;
    await tx`insert into outbox (channel, recipient_user_id, payload) values ('email', ${u.id}, ${tx.json({
      subject: "Restablecé tu contraseña de Fixy",
      text: "Recibimos un pedido para restablecer tu contraseña. El enlace vence en 1 hora. Si no fuiste vos, ignorá este mensaje.",
      link: `/recuperar/${token}`,
    } as never)})`;
  });
}

export async function resetPassword(token: string, newPassword: string) {
  if (newPassword.length < 8) throw new DomainError("invalid_input", "La contraseña debe tener al menos 8 caracteres.");
  const hash = await hashPassword(newPassword);
  return systemTx(async (tx) => {
    const [r] = await tx<{ user_id: string }[]>`
      update password_resets set used_at = now() where token_hash = ${hashToken(token)} and used_at is null and expires_at > now() returning user_id`;
    if (!r) throw new DomainError("expired", "El enlace venció o ya fue usado. Pedí uno nuevo.");
    await tx`update users set password_hash = ${hash} where id = ${r.user_id}`;
    await tx`delete from sessions where user_id = ${r.user_id}`; // cierra sesiones abiertas
    await tx`insert into audit_log (actor_id, action, entity_type, entity_id) values (${r.user_id}, 'user.password_reset', 'user', ${r.user_id})`;
  });
}
