/**
 * Cobros, confirmación por webhooks, reembolsos, liquidaciones y registro financiero.
 * Reglas clave (docs/payments.md):
 *  - Los importes se calculan en el servidor y se validan contra la pasarela (monto, moneda, referencia).
 *  - Un cobro solo se aprueba por un evento autenticado + consulta verificada a la pasarela,
 *    nunca por la página de retorno del navegador.
 *  - Webhooks idempotentes; eventos duplicados o fuera de orden se descartan sin efectos.
 *  - Los movimientos financieros no se borran ni se editan: se registran ajustes o reversos.
 *  - Ninguna llamada a la pasarela ocurre con una transacción abierta: se guarda un comando (enqueuePaymentCommand)
 *    y lo ejecuta el procesador de payment-commands.ts, que aplica el resultado con las funciones finalize… y fail….
 */
import { randomUUID } from "node:crypto";
import { assertContactVerified } from "./email-verification";
import type { Db, Tx } from "@/server/db/client";
import { sql, systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isPlatformAdmin } from "@/server/auth/actor";
import { audit, recordEvent } from "@/server/audit";
import { DomainError, forbidden, invalid, notFound } from "@/server/domain/errors";
import { splitRefund } from "@/server/domain/money";
import { CHARGE_RANK, assertTransition, payoutMachine, type ChargeStatus } from "@/server/domain/state-machines";
import { activeGateway, gatewayByName } from "@/server/payments";
import type { GatewayName, GatewayPayment, GatewayPaymentStatus } from "@/server/payments/gateway";
import type { PaymentCommand, PaymentCommandKind } from "./payment-commands";
import { clientRecipients, notify, providerRecipients, staffRecipients } from "@/server/notifications";
import { formatMoney } from "@/lib/format";

type LedgerLine = {
  account: "gateway_clearing" | "client_payments" | "platform_revenue" | "provider_payable" | "taxes_payable" | "refunds";
  amount: number;
  /** Profesional de la línea si difiere del del asiento (p. ej. traspaso por recomendación). */
  providerId?: string;
  entryType:
    | "charge" | "deposit" | "balance" | "extra" | "platform_fee" | "provider_payable"
    | "refund" | "chargeback" | "payout" | "adjustment" | "reversal";
};

/** Asienta una transacción balanceada (la base verifica que sume cero al confirmar). */
export async function postLedger(
  db: Db,
  lines: LedgerLine[],
  meta: {
    jobId: string | null;
    chargeId?: string | null;
    refundId?: string | null;
    payoutId?: string | null;
    providerId?: string | null;
    isTest: boolean;
    externalRef?: string | null;
    reason: string;
    actorId?: string | null;
  },
) {
  const nonZero = lines.filter((l) => l.amount !== 0);
  const sum = nonZero.reduce((s, l) => s + l.amount, 0);
  if (sum !== 0) throw new Error(`Asiento desbalanceado (${sum})`);
  const txnId = randomUUID();
  for (const l of nonZero) {
    await db`insert into ledger_entries (txn_id, job_id, charge_id, refund_id, payout_id, provider_id, entry_type, account,
        amount_minor, currency, is_test, external_ref, reason, actor_id)
      values (${txnId}, ${meta.jobId}, ${meta.chargeId ?? null}, ${meta.refundId ?? null}, ${meta.payoutId ?? null},
        ${l.providerId ?? meta.providerId ?? null}, ${l.entryType}, ${l.account}, ${l.amount}, 'ARS', ${meta.isTest},
        ${meta.externalRef ?? null}, ${meta.reason}, ${meta.actorId ?? null})`;
  }
  return txnId;
}

/** Guarda una operación con la pasarela para ejecutarla después del commit. Idempotente por clave. */
export async function enqueuePaymentCommand(
  tx: Tx,
  c: { kind: PaymentCommandKind; gateway: GatewayName; idempotencyKey: string; chargeId?: string | null; refundId?: string | null; payoutId?: string | null; payload: Record<string, unknown> },
): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    insert into payment_commands (kind, gateway, idempotency_key, charge_id, refund_id, payout_id, payload)
    values (${c.kind}, ${c.gateway}, ${c.idempotencyKey}, ${c.chargeId ?? null}, ${c.refundId ?? null}, ${c.payoutId ?? null}, ${tx.json(c.payload as never)})
    on conflict (idempotency_key) do update set updated_at = payment_commands.updated_at
    returning id`;
  return row.id;
}

/**
 * Ejecuta en el momento los comandos pendientes (después del commit de la acción), para que el resultado se vea sin
 * esperar al cron. Si la pasarela no responde, quedan en la cola y se reintentan solos.
 */
export async function drainPaymentCommands(opts: { chargeId?: string; ids?: string[] } = {}) {
  const { runPaymentCommands } = await import("./payment-commands");
  return runPaymentCommands({ ...opts, limit: 25 }).catch((e) => {
    console.error("[payments] procesador:", e instanceof Error ? e.message : "error");
    return { succeeded: 0, retrying: 0, dead: 0 };
  });
}

/** A dónde mandar al cliente para pagar un cobro: la ruta prepara el checkout (si falta) y redirige a la pasarela. */
export const payLink = (chargeId: string) => `/pagos/ir/${chargeId}`;

export type ChargeRow = {
  id: string;
  job_id: string;
  extra_id: string | null;
  kind: "visit" | "job_total" | "deposit" | "balance" | "extra";
  gateway: GatewayName;
  is_test: boolean;
  currency: string;
  amount_minor: number;
  client_fee_minor: number;
  tax_minor: number;
  provider_fee_minor: number;
  provider_net_minor: number;
  refunded_minor: number;
  status: ChargeStatus;
  external_reference: string;
  external_payment_id: string | null;
  checkout_url: string | null;
  payer_user_id: string;
  status_rank: number;
  gateway_fee_minor: number;
};

/**
 * Crea un cobro pendiente y encola la creación del checkout (sin llamar a la pasarela: se está dentro de la
 * transacción del caso de uso). Importes calculados por el servidor. Para pagar se usa payLink(charge.id).
 */
export async function createCharge(
  tx: Tx,
  input: {
    jobId: string;
    extraId?: string | null;
    kind: ChargeRow["kind"];
    amountMinor: number;
    clientFeeMinor: number;
    taxMinor: number;
    providerFeeMinor: number;
    providerNetMinor: number;
    payerUserId: string;
    description: string;
    payoutAccountRef: string | null;
  },
): Promise<ChargeRow> {
  await assertContactVerified(tx, input.payerUserId, "pagar");
  const gw = activeGateway();
  if (input.amountMinor !== input.providerNetMinor + input.providerFeeMinor + input.clientFeeMinor + input.taxMinor) {
    throw new Error("Desglose de cobro inconsistente");
  }
  const id = randomUUID();
  const externalReference = `FXY-${id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  const idempotencyKey = `charge:${input.jobId}:${input.kind}:${input.extraId ?? "-"}:${id}`;
  const [charge] = await tx<ChargeRow[]>`
    insert into charges (id, job_id, extra_id, kind, gateway, is_test, amount_minor, client_fee_minor, tax_minor,
      provider_fee_minor, provider_net_minor, external_reference, idempotency_key, payer_user_id)
    values (${id}, ${input.jobId}, ${input.extraId ?? null}, ${input.kind}, ${gw.name}, ${gw.isTest}, ${input.amountMinor},
      ${input.clientFeeMinor}, ${input.taxMinor}, ${input.providerFeeMinor}, ${input.providerNetMinor},
      ${externalReference}, ${idempotencyKey}, ${input.payerUserId})
    returning *`;
  await enqueuePaymentCommand(tx, {
    kind: "create_checkout",
    gateway: gw.name,
    idempotencyKey,
    chargeId: id,
    payload: {
      externalReference,
      amountMinor: input.amountMinor,
      description: input.description,
      payoutAccountRef: input.payoutAccountRef,
      marketplaceFeeMinor: input.clientFeeMinor + input.taxMinor + input.providerFeeMinor,
    },
  });
  await recordEvent(tx, { entityType: "charge", entityId: id, action: "created", to: "pending", data: { kind: input.kind } });
  return charge;
}

