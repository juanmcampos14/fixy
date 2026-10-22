/**
 * Contraseñas con scrypt (auditoría A-03). Parámetros de la guía de OWASP: N = 2^17, r = 8, p = 1 (≈ 128 MB y
 * ≈ 0,2 s por intento en el servidor). El formato guarda los parámetros, así que se pueden subir sin migrar a nadie:
 * al ingresar con una contraseña guardada con parámetros viejos, se vuelve a cifrar con los actuales.
 *   actual:  scrypt$N$r$p$sal$hash
 *   anterior: scrypt$N$sal$hash  (r = 8, p = 1)
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

type Params = { N: number; r: number; p: number };
const STRONG: Params = { N: 2 ** 17, r: 8, p: 1 };
// En las pruebas automáticas se usan parámetros livianos (se crean cientos de cuentas); el formato y la lógica son los mismos.
const current = (): Params => (process.env.NODE_ENV === "test" ? { N: 2 ** 12, r: 8, p: 1 } : STRONG);
const maxmem = (q: Params) => 128 * q.N * q.r * 2 + 1024 * 1024;

export async function hashPassword(password: string, params: Params = current()): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { ...params, maxmem: maxmem(params) });
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function parse(stored: string): (Params & { salt: Buffer; hash: Buffer }) | null {
  const parts = stored.split("$");
  if (parts[0] !== "scrypt") return null;
  const [N, r, p, salt, hash] = parts.length === 6 ? [parts[1], parts[2], parts[3], parts[4], parts[5]] : parts.length === 4 ? [parts[1], "8", "1", parts[2], parts[3]] : [];
  const q = { N: Number(N), r: Number(r), p: Number(p) };
  // Límites para que un valor manipulado en la base no pueda pedir memoria o tiempo desmedidos.
  if (!salt || !hash || !Number.isInteger(Math.log2(q.N)) || q.N < 2 ** 10 || q.N > 2 ** 20 || q.r < 1 || q.r > 16 || q.p < 1 || q.p > 8) return null;
  return { ...q, salt: Buffer.from(salt, "base64"), hash: Buffer.from(hash, "base64") };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const s = parse(stored);
  if (!s) return false;
  const actual = await scrypt(password, s.salt, s.hash.length, { N: s.N, r: s.r, p: s.p, maxmem: maxmem(s) });
  return actual.length === s.hash.length && timingSafeEqual(actual, s.hash);
}

/** La contraseña se guardó con parámetros más débiles que los actuales: conviene volver a cifrarla al ingresar. */
export function needsRehash(stored: string): boolean {
  const s = parse(stored);
  const c = current();
  return !s || stored.split("$").length !== 6 || s.N < c.N || s.r < c.r || s.p < c.p;
}
