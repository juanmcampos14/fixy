import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sql, systemTx } from "@/server/db/client";
import { env } from "@/server/env";
import { loadActor, canAccessAdmin, isPlatformAdmin, type Actor } from "./actor";
import { levelFor, type AdminSection } from "./permissions";
import { DomainError, forbidden } from "@/server/domain/errors";
import { audit } from "@/server/audit";
import { mfaAvailable } from "./mfa";

export const SESSION_COOKIE = "fixy_session";

/**
 * Política de sesiones (auditoría A-04):
 *  - clientes y profesionales: 30 días como máximo y vencen tras 14 días sin uso;
 *  - equipo de Fixy: 7 días como máximo y vencen tras 12 horas sin uso, con segundo factor.
 * El token es aleatorio (32 bytes) y en la base solo queda su hash. Cada sesión guarda un resumen del dispositivo para
 * poder listarla y cerrarla desde "Mi cuenta".
 */
const USER = { absoluteDays: 30, idleHours: 14 * 24 };
const STAFF = { absoluteDays: 7, idleHours: 12 };
const TOUCH_EVERY_MS = 5 * 60_000;

/** Vencimiento absoluto o por inactividad, según sea del equipo o no. */
export function sessionIsExpired(staff: boolean, createdAt: Date, lastSeenAt: Date, now = Date.now()) {
  const policy = staff ? STAFF : USER;
  return now - lastSeenAt.getTime() > policy.idleHours * 3600_000 || now - createdAt.getTime() > policy.absoluteDays * 86400_000;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Resumen del dispositivo, sin datos de más: navegador/sistema y la red (no la IP completa). */
function deviceHint(h: Headers) {
  const ua = (h.get("user-agent") ?? "").slice(0, 200) || null;
  const ip = (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  const ipHint = ip.includes(".") ? ip.split(".").slice(0, 3).join(".") + ".x" : ip.includes(":") ? ip.split(":").slice(0, 3).join(":") + "::" : null;
  return { ua, ipHint };
}

async function setCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    expires,
  });
}

/** Inicia sesión con un token nuevo (nunca se reutiliza uno existente: evita fijación de sesión). */
export async function createSession(userId: string, opts: { mfaVerified?: boolean } = {}) {
  const token = randomBytes(32).toString("base64url");
  const [u] = await sql()<{ platform_role: string | null }[]>`select platform_role from users where id = ${userId}`;
  const policy = u?.platform_role ? STAFF : USER;
  const expires = new Date(Date.now() + policy.absoluteDays * 86400_000);
  const { ua, ipHint } = deviceHint(await headers());
  await sql()`insert into sessions (token_hash, user_id, expires_at, user_agent, ip_hint, mfa_verified_at)
    values (${hashToken(token)}, ${userId}, ${expires}, ${ua}, ${ipHint}, ${opts.mfaVerified ? new Date() : null})`;
  await setCookie(token, expires);
}

/** Hash de la sesión actual (para atarle recursos que deben morir con ella, como el dispositivo de avisos). */
export async function currentSessionHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await sql()`delete from sessions where token_hash = ${hashToken(token)}`;
  jar.delete(SESSION_COOKIE);
}

export type SessionInfo = { id: string; userId: string; tokenHash: string; mfaVerifiedAt: Date | null };

/** Sesión vigente del request (cacheada). Aplica vencimiento absoluto y por inactividad según el rol. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [s] = await sql()<{ id: string; user_id: string; created_at: Date; last_seen_at: Date; mfa_verified_at: Date | null; staff: boolean }[]>`
    select s.id, s.user_id, s.created_at, s.last_seen_at, s.mfa_verified_at, (u.platform_role is not null) as staff
    from sessions s join users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)} and s.expires_at > now() and u.disabled_at is null`;
  if (!s) return null;
  const now = Date.now();
  if (sessionIsExpired(s.staff, s.created_at, s.last_seen_at, now)) {
    await sql()`delete from sessions where id = ${s.id}`;
    return null;
  }
  if (now - s.last_seen_at.getTime() > TOUCH_EVERY_MS) await sql()`update sessions set last_seen_at = now() where id = ${s.id}`;
  return { id: s.id, userId: s.user_id, tokenHash: hashToken(token), mfaVerifiedAt: s.mfa_verified_at };
});

/** Usuario de la sesión actual (cacheado por request). */
export const getActor = cache(async (): Promise<Actor | null> => {
  const s = await getSession();
  if (!s) return null;
  return systemTx((tx) => loadActor(tx, s.userId));
});