/** El procesador creó el checkout: se guarda el link (solo la primera vez y si el cobro sigue pendiente). */
export async function finalizeCheckoutTx(tx: Tx, chargeId: string, checkoutUrl: string) {
  await tx`update charges set checkout_url = ${checkoutUrl} where id = ${chargeId} and checkout_url is null`;
}

/** La pasarela rechazó crear el checkout: el cobro queda fallido y el cliente puede reintentar. */
export async function failCheckoutTx(tx: Tx, chargeId: string, error: string) {
  const [c] = await tx<ChargeRow[]>`select * from charges where id = ${chargeId} for update`;
  if (!c || c.status !== "pending") return;
  await tx`update charges set status = 'failed', status_rank = ${CHARGE_RANK.failed}, failure_reason = 'No se pudo iniciar el pago' where id = ${chargeId}`;
  await recordEvent(tx, { entityType: "charge", entityId: chargeId, action: "checkout_failed", from: "pending", to: "failed", data: { error: error.slice(0, 200) } });
  await onChargeFailed(tx, c);
}

/** El cliente reintenta un cobro fallido: se crea un nuevo cobro con los mismos importes contratados. */
export async function retryCharge(actor: Actor, chargeId: string) {
  return systemTx(async (tx) => {
    const [c] = await tx<ChargeRow[]>`select * from charges where id = ${chargeId} for update`;
    if (!c) throw notFound();
    const [{ ok }] = await tx<{ ok: boolean }[]>`select app.is_job_client(${actor.id}, ${c.job_id}) as ok`;
    if (!ok) throw forbidden();
    if (c.status !== "failed") throw invalid("Solo se puede reintentar un pago fallido.");
    const [acct] = await tx<{ payout_account_ref: string | null }[]>`
      select p.payout_account_ref from jobs j join providers p on p.id = j.provider_id where j.id = ${c.job_id}`;
    const n = await createCharge(tx, {
      jobId: c.job_id,
      extraId: c.extra_id,
      kind: c.kind,
      amountMinor: c.amount_minor,
      clientFeeMinor: c.client_fee_minor,
      taxMinor: c.tax_minor,
      providerFeeMinor: c.provider_fee_minor,
      providerNetMinor: c.provider_net_minor,
      payerUserId: actor.id,
      description: "Reintento de pago",
      payoutAccountRef: acct?.payout_account_ref ?? null,
    });
    return n;
  });
}

function mapGatewayStatus(s: GatewayPaymentStatus): ChargeStatus {
  switch (s) {
    case "approved":
      return "approved";
    case "rejected":
      return "failed";
    case "refunded":
      return "refunded";
    case "partially_refunded":
      return "partially_refunded";
    default:
      return "pending";
  }
}

export type WebhookResult = "applied" | "ignored_duplicate" | "ignored_stale" | "rejected" | "error";

/**
 * Procesa una notificación de la pasarela de forma idempotente.
 * 1) verifica firma; 2) registra el evento (único por id externo); 3) consulta el pago a la pasarela;
 * 4) valida referencia, monto y moneda; 5) aplica la transición si avanza el estado.
 */
export async function processPaymentWebhook(gatewayName: GatewayName, rawBody: string, headers: Headers): Promise<WebhookResult> {
  const gw = gatewayByName(gatewayName);
  const signatureValid = gw.verifyWebhook(rawBody, headers);
  let payload: { id?: string; type?: string; action?: string; data?: { id?: string } } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return "rejected";
  }
  // Mercado Pago también avisa otros temas (órdenes, reclamos…): solo procesamos pagos.
  if (gatewayName === "mercadopago" && payload.type && payload.type !== "payment") return "ignored_stale";
  const eventId = String(payload.id ?? headers.get("x-request-id") ?? "");
  const paymentId = payload.data?.id ? String(payload.data.id) : null;
  if (!eventId) return "rejected";

  // Sin firma válida no se guarda nada: un evento falso no puede "ocupar" el id del aviso real.
  if (!signatureValid) {
    console.warn(`[payments] webhook ${gatewayName} con firma inválida descartado`);
    return "rejected";
  }
  // 1) Registro del evento (único por id externo), en una transacción propia y breve.
  const ev = await systemTx(async (tx) => {
    const inserted = await tx<{ id: string; is_new: boolean }[]>`
      insert into payment_events (gateway, external_event_id, event_type, external_payment_id, signature_valid, payload, attempts)
      values (${gatewayName}, ${eventId}, ${payload.action ?? payload.type ?? "unknown"}, ${paymentId}, ${signatureValid},
              ${tx.json(payload as never)}, 1)
      on conflict (gateway, external_event_id) do update set attempts = payment_events.attempts + 1
      returning id, (xmax = 0) as is_new`;
    const row = inserted[0];
    if (!row.is_new) {
      const [prev] = await tx<{ result: string | null }[]>`select result from payment_events where id = ${row.id}`;
      if (prev.result && prev.result !== "error") return { id: row.id, duplicate: true };
    }
    return { id: row.id, duplicate: false };
  });
  if (ev.duplicate) return "ignored_duplicate";
  const finish = async (db: Db, result: WebhookResult, error?: string) => {
    await db`update payment_events set processed_at = now(), result = ${result}, error = ${error ?? null} where id = ${ev.id}`;
    return result;
  };
  if (!paymentId) return finish(sql(), "rejected", "sin id de pago");
  // 2) Consulta a la pasarela, sin transacción abierta. Si no responde, la pasarela reintenta el aviso.
  let payment: GatewayPayment | null;
  try {
    payment = await gw.getPayment(sql(), paymentId);
  } catch (e) {
    return finish(sql(), "error", (e instanceof Error ? e.message : "error").slice(0, 300));
  }
  // 3) Aplicación del estado, en una transacción breve.
  const res = await systemTx(async (tx) => {
    const r = await applyGatewayPayment(tx, gatewayName, payment);
    await finish(tx, r.result, r.error);
    return r;
  });
  await drainPaymentCommands({ chargeId: res.chargeId });
  return res.result;
}

