/**
 * Avisos push de las apps.
 * - Android: Firebase Cloud Messaging (HTTP v1) con la cuenta de servicio del proyecto.
 * - iOS: APNs directo con la clave .p8 de la cuenta de Apple (token JWT ES256, HTTP/2).
 * Sin credenciales, la plataforma queda apagada: no se registran dispositivos ni se encolan avisos.
 */
import { createPrivateKey, createSign, sign as cryptoSign } from "node:crypto";
import { claimOutbox, finishOutbox } from "@/server/outbox/lease";
import { connect } from "node:http2";
import { sql } from "@/server/db/client";
import { env } from "@/server/env";
import { APP_ID } from "@/lib/app-links";

export type PushPlatform = "ios" | "android";
type PushPayload = { title: string; body: string; link: string | null };
/** "gone": el token ya no sirve (app desinstalada o permiso revocado) y el dispositivo se da de baja. */
type PushResult = "ok" | "gone" | "failed";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const decode = (v: string) => (v.trim().startsWith("{") || v.includes("BEGIN") ? v : Buffer.from(v, "base64").toString("utf8"));

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
function serviceAccount(): ServiceAccount | null {
  const raw = env().FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  try {
    const a = JSON.parse(decode(raw)) as ServiceAccount;
    return a.project_id && a.client_email && a.private_key ? a : null;
  } catch {
    return null;
  }
}
function apnsConfig() {
  const e = env();
  return e.APNS_KEY && e.APNS_KEY_ID && e.APNS_TEAM_ID ? { key: decode(e.APNS_KEY), keyId: e.APNS_KEY_ID, teamId: e.APNS_TEAM_ID } : null;
}

export function pushPlatforms(): Record<PushPlatform, boolean> {
  return { android: !!serviceAccount(), ios: !!apnsConfig() };
}

// ── Android (FCM) ──
let fcmToken: { value: string; exp: number } | null = null;
async function fcmAccessToken(a: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (fcmToken && fcmToken.exp > now + 60) return fcmToken.value;
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: a.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
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
  fcmToken = { value: j.access_token, exp: now + j.expires_in };
  return j.access_token;
}

async function sendAndroid(token: string, p: PushPayload): Promise<PushResult> {
  const a = serviceAccount();
  if (!a) return "failed";
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
    method: "POST",
    headers: { authorization: `Bearer ${await fcmAccessToken(a)}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token, notification: { title: p.title, body: p.body }, data: { link: p.link ?? "" }, android: { priority: "HIGH" } } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return "ok";
  return res.status === 404 || res.status === 410 ? "gone" : "failed";
}

// ── iOS (APNs) ──
let apnsJwt: { value: string; iat: number } | null = null;
function apnsToken(c: NonNullable<ReturnType<typeof apnsConfig>>): string {
  const now = Math.floor(Date.now() / 1000);
  // Apple pide renovarlo entre cada 20 y 60 minutos.
  if (apnsJwt && now - apnsJwt.iat < 40 * 60) return apnsJwt.value;
  const unsigned = `${b64url(JSON.stringify({ alg: "ES256", kid: c.keyId }))}.${b64url(JSON.stringify({ iss: c.teamId, iat: now }))}`;
  const sig = cryptoSign("sha256", Buffer.from(unsigned), { key: createPrivateKey(c.key), dsaEncoding: "ieee-p1363" });
  apnsJwt = { value: `${unsigned}.${b64url(sig)}`, iat: now };
  return apnsJwt.value;
}

function sendIos(token: string, p: PushPayload): Promise<PushResult> {
  const c = apnsConfig();
  if (!c) return Promise.resolve("failed");
  return new Promise((resolve) => {
    const client = connect("https://api.push.apple.com");
    const done = (r: PushResult) => { client.close(); resolve(r); };
    client.on("error", () => done("failed"));
    const req = client.request({
      ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${apnsToken(c)}`,
      "apns-topic": APP_ID, "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json",
    });
    req.setTimeout(10_000, () => { req.close(); done("failed"); });
    req.on("response", (h) => {
      const status = Number(h[":status"]);
      done(status === 200 ? "ok" : status === 410 || status === 400 ? "gone" : "failed");
    });
    req.on("error", () => done("failed"));
    req.end(JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default" }, link: p.link ?? "" }));
  });
}

// ── Dispositivos ──
/**
 * Guarda (o reasigna) el token del dispositivo a la persona que inició sesión en la app, atado a esa sesión:
 * cuando la sesión se cierra o se revoca, el dispositivo se borra solo (ver migración 0042).
 */
export async function registerDevice(userId: string, platform: PushPlatform, token: string, sessionHash: string | null) {
  await sql()`insert into push_devices (user_id, platform, token, session_hash) values (${userId}, ${platform}, ${token}, ${sessionHash})
    on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, session_hash = excluded.session_hash,
      last_seen_at = now(), disabled_at = null`;
}

/** Baja explícita: solo la dueña del dispositivo, con su sesión. */
export async function unregisterDevice(userId: string, token: string) {
  await sql()`delete from push_devices where token = ${token} and user_id = ${userId}`;
}

// ── Envío ──
const MAX_ATTEMPTS = 5;

export async function processPushOutbox(limit = 100) {
  let sent = 0;
  let failed = 0;
  const rows = await claimOutbox<PushPayload>("push", limit);
  for (const r of rows) {
    const devices = await sql()<{ id: string; platform: PushPlatform; token: string }[]>`
      select id, platform, token from push_devices where user_id = ${r.recipient_user_id} and disabled_at is null`;
    let ok = 0;
    let retry = false;
    // Envío a FCM/APNs sin transacción abierta.
    for (const d of devices) {
      const res = await (d.platform === "ios" ? sendIos(d.token, r.payload) : sendAndroid(d.token, r.payload)).catch(() => "failed" as const);
      if (res === "ok") ok++;
      else if (res === "gone") await sql()`update push_devices set disabled_at = now() where id = ${d.id}`;
      else retry = true;
    }
    if (ok) {
      await finishOutbox(r, "push", { ok: true });
      sent++;
    } else {
      // Sin dispositivos activos no hay nada que reintentar; si el servicio rechazó, se reintenta.
      await finishOutbox(r, "push", { ok: false, error: retry ? "El servicio de avisos rechazó el envío" : "Sin dispositivos activos", retry, maxAttempts: MAX_ATTEMPTS, baseSeconds: 30, maxSeconds: 1800 });
      if (retry) failed++;
    }
  }
  return { sent, failed };
}