export async function requireActor(next?: string): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect(`/ingresar${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return a;
}

/**
 * Cambia el token de la sesión actual por uno nuevo (al verificar el segundo factor: elevación de privilegios).
 * El dispositivo de avisos atado a la sesión vieja pasa a la nueva.
 */
export async function rotateSession(opts: { mfaVerified?: boolean } = {}) {
  const s = await getSession();
  if (!s) return;
  const token = randomBytes(32).toString("base64url");
  const newHash = hashToken(token);
  const [row] = await systemTx(async (tx) => {
    const r = await tx<{ expires_at: Date }[]>`
      insert into sessions (token_hash, user_id, expires_at, user_agent, ip_hint, mfa_verified_at, last_seen_at)
      select ${newHash}, user_id, expires_at, user_agent, ip_hint, ${opts.mfaVerified ? new Date() : null}, now() from sessions where id = ${s.id}
      returning expires_at`;
    await tx`update push_devices set session_hash = ${newHash} where session_hash = ${s.tokenHash}`;
    await tx`delete from sessions where id = ${s.id}`;
    return r;
  });
  if (row) await setCookie(token, row.expires_at);
}

/**
 * Marca la sesión actual como verificada con segundo factor sin cambiar el token. Se usa al activarlo: cambiar la
 * cookie haría que la página se recargue y se perderían los códigos de respaldo que hay que mostrar una sola vez.
 */
export async function markSessionMfaVerified() {
  const s = await getSession();
  if (s) await sql()`update sessions set mfa_verified_at = now() where id = ${s.id}`;
}

// ── Sesiones del usuario ("Mi cuenta → Sesiones abiertas") ──
export async function listMySessions(actor: Actor) {
  const current = await getSession();
  const rows = await sql()<{ id: string; created_at: Date; last_seen_at: Date; user_agent: string | null; ip_hint: string | null }[]>`
    select id, created_at, last_seen_at, user_agent, ip_hint from sessions where user_id = ${actor.id} and expires_at > now() order by last_seen_at desc`;
  return rows.map((r) => ({ ...r, current: r.id === current?.id }));
}

export async function revokeMySession(actor: Actor, sessionId: string) {
  await sql()`delete from sessions where id = ${sessionId} and user_id = ${actor.id}`;
  await systemTx((tx) => audit(tx, actor, "session.revoke", "session", sessionId, null));
}

export async function revokeMyOtherSessions(actor: Actor) {
  const current = await getSession();
  const rows = await sql()`delete from sessions where user_id = ${actor.id} and id <> ${current?.id ?? "00000000-0000-0000-0000-000000000000"} returning id`;
  await systemTx((tx) => audit(tx, actor, "session.revoke_others", "user", actor.id, null, { count: rows.length }));
  return rows.length;
}

// ── Segundo factor para el equipo ──
/** El equipo de Fixy (cualquier rol de administración) necesita segundo factor, salvo cuentas de demostración o revisión. */
export function mfaRequired(a: Actor): boolean {
  return canAccessAdmin(a) && !a.isDemo && !a.sandbox && mfaAvailable();
}

/** Qué le falta al usuario para entrar al panel: activar el segundo factor o confirmar el código en esta sesión. */
export async function mfaGate(a: Actor): Promise<"ok" | "enroll" | "verify"> {
  if (!mfaRequired(a)) return "ok";
  const [m] = await sql()<{ enabled: boolean }[]>`select enabled_at is not null as enabled from user_mfa where user_id = ${a.id}`;
  if (!m?.enabled) return "enroll";
  return (await getSession())?.mfaVerifiedAt ? "ok" : "verify";
}

/**
 * Acciones sensibles (reembolsos, transferencias, ajustes, permisos del equipo): exigen haber confirmado el código en
 * los últimos minutos, aunque la sesión ya lo tenga.
 */
export async function requireRecentMfa(a: Actor, minutes = 15) {
  if (!mfaRequired(a)) return;
  const s = await getSession();
  if (!s?.mfaVerifiedAt || Date.now() - s.mfaVerifiedAt.getTime() > minutes * 60_000) {
    throw new DomainError("forbidden", "Por seguridad, volvé a confirmar tu código de verificación (fixy.solutions/seguridad/verificar) y repetí la acción.");
  }
}

/** Entrar al panel de administración (cualquier rol de equipo). */
export async function requireStaff(): Promise<Actor> {
  const a = await requireActor("/admin");
  if (!canAccessAdmin(a)) redirect("/app?error=forbidden");
  const gate = await mfaGate(a);
  if (gate === "enroll") redirect("/seguridad/segundo-factor");
  if (gate === "verify") redirect("/seguridad/verificar?next=/admin");
  return a;
}

/**
 * Página o acción de una sección del panel. "view" para ver; "manage" para modificar.
 * En acciones, si falta permiso se lanza un error de dominio (el formulario muestra el mensaje).
 */
export async function requireSection(section: AdminSection, level: "view" | "manage" = "view"): Promise<{ actor: Actor; readOnly: boolean }> {
  const a = await requireStaff();
  const l = levelFor(a, section);
  if (l === "none") redirect("/admin?error=forbidden");
  if (level === "manage" && l !== "manage") throw forbidden("Tu usuario puede ver esta sección, pero no hacer cambios. Pedile permiso al dueño de la cuenta.");
  return { actor: a, readOnly: l !== "manage" };
}

export async function requirePlatformAdmin(): Promise<Actor> {
  const a = await requireActor("/admin");
  if (!isPlatformAdmin(a)) redirect("/admin?error=forbidden");
  return a;
}

/** Proveedor activo del usuario (primera membresía, o la indicada si pertenece a varias). */
export async function requireProviderMembership(providerId?: string) {
  const a = await requireActor("/proveedor");
  const m = providerId ? a.providers.find((p) => p.id === providerId) : a.providers[0];
  if (!m) redirect("/sumate");
  return { actor: a, membership: m };
}