/** Consulta un pago a la pasarela y aplica su estado (vuelta del navegador, resincronización manual). */
export async function syncPayment(gatewayName: GatewayName, paymentId: string) {
  const payment = await gatewayByName(gatewayName).getPayment(sql(), paymentId);
  const res = await systemTx((tx) => applyGatewayPayment(tx, gatewayName, payment));
  await drainPaymentCommands({ chargeId: res.chargeId });
  return res;
}

/**
 * Aplica el estado verificado de un pago de la pasarela. Idempotente: lo usan webhooks, la vuelta del navegador y la
 * conciliación. No llama a la pasarela (el pago ya viene consultado).
 */
export async function applyGatewayPayment(
  tx: Tx,
  gatewayName: GatewayName,
  payment: GatewayPayment | null,
): Promise<{ result: WebhookResult; error?: string; chargeId?: string }> {
  if (!payment) return { result: "rejected", error: "pago inexistente en la pasarela" };
  const [charge] = await tx<ChargeRow[]>`
    select * from charges where external_reference = ${payment.externalReference} and gateway = ${gatewayName} for update`;
  if (!charge) return { result: "rejected", error: "referencia desconocida" };
  if (payment.amountMinor !== charge.amount_minor || payment.currency !== charge.currency) {
    await audit(tx, null, "payment.mismatch", "charge", charge.id, "Monto o moneda no coinciden con la pasarela", {
      gatewayAmount: payment.amountMinor,
      chargeAmount: charge.amount_minor,
    });
    return { result: "rejected", error: "monto o moneda no coinciden", chargeId: charge.id };
  }
  const target = mapGatewayStatus(payment.status);
  const otherPayment = !!charge.external_payment_id && charge.external_payment_id !== payment.id;
  if (target === "approved" && (otherPayment || charge.status === "failed")) {
    await refundOrphanPayment(tx, gatewayName, charge, payment);
    return { result: "rejected", error: "pago sin cobro pendiente: devuelto", chargeId: charge.id };
  }
  if (otherPayment) return { result: "rejected", error: "id de pago distinto al registrado", chargeId: charge.id };
  // Sobre un cobro ya aprobado: devoluciones hechas en la pasarela, mediaciones y contracargos.
  if (["approved", "partially_refunded"].includes(charge.status) && ["refunded", "partially_refunded", "in_mediation", "charged_back"].includes(payment.status)) {
    return applyGatewaySideChange(tx, charge, payment);
  }
  if (target === "refunded" || target === "partially_refunded") return { result: "ignored_stale", chargeId: charge.id };
  if (CHARGE_RANK[target] <= charge.status_rank || charge.status === target) {
    return { result: "ignored_stale", chargeId: charge.id };
  }
  if (charge.status === "failed" || charge.status === "approved") return { result: "ignored_stale", chargeId: charge.id };

  const gatewayFee = target === "approved" ? Math.min(payment.feesMinor ?? 0, charge.provider_net_minor) : 0;
  await tx`update charges set status = ${target}, status_rank = ${CHARGE_RANK[target]}, external_payment_id = ${payment.id},
    gateway_fee_minor = ${gatewayFee},
    approved_at = ${target === "approved" ? new Date() : null},
    failure_reason = ${target === "failed" ? "Pago rechazado por la pasarela" : null}
    where id = ${charge.id}`;
  await recordEvent(tx, { entityType: "charge", entityId: charge.id, action: "gateway_update", from: charge.status, to: target });
  if (target === "approved") await onChargeApproved(tx, { ...charge, status: "approved", external_payment_id: payment.id, gateway_fee_minor: gatewayFee });
  if (target === "failed") await onChargeFailed(tx, charge);
  return { result: "applied", chargeId: charge.id };
}

async function onChargeApproved(tx: Tx, c: ChargeRow) {
  const [job] = await tx<{ id: string; code: string; request_id: string; provider_id: string; assigned_user_id: string | null }[]>`
    select id, code, request_id, provider_id, assigned_user_id from jobs where id = ${c.job_id}`;
  const entryType = c.kind === "extra" ? "extra" : c.kind === "deposit" ? "deposit" : c.kind === "balance" ? "balance" : "charge";
  await postLedger(
    tx,
    [
      { account: "gateway_clearing", amount: c.amount_minor, entryType },
      { account: "platform_revenue", amount: -(c.client_fee_minor + c.provider_fee_minor), entryType: "platform_fee" },
      { account: "taxes_payable", amount: -c.tax_minor, entryType: "platform_fee" },
      { account: "provider_payable", amount: -c.provider_net_minor, entryType: "provider_payable" },
    ],
    {
      jobId: c.job_id,
      chargeId: c.id,
      providerId: job.provider_id,
      isTest: c.is_test,
      externalRef: c.external_payment_id,
      reason: `Cobro aprobado (${c.kind})`,
    },
  );
  // Costos de cobro de la pasarela (comisión + impuestos): a cargo del profesional; Fixy no los recibe.
  if (c.gateway_fee_minor > 0) {
    await postLedger(
      tx,
      [
        { account: "provider_payable", amount: c.gateway_fee_minor, entryType: "adjustment" },
        { account: "gateway_clearing", amount: -c.gateway_fee_minor, entryType: "adjustment" },
      ],
      { jobId: c.job_id, chargeId: c.id, providerId: job.provider_id, isTest: c.is_test, externalRef: c.external_payment_id, reason: "Costos de cobro de la pasarela e impuestos" },
    );
  }
  if (c.kind === "extra" && c.extra_id) {
    await recordEvent(tx, { entityType: "job", entityId: c.job_id, action: "extra_paid", data: { extraId: c.extra_id } });
  } else {
    await recordEvent(tx, { entityType: "job", entityId: c.job_id, action: "payment_approved", data: { chargeId: c.id } });
    // Reserva directa: el profesional ya aceptó la visita; con el pago queda confirmada.
    const auto = await tx<{ id: string }[]>`
      update jobs j set status = 'confirmed', confirmed_at = now()
      from service_requests r where r.id = j.request_id and r.request_mode = 'direct' and j.id = ${c.job_id} and j.status = 'pending_confirmation'
      returning j.id`;
    if (auto.length) await recordEvent(tx, { entityType: "job", entityId: c.job_id, action: "status", from: "pending_confirmation", to: "confirmed", actorRole: "system", reason: "Visita pagada; el profesional ya había aceptado" });
  }
  const amount = formatMoney(c.amount_minor);
  await notify(tx, await clientRecipients(tx, job.request_id), {
    type: "payment",
    title: `Pago acreditado${c.is_test ? " (modo de prueba)" : ""} · ${job.code}`,
    body: `Registramos el pago de ${amount}. Un pago aprobado no implica que el trabajo esté terminado.`,
    link: `/app/trabajos/${job.id}`,
  });
  await notify(tx, await providerRecipients(tx, job.provider_id), {
    type: "payment",
    title: `Pago del cliente registrado · ${job.code}`,
    body: c.kind === "extra" ? "El adicional fue pagado." : "Ya podés confirmar el trabajo.",
    link: `/proveedor/trabajos/${job.id}`,
  });
}

