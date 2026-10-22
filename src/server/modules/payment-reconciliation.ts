/**
 * Conciliación con la pasarela (auditoría H-03). Recorre los cobros por turnos, consulta la pasarela por la referencia
 * de Fixy (no por la tabla del simulador) y:
 *  - repara lo que se repara solo, por la misma vía idempotente del webhook (aviso perdido, devolución o contracargo
 *    hecho en la pasarela, pago duplicado → devolución);
 *  - abre una incidencia con severidad para lo que necesita a una persona (monto distinto, pago que no aparece,
 *    reembolso registrado que la pasarela no tiene, operaciones trabadas o muertas).
 * Nunca modifica el registro financiero por fuera de las reglas ya existentes y deja evidencia de todo.
 */
import { sql, systemTx, type Db, type Tx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { gatewayByName } from "@/server/payments";
import type { GatewayName, GatewayPayment } from "@/server/payments/gateway";
import { notify, staffRecipients } from "@/server/notifications";
import { applyGatewayPayment, drainPaymentCommands, type ChargeRow } from "./payments";
import { replayPaymentCommandTx } from "./payment-commands";

type Severity = "info" | "warning" | "critical";

async function openIncident(tx: Tx, i: { kind: string; severity: Severity; chargeId?: string | null; commandId?: string | null; detail: Record<string, unknown> }) {
  const rows = await tx<{ id: string }[]>`
    insert into payment_incidents (kind, severity, charge_id, command_id, detail)
    values (${i.kind}, ${i.severity}, ${i.chargeId ?? null}, ${i.commandId ?? null}, ${tx.json(i.detail as never)})
    on conflict do nothing returning id`;
  return rows.length > 0;
}

const SETTLED = ["approved", "partially_refunded", "refunded", "in_mediation", "charged_back"];

/** Compara un cobro con lo que la pasarela tiene para su referencia. Devuelve qué hizo. */
async function reconcileCharge(c: ChargeRow): Promise<{ applied: number; incidents: number; error?: string }> {
  let payments: GatewayPayment[];
  try {
    payments = await gatewayByName(c.gateway).searchPayments(sql(), c.external_reference);
  } catch (e) {
    // La pasarela no responde: no se toca nada; se vuelve a intentar en la próxima vuelta.
    return { applied: 0, incidents: 0, error: (e instanceof Error ? e.message : "error").slice(0, 200) };
  }
  let applied = 0;
  let incidents = 0;
  // Primero lo reparable: cada pago pasa por la misma lógica que un webhook (idempotente).
  for (const p of [...payments].reverse()) {
    const r = await systemTx((tx) => applyGatewayPayment(tx, c.gateway, p));
    if (r.result === "applied") applied++;
  }
  if (applied) await drainPaymentCommands({ chargeId: c.id });

  await systemTx(async (tx) => {
    const [now] = await tx<ChargeRow[]>`select * from charges where id = ${c.id} for update`;
    const mine = payments.find((p) => p.id === now.external_payment_id);
    const settled = payments.filter((p) => SETTLED.includes(p.status));
    if (settled.some((p) => p.amountMinor !== now.amount_minor || p.currency !== now.currency)) {
      incidents += Number(await openIncident(tx, { kind: "amount_mismatch", severity: "critical", chargeId: now.id, detail: { reference: now.external_reference, amounts: settled.map((p) => p.amountMinor), internal: now.amount_minor } }));
    }
    if (["approved", "partially_refunded", "refunded"].includes(now.status) && (!mine || !SETTLED.includes(mine.status))) {
      incidents += Number(await openIncident(tx, { kind: "missing_in_gateway", severity: "critical", chargeId: now.id, detail: { reference: now.external_reference, paymentId: now.external_payment_id, gatewayStatus: mine?.status ?? null } }));
    }
    if (mine) {
      const [{ pending }] = await tx<{ pending: number }[]>`select coalesce(sum(amount_minor), 0)::bigint as pending from refunds where charge_id = ${now.id} and status = 'pending'`;
      if (now.refunded_minor > mine.refundedMinor && Number(pending) === 0) {
        incidents += Number(await openIncident(tx, { kind: "refund_not_in_gateway", severity: "critical", chargeId: now.id, detail: { internal: now.refunded_minor, gateway: mine.refundedMinor } }));
      }
    }
    await tx`update charges set reconciled_at = now() where id = ${now.id}`;
  });
  return { applied, incidents };
}

/**
 * Una vuelta de conciliación (la corre el cron). Revisa por turnos los cobros pendientes de más de 15 minutos y los
 * de los últimos 60 días, más el estado de la cola de operaciones. Avisa al equipo si aparecen incidencias críticas.
 */
export async function runReconciliation(opts: { limit?: number } = {}) {
  const charges = await sql()<ChargeRow[]>`
    select * from charges
    where created_at > now() - interval '60 days'
      and (status in ('approved','partially_refunded','failed','refunded') or (status in ('pending','processing') and created_at < now() - interval '15 minutes'))
    order by reconciled_at nulls first, created_at desc limit ${opts.limit ?? 40}`;
  const summary = { checked: 0, applied: 0, incidents: 0, errors: 0 };
  for (const c of charges) {
    const r = await reconcileCharge(c);
    summary.checked++;
    summary.applied += r.applied;
    summary.incidents += r.incidents;
    if (r.error) summary.errors++;
  }
  // Operaciones trabadas: reintentándose hace más de una hora.
  await systemTx(async (tx) => {
    const stuck = await tx<{ id: string; kind: string; charge_id: string | null; attempts: number; last_error: string | null }[]>`
      select id, kind, charge_id, attempts, last_error from payment_commands
      where status in ('pending','retryable','leased') and created_at < now() - interval '1 hour' limit 50`;
    for (const s of stuck) {
      summary.incidents += Number(await openIncident(tx, { kind: "command_stuck", severity: "warning", commandId: s.id, chargeId: s.charge_id, detail: { kind: s.kind, attempts: s.attempts, error: s.last_error } }));
    }
    if (summary.incidents > 0) {
      const [{ critical }] = await tx<{ critical: number }[]>`
        select count(*)::int as critical from payment_incidents where status = 'open' and severity = 'critical' and detected_at > now() - interval '15 minutes'`;
      if (critical > 0) {
        await notify(tx, await staffRecipients(tx), {
          type: "payment", title: `Conciliación: ${critical} diferencia(s) con la pasarela`,
          body: "Hay diferencias entre Fixy y la pasarela que necesitan revisión.", link: "/admin/finanzas?tab=conciliacion",
        });
      }
    }
  });
  return summary;
}

/** Re-sincroniza un cobro consultando la pasarela por su referencia (misma lógica que el webhook). */
export async function resyncCharge(actor: Actor, chargeId: string) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  const [c] = await sql()<ChargeRow[]>`select * from charges where id = ${chargeId}`;
  if (!c) throw notFound();
  const r = await reconcileCharge(c);
  if (r.error) throw invalid(`La pasarela no respondió: ${r.error}`);
  await systemTx((tx) => audit(tx, actor, "charge.resync", "charge", chargeId, "Conciliación manual", { applied: r.applied, incidents: r.incidents }));
  return r;
}

