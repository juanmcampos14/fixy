/**
 * Claves de la API de solo lectura (/api/v1): para conectar ChatGPT, Claude o planillas a los datos de captación
 * sin acceso al resto del sistema. La clave se muestra una sola vez; se guarda solo su hash. Cada consulta queda
 * registrada, tiene límite por minuto y la clave se puede revocar en cualquier momento.
 */
import { createHash, randomBytes } from "node:crypto";
import { sql, systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";

export const API_SCOPES = ["captacion:read"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export async function createApiKey(actor: Actor, input: { name: string; expiresDays?: number | null }) {
  if (!can(actor, "captacion", "manage")) throw forbidden();
  const name = input.name.trim();
  if (name.length < 3 || name.length > 80) throw invalid("Poné un nombre para reconocerla (ej.: «GPT de captación»).");
  const days = input.expiresDays ?? null;
  if (days != null && (!Number.isInteger(days) || days < 1 || days > 365)) throw invalid("Vencimiento inválido.");
  const secret = randomBytes(24).toString("base64url").replace(/[^a-zA-Z0-9]/g, "").slice(0, 32).toLowerCase();
  const prefix = `fixy_ro_${secret.slice(0, 6)}`;
  const key = `fixy_ro_${secret}`;
  const id = await systemTx(async (tx) => {
    const [k] = await tx<{ id: string }[]>`
      insert into api_keys (name, prefix, key_hash, created_by, expires_at)
      values (${name}, ${prefix}, ${hash(key)}, ${actor.id}, ${days ? new Date(Date.now() + days * 86400_000) : null}) returning id`;
    await audit(tx, actor, "api_key.create", "api_key", k.id, name, { prefix, expiresDays: days });
    return k.id;
  });
  return { id, key };
}

export async function revokeApiKey(actor: Actor, id: string) {
  if (!can(actor, "captacion", "manage")) throw forbidden();
  await systemTx(async (tx) => {
    const [k] = await tx<{ name: string }[]>`update api_keys set revoked_at = now(), revoked_by = ${actor.id} where id = ${id} and revoked_at is null returning name`;
    if (!k) throw notFound("La clave no existe o ya estaba revocada.");
    await audit(tx, actor, "api_key.revoke", "api_key", id, k.name);
  });
}

export type ApiAuth = { ok: true; keyId: string; name: string } | { ok: false; status: 401 | 429; error: string };

/** Valida la clave (Authorization: Bearer … o X-API-Key) y aplica el límite de 120 consultas por minuto. */
export async function authenticateApiKey(req: Request, scope: ApiScope): Promise<ApiAuth> {
  const header = req.headers.get("authorization") ?? "";
  const key = (header.toLowerCase().startsWith("bearer ") ? header.slice(7) : req.headers.get("x-api-key") ?? "").trim();
  if (!/^fixy_ro_[a-z0-9]{20,40}$/.test(key)) return { ok: false, status: 401, error: "Falta la clave de la API o tiene un formato inválido." };
  const [k] = await sql()<{ id: string; name: string; scopes: string[] }[]>`
    select id, name, scopes from api_keys where key_hash = ${hash(key)} and revoked_at is null and (expires_at is null or expires_at > now())`;
  if (!k || !k.scopes.includes(scope)) return { ok: false, status: 401, error: "Clave inválida, vencida o revocada." };
  const windowStart = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const [rl] = await sql()<{ hits: number }[]>`
    insert into rate_limits (key, window_start, hits) values (${`api:${k.id}`}, ${windowStart}, 1)
    on conflict (key, window_start) do update set hits = rate_limits.hits + 1 returning hits`;
  if (rl.hits > 120) return { ok: false, status: 429, error: "Demasiadas consultas: máximo 120 por minuto." };
  return { ok: true, keyId: k.id, name: k.name };
}

export async function logApiRequest(keyId: string, method: string, path: string, status: number) {
  await sql()`insert into api_key_requests (key_id, method, path, status) values (${keyId}, ${method}, ${path.slice(0, 200)}, ${status})`;
  await sql()`update api_keys set last_used_at = now(), use_count = use_count + 1 where id = ${keyId}`;
}

export async function listApiKeys() {
  return sql()<{ id: string; name: string; prefix: string; created_at: Date; expires_at: Date | null; last_used_at: Date | null; use_count: number; revoked_at: Date | null; created_by: string | null; requests7d: number }[]>`
    select k.id, k.name, k.prefix, k.created_at, k.expires_at, k.last_used_at, k.use_count::int as use_count, k.revoked_at, u.full_name as created_by,
      (select count(*)::int from api_key_requests r where r.key_id = k.id and r.created_at > now() - interval '7 days') as requests7d
    from api_keys k left join users u on u.id = k.created_by order by k.revoked_at nulls first, k.created_at desc`;
}

/** Limpieza del registro (180 días). */
export async function pruneApiRequests() {
  const r = await sql()`delete from api_key_requests where created_at < now() - interval '180 days'`;
  return r.count;
}
