/**
 * Cobros, confirmación por webhooks, reembolsos, liquidaciones y registro financiero.
 * Reglas clave (docs/payments.md):
 *  - Los importes se calculan en el servidor y se validan contra la pasarela (monto, moneda, referencia).
 *  - Un cobro solo se aprueba por un evento autenticado + consulta verificada a la pasarela,
 *    nunca por la página de retorno del navegador.
 *  - Webhooks idempotentes; eventos duplicados o fuera de orden se descartan sin efectos.
 *  - Los movimientos financieros no se borran ni se editan: se registran ajustes o reversos.
 */
import { randomUUID } from "node:crypto";
import type { Db, Tx } from "@/server/db/client";
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isPlatformAdmin } from "@/server/auth/actor";
import { audit, recordEvent } from "@/server/audit";
import { DomainError, forbidden, invalid, notFound } from "@/server/domain/errors";
import { splitRefund } from "@/server/domain/money";
import { CHARGE_RANK, assertTransition, payoutMachine, type ChargeStatus } from "@/server/domain/state-machines";
import { activeGateway, gatewayByName } from "@/server/payments";
import type { GatewayName, GatewayPaymentStatus } from "@/server/payments/gateway";
import { clientRecipients, notify, providerRecipients } from "@/server/notifications";
import { formatMoney } from "@/lib/format";