export async function resolveIncident(actor: Actor, incidentId: string, resolution: string) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  if (resolution.trim().length < 10) throw invalid("Contá qué se hizo para resolverla (mínimo 10 caracteres).");
  await systemTx(async (tx) => {
    const [i] = await tx<{ status: string }[]>`select status from payment_incidents where id = ${incidentId} for update`;
    if (!i) throw notFound();
    if (i.status !== "open") throw invalid("La incidencia ya está resuelta.");
    await tx`update payment_incidents set status = 'resolved', resolved_at = now(), resolved_by = ${actor.id}, resolution = ${resolution.trim()} where id = ${incidentId}`;
    await audit(tx, actor, "payment.incident_resolved", "payment_incident", incidentId, resolution.trim());
  });
}

/** Reintenta un reembolso que quedó muerto, con la misma clave (la pasarela no lo duplica). */
export async function replayCommand(actor: Actor, commandId: string) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  const ok = await systemTx(async (tx) => {
    const done = await replayPaymentCommandTx(tx, commandId);
    if (done) await audit(tx, actor, "payment.command_replay", "payment_command", commandId, "Reintento manual");
    return done;
  });
  if (!ok) throw invalid("Solo se pueden reintentar reembolsos que quedaron sin procesar.");
  await drainPaymentCommands({ ids: [commandId] });
}

export type PaymentHealth = Awaited<ReturnType<typeof paymentHealth>>;

/** Tablero de salud de pagos para Finanzas. */
export async function paymentHealth(db: Db) {
  const [pending] = await db<{ m15: number; h1: number; d1: number }[]>`
    select count(*) filter (where created_at < now() - interval '15 minutes')::int as m15,
           count(*) filter (where created_at < now() - interval '1 hour')::int as h1,
           count(*) filter (where created_at < now() - interval '1 day')::int as d1
    from charges where status in ('pending','processing')`;
  const commands = await db<{ status: string; n: number }[]>`select status, count(*)::int as n from payment_commands where status <> 'succeeded' group by status`;
  const [refunds] = await db<{ pending: number; failed: number }[]>`
    select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'failed')::int as failed from refunds`;
  const [holds] = await db<{ n: number; amount: number }[]>`select count(*)::int as n, coalesce(sum(amount_minor),0)::bigint as amount from payouts where on_hold and status in ('pending','scheduled','failed')`;
  const [unreconciled] = await db<{ n: number; amount: number }[]>`
    select count(*)::int as n, coalesce(sum(amount_minor),0)::bigint as amount from charges
    where status in ('approved','partially_refunded') and (reconciled_at is null or reconciled_at < now() - interval '2 days')`;
  const incidents = await db<{ id: string; kind: string; severity: Severity; charge_id: string | null; command_id: string | null; detail: Record<string, unknown>; detected_at: Date; job_code: string | null; command_kind: string | null; command_status: string | null }[]>`
    select i.id, i.kind, i.severity, i.charge_id, i.command_id, i.detail, i.detected_at, j.code as job_code, pc.kind as command_kind, pc.status as command_status
    from payment_incidents i left join charges c on c.id = i.charge_id left join jobs j on j.id = c.job_id
    left join payment_commands pc on pc.id = i.command_id
    where i.status = 'open' order by case i.severity when 'critical' then 0 when 'warning' then 1 else 2 end, i.detected_at desc limit 100`;
  return {
    pending,
    commands: Object.fromEntries(commands.map((c) => [c.status, c.n])) as Record<string, number>,
    refunds,
    holds: { n: holds.n, amount: Number(holds.amount) },
    unreconciled: { n: unreconciled.n, amount: Number(unreconciled.amount) },
    incidents,
  };
}

export type { GatewayName };