async function onChargeFailed(tx: Tx, c: ChargeRow) {
  const [job] = await tx<{ id: string; code: string; request_id: string }[]>`select id, code, request_id from jobs where id = ${c.job_id}`;
  await notify(tx, await clientRecipients(tx, job.request_id), {
    type: "payment",
    title: `El pago no se pudo completar · ${job.code}`,
    body: "Podés reintentarlo desde el detalle del trabajo.",
    link: `/app/trabajos/${job.id}`,
  });
}

// ───────────────────────── Reembolsos ─────────────────────────

export async function refundCharge(
  actor: Actor,
  input: { chargeId: string; amountMinor: number; reason: string; disputeId?: string | null; idempotencyKey?: string },
) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  if (!input.reason || input.reason.trim().length < 5) throw invalid("Indicá el motivo del reembolso.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw invalid("Importe inválido.");
  const refundId = await systemTx(async (tx) => refundChargeTx(tx, actor, input));
  await drainPaymentCommands({ chargeId: input.chargeId });
  return refundId;
}

/** Suma de reembolsos de Fixy pedidos a la pasarela que todavía no se confirmaron. */
async function pendingRefundsMinor(tx: Tx, chargeId: string) {
  const [{ n }] = await tx<{ n: number }[]>`select coalesce(sum(amount_minor), 0)::bigint as n from refunds where charge_id = ${chargeId} and status = 'pending'`;
  return Number(n);
}

/**
 * Reembolso iniciado por Fixy. Dentro de la transacción del caso de uso solo se registra el pedido (pendiente) y se
 * encola la devolución; el cobro, el registro financiero y las liquidaciones se actualizan cuando la pasarela la
 * confirma (finalizeRefundTx). Los pendientes cuentan para no devolver más de lo cobrado.
 * Quien llama debe ejecutar drainPaymentCommands() después del commit para verlo aplicado en el momento.
 */
export async function refundChargeTx(
  tx: Tx,
  actor: Actor,
  input: { chargeId: string; amountMinor: number; reason: string; disputeId?: string | null; idempotencyKey?: string },
) {
  const [c] = await tx<ChargeRow[]>`select * from charges where id = ${input.chargeId} for update`;
  if (!c) throw notFound("Cobro inexistente.");
  if (!["approved", "partially_refunded"].includes(c.status)) throw invalid("Solo se pueden reembolsar cobros aprobados.");
  const pending = await pendingRefundsMinor(tx, c.id);
  const remaining = c.amount_minor - c.refunded_minor - pending;
  if (input.amountMinor > remaining) throw invalid(`El máximo reembolsable es ${formatMoney(Math.max(0, remaining))}.`);
  if (!c.external_payment_id) throw new DomainError("payment_error", "El cobro no tiene un pago asociado en la pasarela.");

  const idem = input.idempotencyKey ?? `refund:${c.id}:${c.refunded_minor + pending}:${input.amountMinor}`;
  const [existing] = await tx<{ id: string }[]>`select id from refunds where idempotency_key = ${idem}`;
  if (existing) return existing.id;

  const [refund] = await tx<{ id: string }[]>`
    insert into refunds (charge_id, amount_minor, status, reason, dispute_id, idempotency_key, requested_by, source)
    values (${c.id}, ${input.amountMinor}, 'pending', ${input.reason}, ${input.disputeId ?? null}, ${idem}, ${actor.id}, 'platform')
    returning id`;
  await enqueuePaymentCommand(tx, {
    kind: "refund", gateway: c.gateway, idempotencyKey: idem, chargeId: c.id, refundId: refund.id,
    payload: { paymentId: c.external_payment_id, amountMinor: input.amountMinor },
  });
  await recordEvent(tx, { entityType: "charge", entityId: c.id, action: "refund_requested", actorId: actor.id, actorRole: actor.platformRole, reason: input.reason, data: { amountMinor: input.amountMinor, refundId: refund.id } });
  await audit(tx, actor, "charge.refund_requested", "charge", c.id, input.reason, { amountMinor: input.amountMinor, refundId: refund.id });
  return refund.id;
}

/** La pasarela confirmó la devolución: ahora sí se aplica al cobro, al registro financiero y a las liquidaciones. */
export async function finalizeRefundTx(tx: Tx, refundId: string, externalRefundId: string) {
  const [r] = await tx<{ id: string; charge_id: string; amount_minor: number; status: string; reason: string; dispute_id: string | null; idempotency_key: string; requested_by: string | null }[]>`
    select id, charge_id, amount_minor, status, reason, dispute_id, idempotency_key, requested_by from refunds where id = ${refundId} for update`;
  if (!r || r.status !== "pending") return;
  const [c] = await tx<ChargeRow[]>`select * from charges where id = ${r.charge_id} for update`;
  await tx`update refunds set status = 'approved', external_refund_id = ${externalRefundId}, processed_at = now() where id = ${r.id}`;
  const actor = r.requested_by ? await loadActorFor(tx, r.requested_by) : null;
  await applyRefundEffects(tx, c, { refundId: r.id, amountMinor: Number(r.amount_minor), reason: r.reason, actor, source: "platform", externalRefundId });
}

/** La pasarela rechazó la devolución (o no respondió tras todos los reintentos): queda fallida y operación avisada. */
export async function failRefundTx(tx: Tx, refundId: string, error: string) {
  const [r] = await tx<{ id: string; charge_id: string; amount_minor: number; status: string }[]>`
    select id, charge_id, amount_minor, status from refunds where id = ${refundId} for update`;
  if (!r || r.status !== "pending") return;
  await tx`update refunds set status = 'failed', processed_at = now() where id = ${r.id}`;
  await recordEvent(tx, { entityType: "charge", entityId: r.charge_id, action: "refund_failed", data: { refundId: r.id, amountMinor: r.amount_minor, error: error.slice(0, 200) } });
  await audit(tx, null, "charge.refund_failed", "charge", r.charge_id, error.slice(0, 300), { refundId: r.id, amountMinor: r.amount_minor });
  const [job] = await tx<{ id: string; code: string }[]>`select j.id, j.code from jobs j join charges c on c.job_id = j.id where c.id = ${r.charge_id}`;
  await notify(tx, await staffRecipients(tx), {
    type: "payment", title: `No se pudo hacer un reembolso · ${job?.code ?? ""}`,
    body: `La pasarela no procesó la devolución de ${formatMoney(Number(r.amount_minor))}. Revisalo en Finanzas → Conciliación.`, link: "/admin/finanzas?tab=conciliacion",
  });
}

async function loadActorFor(tx: Tx, userId: string): Promise<Actor | null> {
  const { loadActor } = await import("@/server/auth/actor");
  return loadActor(tx, userId);
}

