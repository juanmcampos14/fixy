/**
 * Traspaso de sesión del navegador del sistema a la app (ingreso con Google dentro de la app).
 * La app genera un secreto, manda su SHA-256 (challenge) al iniciar, y solo quien tiene el secreto puede canjear el código.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/server/db/client";

export const APP_CHALLENGE_COOKIE = "fixy_google_app";
export const APP_SCHEME = "fixy";
export const validChallenge = (c: string | null | undefined): c is string => !!c && /^[A-Za-z0-9_-]{43}$/.test(c);
const sha = (v: string) => createHash("sha256").update(v).digest("base64url");

export async function createHandoff(userId: string, challenge: string, next: string): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await sql()`insert into app_login_handoffs (code_hash, user_id, challenge, next, expires_at)
    values (${sha(code)}, ${userId}, ${challenge}, ${next}, now() + interval '2 minutes')`;
  return code;
}

/**
 * Canjea el código una sola vez y solo con el secreto correcto: se marca usado en la misma sentencia que compara el
 * challenge, así quien intercepte el código sin el secreto no puede gastarlo (auditoría A-05).
 * El challenge es el hash del secreto: compararlo en SQL no filtra nada útil por tiempos.
 */
export async function redeemHandoff(code: string, verifier: string): Promise<{ userId: string; next: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(code) || !/^[A-Za-z0-9_-]{32,200}$/.test(verifier)) return null;
  const [row] = await sql()<{ user_id: string; next: string }[]>`
    update app_login_handoffs set used_at = now()
    where code_hash = ${sha(code)} and challenge = ${sha(verifier)} and used_at is null and expires_at > now()
    returning user_id, next`;
  return row ? { userId: row.user_id, next: row.next } : null;
}
