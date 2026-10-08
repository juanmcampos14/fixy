import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sql, systemTx } from "@/server/db/client";
import { env } from "@/server/env";
import { loadActor, isStaff, isPlatformAdmin, type Actor } from "./actor";

export const SESSION_COOKIE = "fixy_session";
const SESSION_DAYS = 30;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql()`insert into sessions (token_hash, user_id, expires_at) values (${hashToken(token)}, ${userId}, ${expires})`;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await sql()`delete from sessions where token_hash = ${hashToken(token)}`;
  jar.delete(SESSION_COOKIE);
}

/** Usuario de la sesión actual (cacheado por request). */
export const getActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const [s] = await sql()<{ user_id: string }[]>`
    select user_id from sessions where token_hash = ${hashToken(token)} and expires_at > now()`;
  if (!s) return null;
  return systemTx((tx) => loadActor(tx, s.user_id));
});

export async function requireActor(next?: string): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect(`/ingresar${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return a;
}

export async function requireStaff(): Promise<Actor> {
  const a = await requireActor("/admin");
  if (!isStaff(a)) redirect("/app?error=forbidden");
  return a;
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
