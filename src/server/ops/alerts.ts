/**
 * Vigilancia: revisa la salud de la operación y abre alertas accionables (una abierta por tipo). Avisa al equipo al
 * abrirse y, si sigue abierta, como máximo cada 6 horas. Se cierran solas cuando la condición desaparece.
 * Cada alerta tiene su guía en docs/operations-runbooks.md.
 */
import { sql, systemTx } from "@/server/db/client";
import { notify, staffRecipients } from "@/server/notifications";
import { log } from "./log";

type Check = { kind: string; severity: "warning" | "critical"; firing: boolean; title: string; body: string; detail: Record<string, unknown> };

export async function healthChecks(): Promise<Check[]> {
  const [q] = await sql()<{ backlog: number; oldest_min: number | null; dead_day: number }[]>`
    select count(*) filter (where status in ('pending','failed','processing') and next_attempt_at <= now())::int as backlog,
      extract(epoch from now() - min(created_at) filter (where status in ('pending','failed') and next_attempt_at <= now())) / 60 as oldest_min,
      count(*) filter (where status = 'dead' and created_at > now() - interval '24 hours')::int as dead_day
    from outbox`;
  const runs = await sql()<{ task: string; last_ok: Date | null; last_failed: boolean | null; fails: number }[]>`
    select t.task,
      (select max(started_at) from cron_runs r where r.task = t.task and r.ok) as last_ok,
      (select not ok from cron_runs r where r.task = t.task and r.finished_at is not null order by started_at desc limit 1) as last_failed,
      (select count(*)::int from (select ok from cron_runs r where r.task = t.task and r.finished_at is not null order by started_at desc limit 3) x where not x.ok) as fails
    from (select distinct task from cron_runs) t`;
  const [pay] = await sql()<{ critical: number }[]>`select count(*)::int as critical from payment_incidents where status = 'open' and severity = 'critical'`;
  const { TASKS } = await import("./tasks");
  const checks: Check[] = [
    {
      kind: "outbox_backlog", severity: "warning", firing: (q.oldest_min ?? 0) > 30,
      title: "Avisos demorados", body: `Hay ${q.backlog} avisos esperando; el más viejo tiene ${Math.round(q.oldest_min ?? 0)} minutos.`,
      detail: { backlog: q.backlog, oldestMinutes: Math.round(q.oldest_min ?? 0) },
    },
    {
      kind: "outbox_dead", severity: "warning", firing: q.dead_day > 0,
      title: "Avisos que no se pudieron enviar", body: `${q.dead_day} avisos fallaron todos sus intentos en las últimas 24 h. Revisalos en Operación → Salud.`,
      detail: { deadLastDay: q.dead_day },
    },
    {
      kind: "payment_incidents", severity: "critical", firing: pay.critical > 0,
      title: "Diferencias de pagos sin resolver", body: `Hay ${pay.critical} incidencias críticas en Finanzas → Conciliación.`,
      detail: { critical: pay.critical },
    },
  ];
  for (const [task, def] of Object.entries(TASKS)) {
    if (task === "watchdog") continue;
    const r = runs.find((x) => x.task === task);
    const stale = !!r?.last_ok && Date.now() - r.last_ok.getTime() > def.everyMinutes * 3 * 60_000;
    checks.push({
      kind: `cron_${task}`, severity: "critical", firing: !!r && (r.fails >= 3 || stale),
      title: `La tarea «${def.label}» está fallando`, body: `Depende de: ${def.external}. Revisá Operación → Salud y los logs de Vercel (evento cron.failed).`,
      detail: { lastOk: r?.last_ok ?? null, consecutiveFailures: r?.fails ?? 0 },
    });
  }
  return checks;
}

export async function runWatchdog() {
  const checks = await healthChecks();
  let opened = 0;
  let resolved = 0;
  await systemTx(async (tx) => {
    for (const c of checks) {
      if (!c.firing) {
        const r = await tx`update ops_alerts set resolved_at = now() where kind = ${c.kind} and resolved_at is null returning id`;
        resolved += r.length;
        continue;
      }
      const [a] = await tx<{ id: string; is_new: boolean; notify: boolean }[]>`
        insert into ops_alerts (kind, severity, detail) values (${c.kind}, ${c.severity}, ${tx.json(c.detail as never)})
        on conflict (kind) where resolved_at is null do update set last_seen_at = now(), detail = excluded.detail
        returning id, (xmax = 0) as is_new, (last_notified_at is null or last_notified_at < now() - interval '6 hours') as notify`;
      if (a.is_new) opened++;
      if (a.notify) {
        await notify(tx, await staffRecipients(tx), { type: "system", title: c.title, body: c.body, link: "/admin/salud" });
        await tx`update ops_alerts set last_notified_at = now() where id = ${a.id}`;
        log(c.severity === "critical" ? "error" : "warn", "ops.alert", { kind: c.kind, detail: c.detail });
      }
    }
  });
  return { opened, resolved, firing: checks.filter((c) => c.firing).map((c) => c.kind) };
}