/** Reembolso hecho desde la pasarela o por contracargo: ya ocurrió afuera, se registra directo. */
async function applyRefundTx(
  tx: Tx,
  c: ChargeRow,
  r: { amountMinor: number; reason: string; disputeId: string | null; idem: string; actor: Actor | null; source: "gateway" | "chargeback"; externalRefundId?: string | null },
) {
  const [refund] = await tx<{ id: string }[]>`
    insert into refunds (charge_id, amount_minor, status, reason, dispute_id, external_refund_id, idempotency_key, requested_by, processed_at, source)
    values (${c.id}, ${r.amountMinor}, 'approved', ${r.reason}, ${r.disputeId}, ${r.externalRefundId ?? null}, ${r.idem}, ${r.actor?.id ?? null}, now(), ${r.source})
    returning id`;
  await applyRefundEffects(tx, c, { refundId: refund.id, amountMinor: r.amountMinor, reason: r.reason, actor: r.actor, source: r.source, externalRefundId: r.externalRefundId ?? r.idem });
  return refund.id;
}

/**
 * Efectos de un reembolso ya ocurrido en la pasarela: cobro, registro financiero, liquidaciones del trabajo (y
 * recuperos si el profesional ya cobró) y aviso al cliente. No llama a la pasarela.
 */
async function applyRefundEffects(
  tx: Tx,
  c: ChargeRow,
  r: { refundId: string; amountMinor: number; reason: string; actor: Actor | null; source: "platform" | "gateway" | "chargeback"; externalRefundId: string | null },
) {
  const refund = { id: r.refundId };
  const refunded = c.refunded_minor + r.amountMinor;
  const newStatus: ChargeStatus = refunded === c.amount_minor ? "refunded" : "partially_refunded";
  await tx`update charges set refunded_minor = ${refunded}, status = ${newStatus}, status_rank = ${CHARGE_RANK[newStatus]} where id = ${c.id}`;

  const { providerPartMinor, platformPartMinor } = splitRefund(r.amountMinor, c.amount_minor, c.provider_net_minor);
  const [job] = await tx<{ provider_id: string; request_id: string; code: string }[]>`select provider_id, request_id, code from jobs where id = ${c.job_id}`;
  await postLedger(
    tx,
    [
      { account: "gateway_clearing", amount: -r.amountMinor, entryType: r.source === "chargeback" ? "chargeback" : "refund" },
      { account: "provider_payable", amount: providerPartMinor, entryType: r.source === "chargeback" ? "chargeback" : "refund" },
      { account: "platform_revenue", amount: platformPartMinor, entryType: r.source === "chargeback" ? "chargeback" : "refund" },
    ],
    { jobId: c.job_id, chargeId: c.id, refundId: refund.id, providerId: job.provider_id, isTest: c.is_test, externalRef: r.externalRefundId, reason: `Reembolso: ${r.reason}`, actorId: r.actor?.id ?? null },
  );
  await rebalanceJobPayouts(tx, c.job_id, r.actor, r.reason);

  await recordEvent(tx, { entityType: "charge", entityId: c.id, action: r.source === "chargeback" ? "chargeback" : "refund", from: c.status, to: newStatus, actorId: r.actor?.id ?? null, actorRole: r.actor?.platformRole ?? null, reason: r.reason, data: { amountMinor: r.amountMinor, source: r.source } });
  await audit(tx, r.actor, r.source === "chargeback" ? "charge.chargeback" : "charge.refund", "charge", c.id, r.reason, { amountMinor: r.amountMinor, refundId: refund.id, source: r.source });
  await notify(tx, await clientRecipients(tx, job.request_id), {
    type: "payment",
    title: `Reembolso registrado · ${job.code}`,
    body: `Se registró un reembolso de ${formatMoney(r.amountMinor)}${c.is_test ? " (modo de prueba)" : ""}.`,
    link: `/app/trabajos/${c.job_id}`,
  });
}

type PayoutRow = {
  id: string; provider_id: string; kind: "job" | "referral"; status: string; is_test: boolean;
  gross_minor: number; fee_minor: number; adjustments_minor: number; amount_minor: number; processing_minor: number; referral_minor: number;
};

/**
 * Recalcula las liquidaciones de un trabajo después de un reembolso o contracargo:
 *  - neto del profesional = sus importes − reintegros − costos de cobro − parte del colega (10 % del neto, si recomendó);
 *  - si la liquidación todavía no se pagó, se ajusta (nunca por debajo de cero);
 *  - lo que el profesional (o el colega) ya cobró de más queda como recupero y se descuenta de su próximo retiro.
 */
export async function rebalanceJobPayouts(tx: Tx, jobId: string, actor: Actor | null, reason: string) {
  const [jp] = await tx<PayoutRow[]>`select * from payouts where job_id = ${jobId} and kind = 'job' for update`;
  if (!jp) return; // todavía no hay liquidación: se calcula completa al terminar el trabajo
  const [rp] = await tx<PayoutRow[]>`select * from payouts where job_id = ${jobId} and kind = 'referral' for update`;
  const charges = await tx<ChargeRow[]>`select * from charges where job_id = ${jobId} and status in ('approved','partially_refunded','refunded')`;
  const refundsPart = charges.reduce((s, c) => s + (c.refunded_minor > 0 ? splitRefund(c.refunded_minor, c.amount_minor, c.provider_net_minor).providerPartMinor : 0), 0);
  const base = Math.max(0, jp.gross_minor - jp.fee_minor - refundsPart - jp.processing_minor);
  let newReferral = 0;
  if (rp) {
    const [ref] = await tx<{ fee_bps: number }[]>`
      select pr.fee_bps from jobs j join request_invitations i on i.request_id = j.request_id and i.provider_id = j.provider_id
      join provider_referrals pr on pr.id = i.referral_id where j.id = ${jobId} and pr.status = 'accepted' limit 1`;
    newReferral = ref ? Math.floor((base * ref.fee_bps) / 10000) : rp.gross_minor;
  }
  await settlePayout(tx, jobId, jp, jp.gross_minor - jp.fee_minor - refundsPart - jp.processing_minor - newReferral, actor, reason);
  if (rp) {
    await settlePayout(tx, jobId, rp, newReferral, actor, reason);
    const delta = jp.referral_minor - newReferral;
    if (delta !== 0) {
      await tx`update payouts set referral_minor = ${newReferral} where id = ${jp.id}`;
      // Se devuelve al profesional la parte de la recomendación que corresponde a lo reembolsado.
      await postLedger(
        tx,
        [
          { account: "provider_payable", amount: -delta, entryType: "adjustment", providerId: jp.provider_id },
          { account: "provider_payable", amount: delta, entryType: "adjustment", providerId: rp.provider_id },
        ],
        { jobId, payoutId: rp.id, isTest: jp.is_test, reason: "Recomendación recalculada por reembolso", actorId: actor?.id ?? null },
      );
    }
  }
}

