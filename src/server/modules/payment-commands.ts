/**
 * Procesador de operaciones con la pasarela (auditoría H-02). Ninguna llamada a la pasarela se hace con una
 * transacción abierta:
 *
 *   acción de negocio ── tx corta: valida + guarda el comando (payments.ts: enqueuePaymentCommand) ── commit
 *   procesador ── reclama con lease (una sentencia, sin locks durante la red)
 *              ── llama a la pasarela con la clave idempotente del comando
 *              ── tx corta: aplica el resultado (estado, registro financiero, avisos) y cierra el comando
 *
 * Si el proceso se cae después de que la pasarela respondió, el lease vence y otro procesador reintenta con la MISMA
 * clave: la pasarela devuelve la misma operación (no cobra ni devuelve dos veces). Los errores se clasifican:
 * reintentables (timeout, 5xx) con backoff y jitter; definitivos → el comando muere y se aplica su compensación.
 */
import { sql, systemTx, type Tx } from "@/server/db/client";
import { gatewayByName } from "@/server/payments";
import { GatewayError, type GatewayName } from "@/server/payments/gateway";
import {
  failCheckoutTx, failRefundTx, failTransferTx, finalizeCheckoutTx, finalizeOrphanRefundTx, finalizeRefundTx, finalizeTransferTx,
} from "./payments";

export type PaymentCommandKind = "create_checkout" | "refund" | "orphan_refund" | "transfer";

export type PaymentCommand = {
  id: string;
  kind: PaymentCommandKind;
  gateway: GatewayName;
  idempotency_key: string;
  charge_id: string | null;
  refund_id: string | null;
  payout_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
};

const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 8;

/** Backoff exponencial con jitter (30 s, 1 min, 2 min… hasta 1 h). */
const backoffSeconds = (attempts: number) => Math.min(3600, 30 * 2 ** (attempts - 1)) * (0.75 + Math.random() * 0.5);

/**
 * Reclama y ejecuta comandos vencidos. `ids` limita a comandos puntuales (p. ej., los que acaba de crear una acción,
 * para que el resultado se vea en el momento); sin `ids` procesa la cola (cron).
 * Seguro para correr en paralelo: cada comando lo toma un solo procesador por vez.
 */
export async function runPaymentCommands(opts: { ids?: string[]; chargeId?: string; limit?: number } = {}) {
  const limit = opts.limit ?? 25;
  const claimed = await sql()<PaymentCommand[]>`
    update payment_commands set status = 'leased', attempts = attempts + 1,
      lease_until = now() + make_interval(secs => ${LEASE_SECONDS}), updated_at = now()
    where id in (
      select id from payment_commands
      where ((status in ('pending','retryable') and next_attempt_at <= now()) or (status = 'leased' and lease_until < now()))
        ${opts.ids ? sql()`and id = any(${opts.ids})` : sql()``}
        ${opts.chargeId ? sql()`and charge_id = ${opts.chargeId}` : sql()``}
      order by created_at limit ${limit}
      for update skip locked)
    returning id, kind, gateway, idempotency_key, charge_id, refund_id, payout_id, payload, attempts`;
  const summary = { succeeded: 0, retrying: 0, dead: 0 };
  for (const cmd of claimed) {
    const outcome = await execute(cmd);
    summary[outcome]++;
  }
  return summary;
}

