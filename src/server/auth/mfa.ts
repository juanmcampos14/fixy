import "server-only";
/**
 * Segundo factor para el equipo de Fixy (auditoría A-04): códigos TOTP de 6 dígitos (RFC 6238, como Google
 * Authenticator) y 10 códigos de respaldo de un solo uso.
 * - El secreto se guarda cifrado con AES-256-GCM; la clave (MFA_ENCRYPTION_KEY) vive fuera de la base.
 * - Los códigos de respaldo solo como hash.
 * - Un mismo código no se acepta dos veces (last_step) y los intentos tienen límite.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import type { Db, Tx } from "@/server/db/client";

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.replace(/=+$/, "").toUpperCase()) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("base32 inválido");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Código TOTP para un paso de tiempo (RFC 4226 §5.3, truncado dinámico). */
export function totpAt(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/**
 * Busca el código en la ventana ±1 paso (tolera relojes desfasados ~30 s). Devuelve el paso que coincidió o null.
 * Compara en tiempo constante.
 */
export function matchTotp(secretB32: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = currentStep(now);
  let found: number | null = null;
  for (const s of [step - 1, step, step + 1]) {
    const a = Buffer.from(totpAt(secretB32, s));
    if (timingSafeEqual(a, Buffer.from(code)) && found === null) found = s;
  }
  return found;
}

// ── Cifrado del secreto ──
/** Clave de cifrado. En producción solo MFA_ENCRYPTION_KEY; en desarrollo y pruebas se deriva de una clave local. */
function encryptionKey(): Buffer | null {
  const e = env();
  if (e.MFA_ENCRYPTION_KEY) return createHash("sha256").update(`fixy-mfa-v1:${e.MFA_ENCRYPTION_KEY}`).digest();
  if (e.NODE_ENV !== "production") return createHash("sha256").update(`fixy-mfa-dev:${e.FILE_SIGNING_SECRET}`).digest();
  return null;
}

/** El segundo factor se puede usar (hay clave de cifrado). Sin clave en producción, el panel avisa y no lo exige. */
export const mfaAvailable = () => encryptionKey() !== null;

export function encryptSecret(secret: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("Falta MFA_ENCRYPTION_KEY");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(secret, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(enc: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("Falta MFA_ENCRYPTION_KEY");
  const [v, iv, tag, ct] = enc.split(":");
  if (v !== "v1") throw new Error("Formato de secreto desconocido");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

// ── Códigos de respaldo ──
const hashCode = (c: string) => createHash("sha256").update(`fixy-recovery:${c.replace(/[^a-z0-9]/gi, "").toLowerCase()}`).digest("hex");

export function newRecoveryCodes(n = 10): { plain: string[]; hashes: string[] } {
  const plain = Array.from({ length: n }, () => {
    const raw = base32Encode(randomBytes(6)).toLowerCase().slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
  return { plain, hashes: plain.map(hashCode) };
}

/** Consume un código de respaldo (una sola vez). */
export async function useRecoveryCode(tx: Tx, userId: string, code: string): Promise<boolean> {
  if (!/^[a-z2-7]{4}-?[a-z2-7]{4}$/i.test(code.trim())) return false;
  const rows = await tx`update user_mfa_recovery_codes set used_at = now()
    where user_id = ${userId} and code_hash = ${hashCode(code.trim())} and used_at is null returning id`;
  return rows.length === 1;
}

export async function remainingRecoveryCodes(db: Db, userId: string): Promise<number> {
  const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from user_mfa_recovery_codes where user_id = ${userId} and used_at is null`;
  return n;
}

export function otpauthUri(secretB32: string, accountEmail: string) {
  const label = encodeURIComponent(`Fixy:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=Fixy&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

export const newSecret = () => base32Encode(randomBytes(20));