async function settlePayout(tx: Tx, jobId: string, p: PayoutRow, target: number, actor: Actor | null, reason: string) {
  const adjustable = ["pending", "scheduled", "failed"].includes(p.status);
  let kept = p.amount_minor;
  if (adjustable) {
    kept = Math.max(0, target);
    if (kept !== p.amount_minor) {
      await tx`update payouts set adjustments_minor = ${kept - (p.gross_minor - p.fee_minor)}, amount_minor = ${kept} where id = ${p.id}`;
      await recordEvent(tx, { entityType: "payout", entityId: p.id, action: "adjusted_by_refund", actorId: actor?.id ?? null, reason, data: { from: p.amount_minor, to: kept } });
    }
  }
  const debt = Math.max(0, kept - target);
  const [{ owed }] = await tx<{ owed: number }[]>`
    select coalesce(sum(amount_minor), 0)::bigint as owed from provider_recoveries
    where job_id = ${jobId} and provider_id = ${p.provider_id} and payout_kind = ${p.kind} and status <> 'waived'`;
  const missing = debt - Number(owed);
  if (missing > 0) {
    const [rec] = await tx<{ id: string }[]>`
      insert into provider_recoveries (provider_id, job_id, payout_kind, amount_minor, reason, is_test, created_by)
      values (${p.provider_id}, ${jobId}, ${p.kind}, ${missing}, ${`Reembolso posterior al cobro: ${reason}`.slice(0, 500)}, ${p.is_test}, ${actor?.id ?? null})
      returning id`;
    await audit(tx, actor, "payout.recovery_created", "payout", p.id, "Se descuenta del próximo retiro", { recoveryId: rec.id, amountMinor: missing });
    await notify(tx, await providerRecipients(tx, p.provider_id), {
      type: "payout",
      title: `Se descontarán ${formatMoney(missing)} de tu próximo retiro`,
      body: "Hubo un reembolso al cliente en un trabajo que ya habías cobrado. El importe se descuenta de tus próximos cobros.",
      link: "/proveedor/cobros",
    });
  }
}

/** Retiene o libera las liquidaciones de un trabajo (contracargo o mediación en la pasarela). */
async function holdJobPayouts(tx: Tx, jobId: string, hold: boolean, reason: string) {
  await tx`update payouts set on_hold = ${hold}, hold_reason = ${hold ? reason : null}
    where job_id = ${jobId} and status in ('pending','scheduled','failed') and on_hold <> ${hold}`;
}

/** Cambios que llegan de la pasarela sobre un pago ya aprobado: devoluciones hechas allá, mediaciones y contracargos. */
async function applyGatewaySideChange(tx: Tx, charge: ChargeRow, payment: GatewayPayment): Promise<{ result: WebhookResult; error?: string; chargeId?: string }> {
  const [job] = await tx<{ code: string }[]>`select code from jobs where id = ${charge.job_id}`;
  const staffAlert = async (title: string, body: string) => notify(tx, await staffRecipients(tx), { type: "payment", title, body, link: `/admin/trabajos/${charge.job_id}` });
  if (payment.status === "in_mediation") {
    await holdJobPayouts(tx, charge.job_id, true, "Reclamo del cliente en Mercado Pago");
    await audit(tx, null, "charge.mediation", "charge", charge.id, "El cliente abrió un reclamo en la pasarela", { paymentId: payment.id });
    await staffAlert(`Reclamo en Mercado Pago · ${job?.code ?? ""}`, "El cliente abrió un reclamo o contracargo. Retuvimos la liquidación del profesional; respondelo desde Mercado Pago.");
    return { result: "applied", chargeId: charge.id };
  }
  const remaining = charge.amount_minor - charge.refunded_minor;
  if (payment.status === "charged_back") {
    if (remaining <= 0) return { result: "ignored_stale", chargeId: charge.id };
    await holdJobPayouts(tx, charge.job_id, true, "Contracargo en Mercado Pago");
    await applyRefundTx(tx, charge, { amountMinor: remaining, reason: "Contracargo del cliente en el medio de pago", disputeId: null, idem: `chargeback:${payment.id}`, actor: null, source: "chargeback" });
    await staffAlert(`Contracargo · ${job?.code ?? ""}`, `Se descontaron ${formatMoney(remaining)} por un contracargo. Revisá la liquidación del profesional.`);
    return { result: "applied", chargeId: charge.id };
  }
  // Devolución hecha desde el panel de la pasarela. Las de Fixy ya registradas o todavía pendientes de confirmar no
  // generan diferencia (el aviso de la pasarela puede llegar antes de que el procesador registre la nuestra).
  const pending = await pendingRefundsMinor(tx, charge.id);
  const extra = Math.min(remaining - pending, payment.refundedMinor - charge.refunded_minor - pending);
  if ((payment.status === "refunded" || payment.status === "partially_refunded") && extra > 0) {
    await applyRefundTx(tx, charge, { amountMinor: extra, reason: "Devolución hecha desde Mercado Pago", disputeId: null, idem: `gateway-refund:${payment.id}:${payment.refundedMinor}`, actor: null, source: "gateway" });
    await staffAlert(`Devolución hecha en Mercado Pago · ${job?.code ?? ""}`, `Registramos una devolución de ${formatMoney(extra)} hecha desde la pasarela.`);
    return { result: "applied", chargeId: charge.id };
  }
  return { result: "ignored_stale", chargeId: charge.id };
}

/**
 * Pago aprobado que ya no tiene a qué aplicarse (pagó dos veces, pagó un link viejo, reintentó con otra tarjeta
 * después de un rechazo, o el trabajo se canceló): se devuelve completo y queda registrado.
 */
async function refundOrphanPayment(tx: Tx, gatewayName: GatewayName, charge: ChargeRow, payment: GatewayPayment) {
  const [done] = await tx<{ id: string }[]>`select id from payment_commands where idempotency_key = ${`orphan:${payment.id}`}`;
  if (done) return;
  await enqueuePaymentCommand(tx, {
    kind: "orphan_refund", gateway: gatewayName, idempotencyKey: `orphan:${payment.id}`, chargeId: charge.id,
    payload: { paymentId: payment.id, amountMinor: payment.amountMinor },
  });
  await audit(tx, null, "payment.orphan_detected", "charge", charge.id, "Pago aprobado sin cobro pendiente: se devuelve completo", {
    paymentId: payment.id, amountMinor: payment.amountMinor, chargeStatus: charge.status,
  });
}

/** La pasarela devolvió el pago huérfano: queda registrado y se avisa al cliente. */
export async function finalizeOrphanRefundTx(tx: Tx, cmd: PaymentCommand, externalRefundId: string) {
  const p = cmd.payload as { paymentId: string; amountMinor: number };
  const [charge] = await tx<ChargeRow[]>`select * from charges where id = ${cmd.charge_id}`;
  await audit(tx, null, "payment.orphan_refunded", "charge", charge.id, "Pago aprobado sin cobro pendiente: devuelto completo", {
    paymentId: p.paymentId, amountMinor: p.amountMinor, chargeStatus: charge.status, refundId: externalRefundId,
  });
  const [job] = await tx<{ request_id: string; code: string }[]>`select request_id, code from jobs where id = ${charge.job_id}`;
  if (job) {
    await notify(tx, await clientRecipients(tx, job.request_id), {
      type: "payment",
      title: `Te devolvimos un pago · ${job.code}`,
      body: `Recibimos un pago de ${formatMoney(p.amountMinor)} que no correspondía a un cobro pendiente y lo devolvimos completo a tu medio de pago.${charge.is_test ? " (modo de prueba)" : ""}`,
      link: `/app/trabajos/${charge.job_id}`,
    });
  }
}

