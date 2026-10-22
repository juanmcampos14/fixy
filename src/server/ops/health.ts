/** Datos del tablero "Salud del sistema" (tablas de sistema: se leen con la conexión del servidor). */
import { sql } from "@/server/db/client";
import { TASKS, type TaskDef } from "./tasks";

export async function systemHealth() {
  const runs = await sql()<{ task: string; started_at: Date; ok: boolean | null; duration_ms: number | null; error: string | null; trigger: string }[]>`
    select distinct on (task) task, started_at, ok, duration_ms, error, trigger from cron_runs order by task, started_at desc`;
  const stats = await sql()<{ task: string; runs: number; failures: number; p95: number | null }[]>`
    select task, count(*)::int as runs, count(*) filter (where ok = false)::int as failures,
      percentile_cont(0.95) within group (order by duration_ms)::int as p95
    from cron_runs where started_at > now() - interval '24 hours' group by task`;
  const tasks = (Object.entries(TASKS) as [string, TaskDef][]).map(([key, def]) => {
    const last = runs.find((r) => r.task === key) ?? null;
    const s = stats.find((r) => r.task === key);
    return { key, label: def.label, everyMinutes: def.everyMinutes, external: def.external, last, runs24h: s?.runs ?? 0, failures24h: s?.failures ?? 0, p95: s?.p95 ?? null };
  });
  const queues = await sql()<{ channel: string; waiting: number; processing: number; retrying: number; dead24h: number; sent24h: number; oldest_min: number | null }[]>`
    select channel,
      count(*) filter (where status = 'pending')::int as waiting,
      count(*) filter (where status = 'processing')::int as processing,
      count(*) filter (where status = 'failed')::int as retrying,
      count(*) filter (where status = 'dead' and created_at > now() - interval '24 hours')::int as dead24h,
      count(*) filter (where status = 'sent' and sent_at > now() - interval '24 hours')::int as sent24h,
      (extract(epoch from now() - min(created_at) filter (where status in ('pending','failed'))) / 60)::int as oldest_min
    from outbox where created_at > now() - interval '30 days' group by channel order by channel`;
  const dead = await sql()<{ id: string; channel: string; created_at: Date; attempts: number; last_error: string | null; what: string | null; who: string | null }[]>`
    select o.id, o.channel, o.created_at, o.attempts, o.last_error, coalesce(o.payload->>'subject', o.payload->>'title', o.payload->>'template') as what, u.full_name as who
    from outbox o left join users u on u.id = o.recipient_user_id
    where o.status = 'dead' and o.created_at > now() - interval '7 days' order by o.created_at desc limit 50`;
  const alerts = await sql()<{ id: string; kind: string; severity: string; detail: Record<string, unknown>; opened_at: Date; last_seen_at: Date }[]>`
    select id, kind, severity, detail, opened_at, last_seen_at from ops_alerts where resolved_at is null order by severity, opened_at`;
  const [signals] = await sql()<{ last_payment_webhook: Date | null; last_whatsapp_in: Date | null; connections: number; db_size_mb: number }[]>`
    select (select max(received_at) from payment_events) as last_payment_webhook,
      (select max(created_at) from whatsapp_messages where direction = 'in') as last_whatsapp_in,
      (select count(*)::int from pg_stat_activity where datname = current_database()) as connections,
      (pg_database_size(current_database()) / 1024 / 1024)::int as db_size_mb`;
  return { tasks, queues, dead, alerts, signals };
}
