/** Operación (Etapa 3): tareas programadas aisladas y vigilancia con alertas. */
import { describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import { runTask } from "@/server/ops/cron";
import { runWatchdog } from "@/server/ops/alerts";

describe("tareas programadas", () => {
  it("la misma tarea no corre dos veces a la vez; queda registro de cada corrida", async () => {
    const task = `prueba-${Date.now() % 100000}`;
    const slow = () => new Promise((r) => setTimeout(() => r({ hecho: true }), 150));
    const [a, b] = await Promise.all([runTask(task, "manual", 60, slow), runTask(task, "manual", 60, slow)]);
    expect([a, b].filter((r) => "skipped" in r)).toHaveLength(1);
    const runs = await sql()<{ ok: boolean; result: unknown }[]>`select ok, result from cron_runs where task = ${task}`;
    expect(runs).toEqual([{ ok: true, result: { hecho: true } }]);
    // Terminada, se puede volver a correr.
    expect(await runTask(task, "manual", 60, async () => 1)).toMatchObject({ ok: true });
  });

  it("una tarea que falla queda registrada con el error y libera el lock", async () => {
    const task = `falla-${Date.now() % 100000}`;
    const r = await runTask(task, "cron", 60, async () => { throw new Error("Meta no responde"); });
    expect(r).toMatchObject({ ok: false, error: "Meta no responde" });
    expect((await sql()<{ ok: boolean; error: string }[]>`select ok, error from cron_runs where task = ${task}`)[0]).toEqual({ ok: false, error: "Meta no responde" });
    expect(await runTask(task, "cron", 60, async () => "ok")).toMatchObject({ ok: true });
  });

  it("si una corrida murió con el lock tomado, al vencer se puede volver a correr", async () => {
    const task = `colgada-${Date.now() % 100000}`;
    await sql()`insert into cron_locks (task, locked_until, holder) values (${task}, now() + interval '5 minutes', 'muerta')`;
    expect(await runTask(task, "cron", 60, async () => 1)).toMatchObject({ skipped: true });
    await sql()`update cron_locks set locked_until = now() - interval '1 second' where task = ${task}`;
    expect(await runTask(task, "cron", 60, async () => 1)).toMatchObject({ ok: true });
  });
});

describe("vigilancia", () => {
  it("abre una alerta por avisos sin enviar, avisa al equipo una vez y la cierra cuando se resuelve", async () => {
    await sql()`update ops_alerts set resolved_at = now() where resolved_at is null`;
    const [u] = await sql()<{ id: string }[]>`select id from users where platform_role = 'admin' limit 1`;
    const [o] = await sql()<{ id: string }[]>`insert into outbox (channel, recipient_user_id, payload, status, attempts, last_error)
      values ('email', ${u.id}, ${sql().json({ subject: "x", text: "x", link: null } as never)}, 'dead', 6, 'proveedor caído') returning id`;
    const before = (await sql()<{ n: number }[]>`select count(*)::int as n from notifications where type = 'system'`)[0].n;
    const r1 = await runWatchdog();
    expect(r1.firing).toContain("outbox_dead");
    const after = (await sql()<{ n: number }[]>`select count(*)::int as n from notifications where type = 'system'`)[0].n;
    expect(after).toBeGreaterThan(before);
    await runWatchdog();
    expect((await sql()<{ n: number }[]>`select count(*)::int as n from notifications where type = 'system'`)[0].n).toBe(after); // no repite el aviso
    expect(await sql()`select 1 from ops_alerts where kind = 'outbox_dead' and resolved_at is null`).toHaveLength(1);

    await sql()`update outbox set status = 'sent' where id = ${o.id}`;
    await sql()`update outbox set created_at = now() - interval '2 days' where status = 'dead'`;
    const r3 = await runWatchdog();
    expect(r3.firing).not.toContain("outbox_dead");
    expect(await sql()`select 1 from ops_alerts where kind = 'outbox_dead' and resolved_at is null`).toHaveLength(0);
  });
});