// ───────────────────────── Liquidaciones ─────────────────────────

/**
 * Al completarse un trabajo se genera la liquidación pendiente del profesional:
 *   bruto (sus importes) − comisión Fixy (0) − reintegros − costos de cobro de la pasarela − recomendación (si la hubo).
 * Si el trabajo vino por la recomendación de un colega, se genera además la liquidación de ese colega (10 % del neto)
 * y se asienta el traspaso entre ambos en el registro financiero.
 */
export async function createPayoutForJob(tx: Tx, jobId: string) {
  const [job] = await tx<{ provider_id: string; request_id: string; code: string }[]>`select provider_id, request_id, code from jobs where id = ${jobId}`;
  const charges = await tx<ChargeRow[]>`select * from charges where job_id = ${jobId} and status in ('approved','partially_refunded','refunded')`;
  if (charges.length === 0) return null;
  let gross = 0;
  let fee = 0;
  let refundsPart = 0;
  let processing = 0;
  for (const c of charges) {
    gross += c.provider_net_minor + c.provider_fee_minor;
    fee += c.provider_fee_minor;
    processing += c.gateway_fee_minor ?? 0;
    if (c.refunded_minor > 0) refundsPart += splitRefund(c.refunded_minor, c.amount_minor, c.provider_net_minor).providerPartMinor;
  }
  // Recomendación aceptada por el cliente para este profesional y pedido.
  const [ref] = await tx<{ id: string; from_provider_id: string; fee_bps: number }[]>`
    select pr.id, pr.from_provider_id, pr.fee_bps from request_invitations i join provider_referrals pr on pr.id = i.referral_id
    where i.request_id = ${job.request_id} and i.provider_id = ${job.provider_id} and pr.status = 'accepted' limit 1`;
  const baseNet = Math.max(0, gross - fee - refundsPart - processing);
  const referral = ref ? Math.floor((baseNet * ref.fee_bps) / 10000) : 0;
  // La liquidación nunca es negativa: si los reintegros y costos superan lo cobrado, la diferencia queda como recupero.
  const target = gross - fee - refundsPart - processing - referral;
  const amount = Math.max(0, target);
  const adjustments = amount - (gross - fee);
  const [{ open }] = await tx<{ open: boolean }[]>`
    select exists (select 1 from disputes where job_id = ${jobId} and status in ('open','in_review','awaiting_response')) as open`;
  const [{ reviewed }] = await tx<{ reviewed: boolean }[]>`select exists (select 1 from reviews where job_id = ${jobId}) as reviewed`;
  const gw = activeGateway();
  const isTest = charges.some((c) => c.is_test) || gw.isTest;
  const [p] = await tx<{ id: string }[]>`
    insert into payouts (provider_id, job_id, kind, gateway, is_test, gross_minor, fee_minor, adjustments_minor, amount_minor, processing_minor, referral_minor, on_hold, hold_reason, awaiting_review)
    values (${job.provider_id}, ${jobId}, 'job', ${gw.name}, ${isTest}, ${gross}, ${fee}, ${adjustments}, ${amount}, ${processing}, ${referral},
            ${open}, ${open ? "Reclamo abierto" : null}, ${!reviewed})
    on conflict (job_id, kind) do nothing returning id`;
  if (!p) return null;
  await recordEvent(tx, { entityType: "payout", entityId: p.id, action: "created", to: "pending" });
  if (target < 0) {
    await tx`insert into provider_recoveries (provider_id, job_id, payout_kind, amount_minor, reason, is_test)
      values (${job.provider_id}, ${jobId}, 'job', ${-target}, ${`Reintegros y costos del trabajo ${job.code} mayores a lo cobrado`}, ${isTest})`;
  }
  if (ref && referral > 0) {
    const [rp] = await tx<{ id: string }[]>`
      insert into payouts (provider_id, job_id, kind, gateway, is_test, gross_minor, fee_minor, adjustments_minor, amount_minor, on_hold, hold_reason, awaiting_review)
      values (${ref.from_provider_id}, ${jobId}, 'referral', ${gw.name}, ${isTest}, ${referral}, 0, 0, ${referral}, ${open}, ${open ? "Reclamo abierto" : null}, ${!reviewed})
      on conflict (job_id, kind) do nothing returning id`;
    if (rp) {
      await postLedger(
        tx,
        [
          { account: "provider_payable", amount: referral, entryType: "adjustment", providerId: job.provider_id },
          { account: "provider_payable", amount: -referral, entryType: "adjustment", providerId: ref.from_provider_id },
        ],
        { jobId, payoutId: rp.id, isTest, reason: `Recomendación (${ref.fee_bps / 100} %) por el trabajo ${job.code}` },
      );
      await recordEvent(tx, { entityType: "payout", entityId: rp.id, action: "created", to: "pending", data: { referralId: ref.id } });
      await notify(tx, await providerRecipients(tx, ref.from_provider_id), {
        type: "payout", title: `Ganaste ${formatMoney(referral)} por recomendar · ${job.code}`,
        body: "Tu colega terminó el trabajo que le recomendaste. Se suma a tu saldo cuando el cliente deje su reseña.", link: "/proveedor/recomendaciones",
      });
    }
  }
  return p.id;
}

/**
 * Ejecuta una liquidación simulada (operación). En modo de prueba la transferencia es ficticia.
 * Con Split 1:1 de Mercado Pago el dinero se acredita directamente al vendedor: ver docs/payments.md.
 */
export async function executePayout(actor: Actor, payoutId: string, reason: string) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  if (!reason || reason.trim().length < 3) throw invalid("Indicá un motivo o referencia.");
  const commandId = await systemTx(async (tx) => {
    const [p] = await tx<{ id: string; status: string; on_hold: boolean; awaiting_review: boolean; provider_id: string; job_id: string; amount_minor: number; gateway: GatewayName; is_test: boolean; withdrawal_id: string | null }[]>`
      select * from payouts where id = ${payoutId} for update`;
    if (!p) throw notFound();
    if (p.withdrawal_id) throw invalid("Esta liquidación es parte de un retiro: se paga desde Retiros.");
    if (p.on_hold) throw invalid("La liquidación está retenida. Liberala antes de ejecutarla.");
    if (p.awaiting_review) throw invalid("Falta la reseña del cliente: sin reseña no se libera la liquidación.");
    const [prov] = await tx<{ payouts_status: string; payout_account_ref: string | null }[]>`
      select payouts_status, payout_account_ref from providers where id = ${p.provider_id}`;
    if (prov.payouts_status !== "enabled" || !prov.payout_account_ref) throw invalid("El proveedor no tiene habilitada la recepción de pagos.");
    const [job] = await tx<{ status: string; code: string }[]>`select status, code from jobs where id = ${p.job_id}`;
    if (job.status !== "completed") throw invalid("Solo se liquidan trabajos completados.");

    let status = p.status;
    const move = async (to: string) => {
      assertTransition(payoutMachine, status as never, to as never, to === "scheduled" ? "staff" : "system");
      await tx`update payouts set status = ${to}, scheduled_for = coalesce(scheduled_for, current_date) where id = ${p.id}`;
      await recordEvent(tx, { entityType: "payout", entityId: p.id, action: "status", from: status, to, actorId: actor.id, actorRole: actor.platformRole, reason });
      status = to;
    };
    if (status === "pending" || status === "failed") await move("scheduled");
    if (status === "scheduled") await move("processing");
    if (status !== "processing") throw invalid("La liquidación no está en un estado ejecutable.");

    // Misma clave siempre: si una transferencia anterior quedó en duda, la pasarela devuelve la misma en vez de repetirla.
    const id = await enqueuePaymentCommand(tx, {
      kind: "transfer", gateway: p.gateway, idempotencyKey: `payout:${p.id}`, payoutId: p.id,
      payload: { accountRef: prov.payout_account_ref, amountMinor: p.amount_minor },
    });
    await tx`update payment_commands set status = 'retryable', attempts = 0, next_attempt_at = now(), updated_at = now() where id = ${id} and status = 'dead'`;
    await audit(tx, actor, "payout.execute", "payout", p.id, reason, { amountMinor: p.amount_minor, test: p.is_test });
    return id;
  });
  // La transferencia, fuera de la transacción.
  await drainPaymentCommands({ ids: [commandId] });
  const [after] = await sql()<{ status: string }[]>`select status from payouts where id = ${payoutId}`;
  return { status: after.status as "paid" | "failed" | "processing" };
}

