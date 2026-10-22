/**
 * Ingreso con Google (OpenID Connect, flujo "authorization code" con PKCE).
 * - state + nonce + code_verifier viajan en una cookie httpOnly de corta vida y se comparan a la vuelta.
 * - El id_token llega directo del endpoint de tokens de Google (servidor a servidor) y además se valida con `jose`
 *   (auditoría A-02): firma contra las claves públicas de Google (JWKS), algoritmo RS256, emisor, audiencia, azp,
 *   vencimiento, fecha de emisión, nonce y sujeto. La cuenta se identifica por `sub`, no por el email.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { env } from "@/server/env";

const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
let googleKeys: JWTVerifyGetKey | null = null;
const googleJwks = () => (googleKeys ??= createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 5000, cooldownDuration: 30_000 }));

/** Valida un id_token de Google. `keys` permite inyectar claves en pruebas. */
export async function verifyGoogleIdToken(idToken: string, opts: { clientId: string; nonce: string; keys?: JWTVerifyGetKey }): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(idToken, opts.keys ?? googleJwks(), {
    issuer: GOOGLE_ISSUERS,
    audience: opts.clientId,
    algorithms: ["RS256"],
    requiredClaims: ["iat", "exp", "sub"],
    maxTokenAge: "10m",
    clockTolerance: 60,
  });
  const p = payload as { azp?: string; nonce?: string; sub?: string; email?: string; email_verified?: boolean | string; name?: string };
  if (p.azp && p.azp !== opts.clientId) throw new Error("Cliente autorizado inválido");
  if (!p.nonce || p.nonce !== opts.nonce) throw new Error("Nonce inválido");
  if (!p.sub || !/^[\w-]{1,255}$/.test(p.sub) || !p.email) throw new Error("Identidad incompleta");
  return { sub: p.sub, email: p.email, emailVerified: p.email_verified === true || p.email_verified === "true", name: p.name ?? "" };
}

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
  return verifyGoogleIdToken(id_token, { clientId: e.GOOGLE_CLIENT_ID, nonce: saved.nonce });
}
