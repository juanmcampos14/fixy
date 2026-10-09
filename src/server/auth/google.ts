/**
 * Ingreso con Google (OpenID Connect, flujo "authorization code" con PKCE).
 * - state + nonce + code_verifier viajan en una cookie httpOnly de corta vida y se comparan a la vuelta.
 * - El id_token se recibe directo del endpoint de tokens de Google por TLS (servidor a servidor), por eso alcanza con
 *   validar emisor, audiencia, vencimiento y nonce (OIDC Core §3.1.3.7). Nunca se usa un token que venga del navegador.
 */
import { createHash, randomBytes } from "node:crypto";
import { env } from "@/server/env";

export const GOOGLE_COOKIE = "fixy_google";
const b64url = (b: Buffer) => b.toString("base64url");

export const googleConfigured = () => !!(env().GOOGLE_CLIENT_ID && env().GOOGLE_CLIENT_SECRET);
export const googleRedirectUri = () => `${env().APP_URL.replace(/\/$/, "")}/auth/google/callback`;

export function startGoogleLogin(next: string) {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env().GOOGLE_CLIENT_ID, redirect_uri: googleRedirectUri(), response_type: "code", scope: "openid email profile",
    state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return { url: url.toString(), cookie: JSON.stringify({ state, nonce, verifier, next }) };
}

export type GoogleIdentity = { sub: string; email: string; emailVerified: boolean; name: string };

export async function finishGoogleLogin(code: string, saved: { nonce: string; verifier: string }): Promise<GoogleIdentity> {
  const e = env();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: e.GOOGLE_CLIENT_ID, client_secret: e.GOOGLE_CLIENT_SECRET, redirect_uri: googleRedirectUri(), grant_type: "authorization_code", code_verifier: saved.verifier }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Google respondió ${res.status}`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Google no devolvió la identidad");
  const payload = JSON.parse(Buffer.from(id_token.split(".")[1] ?? "", "base64url").toString("utf8")) as {
    iss?: string; aud?: string; exp?: number; nonce?: string; sub?: string; email?: string; email_verified?: boolean | string; name?: string;
  };
  const now = Math.floor(Date.now() / 1000);
  if (!["https://accounts.google.com", "accounts.google.com"].includes(payload.iss ?? "")) throw new Error("Emisor inválido");
  if (payload.aud !== e.GOOGLE_CLIENT_ID) throw new Error("Audiencia inválida");
  if (!payload.exp || payload.exp < now) throw new Error("Identidad vencida");
  if (payload.nonce !== saved.nonce) throw new Error("Nonce inválido");
  if (!payload.sub || !payload.email) throw new Error("Identidad incompleta");
  return { sub: payload.sub, email: payload.email, emailVerified: payload.email_verified === true || payload.email_verified === "true", name: payload.name ?? "" };
}