/** La pasarela informó la transferencia: se marca pagada y se asienta, o queda fallida para reprogramar. */
export async function finalizeTransferTx(tx: Tx, payoutId: string, t: { transferId: string; status: "processing" | "paid" | "failed" }) {
  const [p] = await tx<{ id: string; status: string; provider_id: string; job_id: string; amount_minor: number; is_test: boolean }[]>`
    select id, status, provider_id, job_id, amount_minor, is_test from payouts where id = ${payoutId} for update`;
  if (!p || p.status !== "processing") return;
  if (t.status === "failed") return failTransferTx(tx, payoutId, "La pasarela rechazó la transferencia");
  if (t.status !== "paid") return; // en curso: la confirma la pasarela más adelante
  const [job] = await tx<{ code: string }[]>`select code from jobs where id = ${p.job_id}`;
  await tx`update payouts set status = 'paid', paid_at = now(), external_ref = ${t.transferId} where id = ${p.id}`;
  await recordEvent(tx, { entityType: "payout", entityId: p.id, action: "status", from: "processing", to: "paid" });
  await postLedger(
    tx,
    [
      { account: "provider_payable", amount: p.amount_minor, entryType: "payout" },
      { account: "gateway_clearing", amount: -p.amount_minor, entryType: "payout" },
    ],
    { jobId: p.job_id, payoutId: p.id, providerId: p.provider_id, isTest: p.is_test, externalRef: t.transferId, reason: `Liquidación ${p.is_test ? "simulada " : ""}al proveedor` },
  );
  await notify(tx, await providerRecipients(tx, p.provider_id), {
    type: "payout",
    title: `Liquidación ${p.is_test ? "simulada " : ""}registrada · ${job.code}`,
    body: `Neto: ${formatMoney(p.amount_minor)}.${p.is_test ? " Modo de prueba: no se transfirió dinero real." : ""}`,
    link: `/proveedor/cobros`,
  });
}

export async function failTransferTx(tx: Tx, payoutId: string, error: string) {
  const [p] = await tx<{ status: string }[]>`select status from payouts where id = ${payoutId} for update`;
  if (!p || p.status !== "processing") return;
  assertTransition(payoutMachine, "processing", "failed", "system");
  await tx`update payouts set status = 'failed' where id = ${payoutId}`;
  await recordEvent(tx, { entityType: "payout", entityId: payoutId, action: "status", from: "processing", to: "failed", reason: error.slice(0, 200) });
  await notify(tx, await staffRecipients(tx), { type: "payout", title: "Una liquidación no se pudo transferir", body: error.slice(0, 200), link: "/admin/finanzas?tab=conciliacion" });
}

export async function setPayoutHold(actor: Actor, payoutId: string, hold: boolean, reason: string) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  if (!reason || reason.trim().length < 3) throw invalid("Indicá el motivo.");
  return systemTx(async (tx) => {
    const [p] = await tx<{ status: string }[]>`select status from payouts where id = ${payoutId} for update`;
    if (!p) throw notFound();
    if (!["pending", "scheduled", "failed"].includes(p.status)) throw invalid("Solo se pueden retener liquidaciones no pagadas.");
    await tx`update payouts set on_hold = ${hold}, hold_reason = ${hold ? reason : null} where id = ${payoutId}`;
    await recordEvent(tx, { entityType: "payout", entityId: payoutId, action: hold ? "hold" : "release", actorId: actor.id, reason });
    await audit(tx, actor, hold ? "payout.hold" : "payout.release", "payout", payoutId, reason);
  });
}

/** Excepción: liberar una liquidación sin reseña (ej.: cliente que no responde). Solo administradores, con motivo y auditoría. */
export async function releasePayoutWithoutReview(actor: Actor, payoutId: string, reason: string) {
  if (!isPlatformAdmin(actor)) throw forbidden("Solo administración puede liberar una liquidación sin reseña.");
  if (!reason || reason.trim().length < 10) throw invalid("Explicá el motivo de la excepción (mínimo 10 caracteres).");
  return systemTx(async (tx) => {
    const [p] = await tx<{ awaiting_review: boolean; status: string }[]>`select awaiting_review, status from payouts where id = ${payoutId} for update`;
    if (!p) throw notFound();
    if (!p.awaiting_review) throw invalid("Esta liquidación no está esperando reseña.");
    await tx`update payouts set awaiting_review = false, review_override_reason = ${reason} where id = ${payoutId}`;
    await recordEvent(tx, { entityType: "payout", entityId: payoutId, action: "review_override", actorId: actor.id, actorRole: actor.platformRole, reason });
    await audit(tx, actor, "payout.release_without_review", "payout", payoutId, reason);
  });
}

/** Ajuste manual auditado (no borra movimientos: agrega uno compensatorio). Solo administradores. */
export async function postManualAdjustment(
  actor: Actor,
  input: { jobId: string; providerId: string; amountMinor: number; reason: string },
) {
  if (!isPlatformAdmin(actor)) throw forbidden();
  if (input.reason.trim().length < 10) throw invalid("El motivo debe ser descriptivo (mín. 10 caracteres).");
  return systemTx(async (tx) => {
    await postLedger(
      tx,
      [
        { account: "provider_payable", amount: -input.amountMinor, entryType: "adjustment" },
        { account: "platform_revenue", amount: input.amountMinor, entryType: "adjustment" },
      ],
      { jobId: input.jobId, providerId: input.providerId, isTest: activeGateway().isTest, reason: input.reason, actorId: actor.id },
    );
    await audit(tx, actor, "ledger.adjustment", "job", input.jobId, input.reason, { amountMinor: input.amountMinor });
  });
}

// Conciliación con la pasarela: ver payment-reconciliation.ts.
