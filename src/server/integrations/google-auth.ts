/**
 * Cuenta de servicio de Google (la misma del proyecto de Firebase): token OAuth por alcance, firmado con su clave.
 * La usan los avisos push (FCM) y la lectura de la planilla de captación.
 */
import { createSign } from "node:crypto";
import { env } from "@/server/env";

export type ServiceAccount = { project_id: string; client_email: string; private_key: string };

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
/** La variable puede venir como JSON o en base64. */
export const decodeSecret = (v: string) => (v.trim().startsWith("{") || v.includes("BEGIN") ? v : Buffer.from(v, "base64").toString("utf8"));

export function serviceAccount(): ServiceAccount | null {
  const raw = env().FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const a = JSON.parse(decodeSecret(raw)) as ServiceAccount;
    return a.project_id && a.client_email && a.private_key ? a : null;
  } catch {
    return null;
  }
}

const tokens = new Map<string, { value: string; exp: number }>();

export async function googleAccessToken(a: ServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cached = tokens.get(scope);
  if (cached && cached.exp > now + 60) return cached.value;
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: a.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }))}`;
  const jwt = `${unsigned}.${b64url(createSign("RSA-SHA256").update(unsigned).sign(a.private_key))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Google respondió ${res.status} al pedir el token`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokens.set(scope, { value: j.access_token, exp: now + j.expires_in });
  return j.access_token;
}