async function execute(cmd: PaymentCommand): Promise<"succeeded" | "retrying" | "dead"> {
  const gw = gatewayByName(cmd.gateway);
  const p = cmd.payload as Record<string, never>;
  let result: Record<string, unknown>;
  try {
    // La llamada externa, fuera de toda transacción. La pasarela simulada usa su propia conexión, igual que la real.
    switch (cmd.kind) {
      case "create_checkout":
        result = await gw.createCheckout(sql(), {
          externalReference: p.externalReference, amountMinor: p.amountMinor, currency: "ARS", description: p.description,
          payoutAccountRef: p.payoutAccountRef, marketplaceFeeMinor: p.marketplaceFeeMinor, idempotencyKey: cmd.idempotency_key,
        });
        break;
      case "refund":
      case "orphan_refund":
        result = await gw.refund(sql(), p.paymentId, p.amountMinor, cmd.idempotency_key);
        break;
      case "transfer":
        result = await gw.transfer(sql(), p.accountRef, p.amountMinor, cmd.idempotency_key);
        break;
    }
  } catch (e) {
    return onError(cmd, e);
  }
  // Primero se guarda la respuesta de la pasarela: si lo que sigue falla, el reintento no pierde el dato.
  await sql()`update payment_commands set result = ${sql().json(result as never)}, updated_at = now() where id = ${cmd.id}`;
  try {
    await systemTx(async (tx) => {
      const [locked] = await tx<{ status: string }[]>`select status from payment_commands where id = ${cmd.id} for update`;
      if (locked.status === "succeeded") return; // otro procesador ya lo aplicó
      switch (cmd.kind) {
        case "create_checkout":
          await finalizeCheckoutTx(tx, cmd.charge_id!, String(result.checkoutUrl));
          break;
        case "refund":
          await finalizeRefundTx(tx, cmd.refund_id!, String(result.refundId));
          break;
        case "orphan_refund":
          await finalizeOrphanRefundTx(tx, cmd, String(result.refundId));
          break;
        case "transfer":
          await finalizeTransferTx(tx, cmd.payout_id!, result as { transferId: string; status: "processing" | "paid" | "failed" });
          break;
      }
      await tx`update payment_commands set status = 'succeeded', lease_until = null, last_error = null, updated_at = now() where id = ${cmd.id}`;
    });
  } catch (e) {
    // La pasarela ya hizo la operación pero no se pudo registrar: se reintenta (la misma clave devuelve lo mismo).
    return onError(cmd, e, true);
  }
  return "succeeded";
}

async function onError(cmd: PaymentCommand, e: unknown, afterGateway = false): Promise<"retrying" | "dead"> {
  const message = (e instanceof Error ? e.message : "error").slice(0, 300);
  // Lo que no es un rechazo explícito de la pasarela se considera transitorio: no sabemos si se hizo, se reintenta.
  const retryable = afterGateway || !(e instanceof GatewayError) || e.retryable;
  if (retryable && cmd.attempts < MAX_ATTEMPTS) {
    await sql()`update payment_commands set status = 'retryable', lease_until = null, last_error = ${message},
      next_attempt_at = now() + make_interval(secs => ${backoffSeconds(cmd.attempts)}), updated_at = now() where id = ${cmd.id}`;
    return "retrying";
  }
  await systemTx(async (tx) => {
    const [locked] = await tx<{ status: string }[]>`select status from payment_commands where id = ${cmd.id} for update`;
    if (locked.status === "succeeded" || locked.status === "dead") return;
    await tx`update payment_commands set status = 'dead', lease_until = null, last_error = ${message}, updated_at = now() where id = ${cmd.id}`;
    // Compensación: el negocio vuelve a un estado coherente y operación queda avisada.
    if (cmd.kind === "create_checkout" && cmd.charge_id) await failCheckoutTx(tx, cmd.charge_id, message);
    if (cmd.kind === "refund" && cmd.refund_id) await failRefundTx(tx, cmd.refund_id, message);
    if (cmd.kind === "transfer" && cmd.payout_id) await failTransferTx(tx, cmd.payout_id, message);
    await tx`insert into payment_incidents (kind, severity, charge_id, command_id, detail)
      values ('command_dead', ${cmd.kind === "create_checkout" ? "warning" : "critical"}, ${cmd.charge_id}, ${cmd.id},
        ${tx.json({ kind: cmd.kind, error: message, attempts: cmd.attempts } as never)})
      on conflict do nothing`;
  });
  return "dead";
}

/**
 * Reintento manual de un reembolso muerto (operación, desde Finanzas). Conserva la clave idempotente: si la pasarela
 * llegó a hacerlo, devuelve el mismo reembolso en vez de repetirlo. Los cobros muertos no se reviven: el cliente
 * reintenta el pago (cobro nuevo) y las transferencias se reprograman desde la liquidación.
 */
export async function replayPaymentCommandTx(tx: Tx, commandId: string): Promise<boolean> {
  const [c] = await tx<{ status: string; kind: PaymentCommandKind; refund_id: string | null }[]>`
    select status, kind, refund_id from payment_commands where id = ${commandId} for update`;
  if (!c || c.status !== "dead" || !["refund", "orphan_refund"].includes(c.kind)) return false;
  if (c.kind === "refund" && c.refund_id) await tx`update refunds set status = 'pending', processed_at = null where id = ${c.refund_id} and status = 'failed'`;
  await tx`update payment_commands set status = 'retryable', attempts = 0, next_attempt_at = now(), updated_at = now() where id = ${commandId}`;
  await tx`update payment_incidents set status = 'resolved', resolved_at = now(), resolution = 'Reintentado' where command_id = ${commandId} and status = 'open'`;
  return true;
}