type LedgerLine = {
  account: "gateway_clearing" | "client_payments" | "platform_revenue" | "provider_payable" | "taxes_payable" | "refunds";
  amount: number;
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
        ${meta.providerId ?? null}, ${l.entryType}, ${l.account}, ${l.amount}, 'ARS', ${meta.isTest},
        ${meta.externalRef ?? null}, ${meta.reason}, ${meta.actorId ?? null})`;
  }
  return txnId;
}

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
};

/** Crea un cobro pendiente y la intención de pago en la pasarela. Importes calculados por el servidor. */
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
  const { checkoutUrl } = await gw.createCheckout(tx, {
    externalReference,
    amountMinor: input.amountMinor,
    currency: "ARS",
    description: input.description,
    payoutAccountRef: input.payoutAccountRef,
    marketplaceFeeMinor: input.clientFeeMinor + input.taxMinor + input.providerFeeMinor,
    idempotencyKey,
  });
  await tx`update charges set checkout_url = ${checkoutUrl} where id = ${id}`;
  await recordEvent(tx, { entityType: "charge", entityId: id, action: "created", to: "pending", data: { kind: input.kind } });
  return { ...charge, checkout_url: checkoutUrl };
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
  const eventId = String(payload.id ?? headers.get("x-request-id") ?? "");
  const paymentId = payload.data?.id ? String(payload.data.id) : null;
  if (!eventId) return "rejected";

  return systemTx(async (tx) => {
    const inserted = await tx<{ id: string }[]>`
      insert into payment_events (gateway, external_event_id, event_type, external_payment_id, signature_valid, payload, attempts)
      values (${gatewayName}, ${eventId}, ${payload.action ?? payload.type ?? "unknown"}, ${paymentId}, ${signatureValid},
              ${tx.json(payload as never)}, 1)
      on conflict (gateway, external_event_id) do update set attempts = payment_events.attempts + 1
      returning id, (xmax = 0) as is_new`;
    const ev = inserted[0] as unknown as { id: string; is_new: boolean };
    if (!ev.is_new) {
      const [prev] = await tx<{ result: string | null }[]>`select result from payment_events where id = ${ev.id}`;
      if (prev.result && prev.result !== "error") return "ignored_duplicate";
    }
    const finish = async (result: WebhookResult, error?: string) => {
      await tx`update payment_events set processed_at = now(), result = ${result}, error = ${error ?? null} where id = ${ev.id}`;
      return result;
    };
    if (!signatureValid) return finish("rejected", "firma inválida");
    if (!paymentId) return finish("rejected", "sin id de pago");
    const res = await syncPaymentFromGateway(tx, gatewayName, paymentId);
    return finish(res.result, res.error);
  });
}

/** Consulta verificada a la pasarela y aplicación del estado. Usada por webhooks y conciliación. */
export async function syncPaymentFromGateway(
  tx: Tx,
  gatewayName: GatewayName,
  paymentId: string,
): Promise<{ result: WebhookResult; error?: string; chargeId?: string }> {
  const gw = gatewayByName(gatewayName);
  const payment = await gw.getPayment(tx, paymentId);
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
  if (charge.external_payment_id && charge.external_payment_id !== payment.id) {
    return { result: "rejected", error: "id de pago distinto al registrado", chargeId: charge.id };
  }
  const target = mapGatewayStatus(payment.status);
  // Los reembolsos los inicia la plataforma y se registran en refundCharge; acá solo cobro aprobado/fallido.
  if (target === "refunded" || target === "partially_refunded") return { result: "ignored_stale", chargeId: charge.id };
  if (CHARGE_RANK[target] <= charge.status_rank || charge.status === target) {
    return { result: "ignored_stale", chargeId: charge.id };
  }
  if (charge.status === "failed" || charge.status === "approved") return { result: "ignored_stale", chargeId: charge.id };

  await tx`update charges set status = ${target}, status_rank = ${CHARGE_RANK[target]}, external_payment_id = ${payment.id},
    approved_at = ${target === "approved" ? new Date() : null},
    failure_reason = ${target === "failed" ? "Pago rechazado por la pasarela" : null}
    where id = ${charge.id}`;
  await recordEvent(tx, { entityType: "charge", entityId: charge.id, action: "gateway_update", from: charge.status, to: target });
  if (target === "approved") await onChargeApproved(tx, { ...charge, status: "approved", external_payment_id: payment.id });
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
  return systemTx(async (tx) => refundChargeTx(tx, actor, input));
}

export async function refundChargeTx(
  tx: Tx,
  actor: Actor,
  input: { chargeId: string; amountMinor: number; reason: string; disputeId?: string | null; idempotencyKey?: string },
) {
  const [c] = await tx<ChargeRow[]>`select * from charges where id = ${input.chargeId} for update`;
  if (!c) throw notFound("Cobro inexistente.");
  if (!["approved", "partially_refunded"].includes(c.status)) throw invalid("Solo se pueden reembolsar cobros aprobados.");
  const remaining = c.amount_minor - c.refunded_minor;
  if (input.amountMinor > remaining) throw invalid(`El máximo reembolsable es ${formatMoney(remaining)}.`);
  if (!c.external_payment_id) throw new DomainError("payment_error", "El cobro no tiene un pago asociado en la pasarela.");

  const idem = input.idempotencyKey ?? `refund:${c.id}:${c.refunded_minor}:${input.amountMinor}`;
  const [existing] = await tx<{ id: string }[]>`select id from refunds where idempotency_key = ${idem}`;
  if (existing) return existing.id;

  const gw = gatewayByName(c.gateway);
  const { refundId: externalRefundId } = await gw.refund(tx, c.external_payment_id, input.amountMinor, idem);
  const [refund] = await tx<{ id: string }[]>`
    insert into refunds (charge_id, amount_minor, status, reason, dispute_id, external_refund_id, idempotency_key, requested_by, processed_at)
    values (${c.id}, ${input.amountMinor}, 'approved', ${input.reason}, ${input.disputeId ?? null}, ${externalRefundId}, ${idem}, ${actor.id}, now())
    returning id`;
  const refunded = c.refunded_minor + input.amountMinor;
  const newStatus: ChargeStatus = refunded === c.amount_minor ? "refunded" : "partially_refunded";
  await tx`update charges set refunded_minor = ${refunded}, status = ${newStatus}, status_rank = ${CHARGE_RANK[newStatus]} where id = ${c.id}`;

  const { providerPartMinor, platformPartMinor } = splitRefund(input.amountMinor, c.amount_minor, c.provider_net_minor);
  const [job] = await tx<{ provider_id: string; request_id: string; code: string }[]>`select provider_id, request_id, code from jobs where id = ${c.job_id}`;
  await postLedger(
    tx,
    [
      { account: "gateway_clearing", amount: -input.amountMinor, entryType: "refund" },
      { account: "provider_payable", amount: providerPartMinor, entryType: "refund" },
      { account: "platform_revenue", amount: platformPartMinor, entryType: "refund" },
    ],
    {
      jobId: c.job_id,
      chargeId: c.id,
      refundId: refund.id,
      providerId: job.provider_id,
      isTest: c.is_test,
      externalRef: externalRefundId,
      reason: `Reembolso: ${input.reason}`,
      actorId: actor.id,
    },
  );

  // Si la liquidación del trabajo todavía no se pagó, se ajusta su neto (con registro del ajuste).
  const [payout] = await tx<{ id: string; status: string; adjustments_minor: number; amount_minor: number }[]>`
    select id, status, adjustments_minor, amount_minor from payouts where job_id = ${c.job_id} for update`;
  if (payout && ["pending", "scheduled", "failed"].includes(payout.status)) {
    const adj = payout.adjustments_minor - providerPartMinor;
    await tx`update payouts set adjustments_minor = ${adj}, amount_minor = gross_minor - fee_minor + ${adj} where id = ${payout.id}`;
    await recordEvent(tx, { entityType: "payout", entityId: payout.id, action: "adjusted_by_refund", actorId: actor.id, reason: input.reason, data: { providerPartMinor } });
  } else if (payout && payout.status === "paid") {
    await audit(tx, actor, "payout.refund_after_paid", "payout", payout.id, "Reembolso posterior a la liquidación: requiere recupero", { providerPartMinor });
  }

  await recordEvent(tx, { entityType: "charge", entityId: c.id, action: "refund", from: c.status, to: newStatus, actorId: actor.id, actorRole: actor.platformRole, reason: input.reason, data: { amountMinor: input.amountMinor } });
  await audit(tx, actor, "charge.refund", "charge", c.id, input.reason, { amountMinor: input.amountMinor, refundId: refund.id });
  await notify(tx, await clientRecipients(tx, job.request_id), {
    type: "payment",
    title: `Reembolso registrado · ${job.code}`,
    body: `Se registró un reembolso de ${formatMoney(input.amountMinor)}${c.is_test ? " (modo de prueba)" : ""}.`,
    link: `/app/trabajos/${c.job_id}`,
  });
  return refund.id;
}

// ───────────────────────── Liquidaciones ─────────────────────────

/** Al completarse un trabajo se genera la liquidación pendiente con el neto de los cobros aprobados. */
export async function createPayoutForJob(tx: Tx, jobId: string) {
  const [job] = await tx<{ provider_id: string }[]>`select provider_id from jobs where id = ${jobId}`;
  const charges = await tx<ChargeRow[]>`select * from charges where job_id = ${jobId} and status in ('approved','partially_refunded','refunded')`;
  if (charges.length === 0) return null;
  let gross = 0;
  let fee = 0;
  let adjustments = 0;
  for (const c of charges) {
    gross += c.provider_net_minor + c.provider_fee_minor;
    fee += c.provider_fee_minor;
    if (c.refunded_minor > 0) adjustments -= splitRefund(c.refunded_minor, c.amount_minor, c.provider_net_minor).providerPartMinor;
  }
  const [{ open }] = await tx<{ open: boolean }[]>`
    select exists (select 1 from disputes where job_id = ${jobId} and status in ('open','in_review','awaiting_response')) as open`;
  const [{ reviewed }] = await tx<{ reviewed: boolean }[]>`select exists (select 1 from reviews where job_id = ${jobId}) as reviewed`;
  const gw = activeGateway();
  const [p] = await tx<{ id: string }[]>`
    insert into payouts (provider_id, job_id, gateway, is_test, gross_minor, fee_minor, adjustments_minor, amount_minor, on_hold, hold_reason, awaiting_review)
    values (${job.provider_id}, ${jobId}, ${gw.name}, ${gw.isTest}, ${gross}, ${fee}, ${adjustments}, ${gross - fee + adjustments},
            ${open}, ${open ? "Reclamo abierto" : null}, ${!reviewed})
    on conflict (job_id) do nothing returning id`;
  if (p) await recordEvent(tx, { entityType: "payout", entityId: p.id, action: "created", to: "pending" });
  return p?.id ?? null;
}

/**
 * Ejecuta una liquidación simulada (operación). En modo de prueba la transferencia es ficticia.
 * Con Split 1:1 de Mercado Pago el dinero se acredita directamente al vendedor: ver docs/payments.md.
 */
export async function executePayout(actor: Actor, payoutId: string, reason: string) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  if (!reason || reason.trim().length < 3) throw invalid("Indicá un motivo o referencia.");
  return systemTx(async (tx) => {
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

    const gw = gatewayByName(p.gateway);
    const t = await gw.transfer(tx, prov.payout_account_ref, p.amount_minor, `payout:${p.id}`);
    if (t.status === "failed") {
      await move("failed");
      return { status: "failed" as const };
    }
    if (t.status === "paid") {
      await tx`update payouts set status = 'paid', paid_at = now(), external_ref = ${t.transferId} where id = ${p.id}`;
      await recordEvent(tx, { entityType: "payout", entityId: p.id, action: "status", from: "processing", to: "paid", actorId: actor.id, reason });
      await postLedger(
        tx,
        [
          { account: "provider_payable", amount: p.amount_minor, entryType: "payout" },
          { account: "gateway_clearing", amount: -p.amount_minor, entryType: "payout" },
        ],
        { jobId: p.job_id, payoutId: p.id, providerId: p.provider_id, isTest: p.is_test, externalRef: t.transferId, reason: `Liquidación ${p.is_test ? "simulada " : ""}al proveedor`, actorId: actor.id },
      );
      await audit(tx, actor, "payout.execute", "payout", p.id, reason, { amountMinor: p.amount_minor, test: p.is_test });
      await notify(tx, await providerRecipients(tx, p.provider_id), {
        type: "payout",
        title: `Liquidación ${p.is_test ? "simulada " : ""}registrada · ${job.code}`,
        body: `Neto: ${formatMoney(p.amount_minor)}.${p.is_test ? " Modo de prueba: no se transfirió dinero real." : ""}`,
        link: `/proveedor/cobros`,
      });
    }
    return { status: "paid" as const };
  });
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

// ───────────────────────── Conciliación ─────────────────────────

export type ReconciliationRow = {
  chargeId: string;
  jobCode: string;
  externalReference: string;
  internalStatus: string;
  gatewayStatus: string | null;
  internalAmount: number;
  gatewayAmount: number | null;
  issue: string;
};

/** Compara el estado interno de cada cobro con la pasarela y lista diferencias. */
export async function reconcile(db: Db): Promise<ReconciliationRow[]> {
  const rows = await db<{ id: string; code: string; external_reference: string; status: string; amount_minor: number; refunded_minor: number; gw_id: string | null; gw_status: string | null; gw_amount: number | null; gw_refunded: number | null; gateway: string }[]>`
    select c.id, j.code, c.external_reference, c.status, c.amount_minor, c.refunded_minor, c.gateway,
      m.id as gw_id, m.status as gw_status, m.amount_minor as gw_amount, m.refunded_minor as gw_refunded
    from charges c join jobs j on j.id = c.job_id
    left join lateral (select * from mock_gateway_payments m where m.external_reference = c.external_reference order by created_at desc limit 1) m on true
    order by c.created_at desc limit 500`;
  const out: ReconciliationRow[] = [];
  for (const r of rows) {
    const expected: Record<string, string[]> = {
      pending: ["pending"],
      processing: ["pending"],
      approved: ["approved"],
      failed: ["rejected"],
      partially_refunded: ["partially_refunded"],
      refunded: ["refunded"],
    };
    let issue = "";
    if (r.gateway !== "mock") issue = "Conciliación automática no disponible para esta pasarela";
    else if (!r.gw_id) issue = "Sin registro en la pasarela";
    else if (r.gw_amount !== r.amount_minor) issue = "Monto distinto";
    else if (!expected[r.status]?.includes(r.gw_status ?? "")) issue = "Estado distinto";
    else if ((r.gw_refunded ?? 0) !== r.refunded_minor) issue = "Reembolsos distintos";
    if (issue)
      out.push({
        chargeId: r.id,
        jobCode: r.code,
        externalReference: r.external_reference,
        internalStatus: r.status,
        gatewayStatus: r.gw_status,
        internalAmount: r.amount_minor,
        gatewayAmount: r.gw_amount,
        issue,
      });
  }
  return out;
}

/** Re-sincroniza un cobro consultando la pasarela (misma lógica que el webhook). */
export async function resyncCharge(actor: Actor, chargeId: string) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  return systemTx(async (tx) => {
    const [c] = await tx<{ gateway: GatewayName; external_reference: string }[]>`select gateway, external_reference from charges where id = ${chargeId}`;
    if (!c) throw notFound();
    const [m] = await tx<{ id: string }[]>`select id from mock_gateway_payments where external_reference = ${c.external_reference} order by created_at desc limit 1`;
    if (!m) throw invalid("La pasarela no tiene un pago para esta referencia.");
    const r = await syncPaymentFromGateway(tx, c.gateway, m.id);
    await audit(tx, actor, "charge.resync", "charge", chargeId, "Conciliación manual", { result: r.result });
    return r;
  });
}
