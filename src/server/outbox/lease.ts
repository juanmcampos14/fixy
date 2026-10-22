/**
 * Cola de avisos con lease (auditoría M-07): nunca se espera a la red con filas bloqueadas.
 *   1) claimOutbox: una sola sentencia marca las filas como 'processing' con un lease corto y las devuelve.
 *   2) el procesador envía sin transacción abierta;
 *   3) finishOutbox: 'sent', 'failed' (con backoff y jitter) o 'dead', y registra el intento.
 * Un procesador que se cae deja filas 'processing' con el lease vencido: el próximo las retoma. La entrega es "al menos
 * una vez": el email usa la clave idempotente del proveedor para no duplicar.
 */
import { sql } from "@/server/db/client";
import type postgres from "postgres";

export type OutboxChannel = "email" | "whatsapp" | "push";
export type ClaimedOutbox<P> = { id: string; payload: P; attempts: number; recipient_user_id: string | null };

const LEASE_SECONDS = 90;

export async function claimOutbox<P>(channel: OutboxChannel, limit: number, filter?: postgres.PendingQuery<postgres.Row[]>): Promise<ClaimedOutbox<P>[]> {
  return sql()<ClaimedOutbox<P>[]>`
    update outbox set status = 'processing', lease_until = now() + make_interval(secs => ${LEASE_SECONDS}), attempts = attempts + 1
    where id in (
      select o.id from outbox o
      where o.channel = ${channel}
        and ((o.status in ('pending','failed') and o.next_attempt_at <= now()) or (o.status = 'processing' and o.lease_until < now()))
        ${filter ?? sql()``}
      order by o.created_at limit ${limit}
      for update of o skip locked)
    returning id, payload, attempts, recipient_user_id`;
}

/** Backoff exponencial con jitter (±25 %). */
export const backoff = (attempts: number, baseSeconds: number, maxSeconds: number) =>
  Math.round(Math.min(maxSeconds, baseSeconds * 2 ** attempts) * (0.75 + Math.random() * 0.5));

export async function finishOutbox(
  row: { id: string; attempts: number },
  adapter: string,
  outcome: { ok: true } | { ok: false; error: string; retry: boolean; maxAttempts: number; baseSeconds: number; maxSeconds: number },
) {
  if (outcome.ok) {
    await sql()`update outbox set status = 'sent', sent_at = now(), lease_until = null, last_error = null where id = ${row.id}`;
    await sql()`insert into delivery_attempts (outbox_id, adapter, ok) values (${row.id}, ${adapter}, true)`;
    return;
  }
  const dead = !outcome.retry || row.attempts >= outcome.maxAttempts;
  const error = outcome.error.slice(0, 300);
  await sql()`update outbox set status = ${dead ? "dead" : "failed"}, lease_until = null, last_error = ${error},
    next_attempt_at = now() + make_interval(secs => ${backoff(row.attempts, outcome.baseSeconds, outcome.maxSeconds)}) where id = ${row.id}`;
  await sql()`insert into delivery_attempts (outbox_id, adapter, ok, error) values (${row.id}, ${adapter}, false, ${error})`;
}

/** Reintento manual de un aviso muerto (desde el tablero de salud). */
export async function replayOutbox(id: string): Promise<boolean> {
  const rows = await sql()`update outbox set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null
    where id = ${id} and status = 'dead' returning id`;
  return rows.length === 1;
}
