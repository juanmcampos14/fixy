/**
 * Tareas programadas aisladas (auditoría: cron monolítico). Cada tarea:
 *  - corre una vez por vez (lock con vencimiento en cron_locks: si una corrida muere, el lock vence solo);
 *  - deja registro en cron_runs (duración, resultado o error) y en los logs estructurados;
 *  - falla sola, sin frenar a las demás.
 */
import { randomUUID } from "node:crypto";
import { sql } from "@/server/db/client";
import { log } from "./log";

export type CronTrigger = "cron" | "manual";

export async function runTask<T>(task: string, trigger: CronTrigger, maxSeconds: number, fn: () => Promise<T>) {
  const holder = randomUUID();
  const got = await sql()`
    insert into cron_locks (task, locked_until, holder) values (${task}, now() + make_interval(secs => ${maxSeconds}), ${holder})
    on conflict (task) do update set locked_until = excluded.locked_until, holder = excluded.holder
      where cron_locks.locked_until is null or cron_locks.locked_until < now()
    returning task`;
  if (!got.length) {
    log("info", "cron.skipped", { task, trigger, reason: "en curso" });
    return { task, skipped: true as const };
  }
  const [run] = await sql()<{ id: string }[]>`insert into cron_runs (task, trigger) values (${task}, ${trigger}) returning id`;
  const started = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - started;
    await sql()`update cron_runs set finished_at = now(), ok = true, duration_ms = ${ms}, result = ${sql().json((result ?? null) as never)} where id = ${run.id}`;
    log("info", "cron.ok", { task, trigger, runId: run.id, durationMs: ms, result });
    return { task, ok: true as const, durationMs: ms, result };
  } catch (e) {
    const ms = Date.now() - started;
    const error = (e instanceof Error ? e.message : "error").slice(0, 500);
    await sql()`update cron_runs set finished_at = now(), ok = false, duration_ms = ${ms}, error = ${error} where id = ${run.id}`;
    log("error", "cron.failed", { task, trigger, runId: run.id, durationMs: ms, error });
    return { task, ok: false as const, durationMs: ms, error };
  } finally {
    await sql()`update cron_locks set locked_until = null where task = ${task} and holder = ${holder}`;
  }
}
