/**
 * Saldo y retiros de profesionales.
 *  - Fixy no cobra comisión a profesionales: el saldo es el 100 % de lo presupuestado (menos reembolsos).
 *  - Una liquidación pasa a "disponible" cuando el trabajo está completado, con reseña y sin reclamos abiertos.
 *  - Una vez por mes calendario (Buenos Aires) se pide retirar TODO el saldo disponible; se transfiere a los 20 días
 *    (platform_settings.withdrawals.delay_days) a la cuenta bancaria cargada.
 *  - La operación registra la transferencia con su referencia; recién ahí se asienta el pago en el registro financiero.
 */
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { isPlatformAdmin } from "@/server/auth/actor";
import { audit, recordEvent } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { assertTransition, payoutMachine } from "@/server/domain/state-machines";
import { notify, providerRecipients, staffRecipients } from "@/server/notifications";
import { paymentsAreTestMode } from "@/server/env";
import { formatMoney } from "@/lib/format";
import { assertProviderAdmin } from "./authz";
import { getSetting } from "./catalog";
import { postLedger } from "./payments";

const TZ = "America/Argentina/Buenos_Aires";

export const bankAccountSchema = z.object({
  holderName: z.string().trim().min(2, "Ingresá el nombre del titular.").max(160),
  holderTaxId: z.string().trim().transform((v) => v.replace(/\D/g, "")).pipe(z.string().regex(/^\d{11}$/, "El CUIT/CUIL tiene 11 dígitos.")),
  cbu: z.string().trim().transform((v) => v.replace(/\D/g, "")).pipe(z.string().regex(/^(\d{22})?$/, "El CBU/CVU tiene 22 dígitos.")),
  alias: z.string().trim().max(20).regex(/^([A-Za-z0-9.-]{6,20})?$/, "El alias tiene entre 6 y 20 caracteres (letras, números, punto o guion).").default(""),
  bankName: z.string().trim().max(80).default(""),
}).refine((d) => d.cbu || d.alias, { message: "Ingresá el CBU/CVU o el alias.", path: ["cbu"] });
export type BankAccountInput = z.input<typeof bankAccountSchema>;

export const maskCbu = (cbu: string | null) => (cbu ? `•••• ${cbu.slice(-4)}` : null);

async function saveBankAccountTx(tx: Tx, actor: Actor, providerId: string, input: BankAccountInput) {
  const d = bankAccountSchema.parse(input);
  await tx`
    insert into provider_bank_accounts (provider_id, holder_name, holder_tax_id, cbu, alias, bank_name, updated_by, updated_at)
    values (${providerId}, ${d.holderName}, ${d.holderTaxId}, ${d.cbu || null}, ${d.alias || null}, ${d.bankName || null}, ${actor.id}, now())
    on conflict (provider_id) do update set holder_name = excluded.holder_name, holder_tax_id = excluded.holder_tax_id, cbu = excluded.cbu,
      alias = excluded.alias, bank_name = excluded.bank_name, updated_by = excluded.updated_by, updated_at = now()`;
  // Con datos bancarios cargados, la recepción de pagos queda habilitada.
  await tx`update providers set payouts_status = 'enabled' where id = ${providerId}`;
  // Nunca se registran los datos bancarios en la auditoría.
  await audit(tx, actor, "provider.bank_account_saved", "provider", providerId, null, { cbu: maskCbu(d.cbu || null), alias: !!d.alias });
}

export async function saveBankAccount(actor: Actor, providerId: string, input: BankAccountInput) {
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    await saveBankAccountTx(tx, actor, providerId, input);
  });
}

/** Liquidaciones listas para retirar. */
const availableWhere = (tx: Db | Tx, providerId: string) => tx`
  po.provider_id = ${providerId} and po.status = 'pending' and po.withdrawal_id is null and not po.on_hold and not po.awaiting_review
  and exists (select 1 from jobs j where j.id = po.job_id and j.status = 'completed')`;

export type ProviderBalance = Awaited<ReturnType<typeof providerBalance>>;

export async function providerBalance(db: Db | Tx, providerId: string) {
  const [{ period, today }] = await db<{ period: string; today: string }[]>`
    select to_char(now() at time zone ${TZ}, 'YYYY-MM') as period, (now() at time zone ${TZ})::date::text as today`;
  const [a] = await db<{ available: number; n: number }[]>`
    select coalesce(sum(po.amount_minor), 0)::bigint as available, count(*)::int as n from payouts po where ${availableWhere(db, providerId)}`;
  const [w] = await db<{ waiting_review: number; on_hold: number }[]>`
    select coalesce(sum(amount_minor) filter (where awaiting_review and not on_hold), 0)::bigint as waiting_review,
           coalesce(sum(amount_minor) filter (where on_hold), 0)::bigint as on_hold
    from payouts where provider_id = ${providerId} and status = 'pending' and withdrawal_id is null`;
  // Cobrado al cliente en trabajos que todavía no terminaron (aún sin liquidación).
  const [inProgress] = await db<{ amount: number }[]>`
    select coalesce(sum(c.provider_net_minor + c.provider_fee_minor - c.refunded_minor), 0)::bigint as amount
    from charges c join jobs j on j.id = c.job_id
    where j.provider_id = ${providerId} and c.status in ('approved','partially_refunded')
      and not exists (select 1 from payouts po where po.job_id = j.id)`;
  const withdrawals = await db<{ id: string; amount_minor: number; status: string; period: string; scheduled_for: string; requested_at: Date; paid_at: Date | null; external_ref: string | null; reject_reason: string | null; is_test: boolean; bank_snapshot: BankSnapshot }[]>`
    select id, amount_minor, status, period, scheduled_for::text, requested_at, paid_at, external_ref, reject_reason, is_test, bank_snapshot
    from withdrawals where provider_id = ${providerId} order by requested_at desc limit 24`;
  const thisMonth = withdrawals.find((x) => x.period === period && x.status !== "rejected") ?? null;
  const [y, m] = period.split("-").map(Number);
  const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
  const [bank] = await db<{ holder_name: string; holder_tax_id: string; cbu: string | null; alias: string | null; bank_name: string | null }[]>`
    select holder_name, holder_tax_id, cbu, alias, bank_name from provider_bank_accounts where provider_id = ${providerId}`;
  const delayDays = Number(await getSetting(db as Db, "withdrawals.delay_days", 20));
  return {
    availableMinor: a.available,
    availableJobs: a.n,
    waitingReviewMinor: w.waiting_review,
    onHoldMinor: w.on_hold,
    inProgressMinor: inProgress.amount,
    requestedMinor: withdrawals.filter((x) => x.status === "requested").reduce((s, x) => s + x.amount_minor, 0),
    paidMinor: withdrawals.filter((x) => x.status === "paid").reduce((s, x) => s + x.amount_minor, 0),
    withdrawals,
    thisMonth,
    canRequest: !thisMonth && a.available > 0,
    nextRequestFrom: thisMonth ? nextMonth : today,
    delayDays,
    bank: bank ?? null,
  };
}

type BankSnapshot = { holderName: string; holderTaxId: string; cbu: string | null; alias: string | null; bankName: string | null };

/** Pide retirar todo el saldo disponible. Opcionalmente guarda/actualiza los datos bancarios en el mismo paso. */
export async function requestWithdrawal(actor: Actor, providerId: string, bankInput?: BankAccountInput | null) {
  return systemTx(async (tx) => {
    await assertProviderAdmin(tx, actor, providerId);
    // Serializa pedidos concurrentes del mismo profesional.
    await tx`select id from providers where id = ${providerId} for update`;
    if (bankInput) await saveBankAccountTx(tx, actor, providerId, bankInput);
    const [bank] = await tx<{ holder_name: string; holder_tax_id: string; cbu: string | null; alias: string | null; bank_name: string | null }[]>`
      select holder_name, holder_tax_id, cbu, alias, bank_name from provider_bank_accounts where provider_id = ${providerId}`;
    if (!bank) throw invalid("Cargá tus datos bancarios para recibir la transferencia.");
    const [{ period, today }] = await tx<{ period: string; today: string }[]>`
      select to_char(now() at time zone ${TZ}, 'YYYY-MM') as period, (now() at time zone ${TZ})::date::text as today`;
    const [dup] = await tx<{ id: string }[]>`select id from withdrawals where provider_id = ${providerId} and period = ${period} and status <> 'rejected'`;
    if (dup) throw invalid("Ya pediste un retiro este mes. Podés pedir el próximo desde el 1.º del mes que viene.");
    const payouts = await tx<{ id: string; amount_minor: number; is_test: boolean }[]>`
      select po.id, po.amount_minor, po.is_test from payouts po where ${availableWhere(tx, providerId)} for update of po`;
    const amount = payouts.reduce((s, p) => s + p.amount_minor, 0);
    if (amount <= 0) throw invalid("Todavía no tenés saldo disponible para retirar.");
    const delay = Number(await getSetting(tx as unknown as Db, "withdrawals.delay_days", 20));
    const snapshot: BankSnapshot = { holderName: bank.holder_name, holderTaxId: bank.holder_tax_id, cbu: bank.cbu, alias: bank.alias, bankName: bank.bank_name };
    const isTest = paymentsAreTestMode() || payouts.some((p) => p.is_test);
    const [w] = await tx<{ id: string; scheduled_for: string }[]>`
      insert into withdrawals (provider_id, amount_minor, period, scheduled_for, bank_snapshot, is_test, requested_by)
      values (${providerId}, ${amount}, ${period}, (${today}::date + ${delay}::int), ${tx.json(snapshot)}, ${isTest}, ${actor.id})
      returning id, scheduled_for::text`;
    for (const p of payouts) {
      assertTransition(payoutMachine, "pending", "scheduled", "system");
      await tx`update payouts set status = 'scheduled', withdrawal_id = ${w.id}, scheduled_for = ${w.scheduled_for} where id = ${p.id}`;
      await recordEvent(tx, { entityType: "payout", entityId: p.id, action: "status", from: "pending", to: "scheduled", actorId: actor.id, reason: "Incluida en un retiro" });
    }
    await recordEvent(tx, { entityType: "withdrawal", entityId: w.id, action: "created", to: "requested", actorId: actor.id, data: { amountMinor: amount, payouts: payouts.length } });
    await audit(tx, actor, "withdrawal.request", "withdrawal", w.id, null, { amountMinor: amount, payouts: payouts.length });
    const when = new Date(`${w.scheduled_for}T12:00:00-03:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long" });
    await notify(tx, await providerRecipients(tx, providerId), {
      type: "payout", title: `Pediste un retiro de ${formatMoney(amount)}`,
      body: `Te lo transferimos el ${when} a la cuenta ${snapshot.alias ?? maskCbu(snapshot.cbu)}.${isTest ? " Modo de prueba: no se mueve dinero real." : ""}`,
      link: "/proveedor/cobros",
    });
    await notify(tx, await staffRecipients(tx), { type: "payout", title: "Nuevo retiro solicitado", body: `${formatMoney(amount)} · a transferir el ${when}.`, link: "/admin/finanzas?tab=retiros" });
    return { id: w.id, amountMinor: amount, scheduledFor: w.scheduled_for };
  });
}

/** La operación registra la transferencia realizada. Asienta el pago de cada liquidación incluida. */
export async function markWithdrawalPaid(actor: Actor, withdrawalId: string, externalRef: string, opts: { allowEarly?: boolean } = {}) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  const ref = externalRef.trim();
  if (ref.length < 3) throw invalid("Indicá la referencia de la transferencia.");
  return systemTx(async (tx) => {
    const [w] = await tx<{ id: string; provider_id: string; status: string; amount_minor: number; is_test: boolean; due: boolean }[]>`
      select id, provider_id, status, amount_minor, is_test, scheduled_for <= (now() at time zone ${TZ})::date as due from withdrawals where id = ${withdrawalId} for update`;
    if (!w) throw notFound();
    if (w.status !== "requested") throw invalid("Este retiro ya fue procesado.");
    if (!w.due && !(opts.allowEarly && isPlatformAdmin(actor))) throw invalid("Todavía no llegó la fecha de transferencia de este retiro.");
    const payouts = await tx<{ id: string; job_id: string; amount_minor: number; status: string; on_hold: boolean }[]>`
      select id, job_id, amount_minor, status, on_hold from payouts where withdrawal_id = ${w.id} for update`;
    if (payouts.some((p) => p.on_hold)) throw invalid("Hay un trabajo con reclamo abierto dentro de este retiro: resolvelo o rechazá el retiro.");
    const total = payouts.reduce((s, p) => s + p.amount_minor, 0);
    if (total !== w.amount_minor) throw invalid("El monto del retiro no coincide con sus liquidaciones. Revisalo antes de pagar.");
    for (const p of payouts) {
      for (const [from, to] of [["scheduled", "processing"], ["processing", "paid"]] as const) {
        assertTransition(payoutMachine, from, to, "system");
        await tx`update payouts set status = ${to}, ${to === "paid" ? tx`paid_at = now(), external_ref = ${ref}` : tx`external_ref = external_ref`} where id = ${p.id}`;
        await recordEvent(tx, { entityType: "payout", entityId: p.id, action: "status", from, to, actorId: actor.id, reason: `Retiro ${ref}` });
      }
      await postLedger(
        tx,
        [
          { account: "provider_payable", amount: p.amount_minor, entryType: "payout" },
          { account: "gateway_clearing", amount: -p.amount_minor, entryType: "payout" },
        ],
        { jobId: p.job_id, payoutId: p.id, providerId: w.provider_id, isTest: w.is_test, externalRef: ref, reason: `Retiro ${w.is_test ? "simulado " : ""}al profesional`, actorId: actor.id },
      );
    }
    await tx`update withdrawals set status = 'paid', paid_at = now(), external_ref = ${ref}, processed_by = ${actor.id} where id = ${w.id}`;
    await recordEvent(tx, { entityType: "withdrawal", entityId: w.id, action: "status", from: "requested", to: "paid", actorId: actor.id, reason: ref });
    await audit(tx, actor, "withdrawal.paid", "withdrawal", w.id, ref, { amountMinor: w.amount_minor });
    await notify(tx, await providerRecipients(tx, w.provider_id), {
      type: "payout", title: `Te transferimos ${formatMoney(w.amount_minor)}`,
      body: `Referencia: ${ref}.${w.is_test ? " Modo de prueba: no se transfirió dinero real." : ""}`, link: "/proveedor/cobros",
    });
  });
}

/** Rechazo (ej.: datos bancarios inválidos). El saldo vuelve a estar disponible y el pedido no cuenta para el mes. */
export async function rejectWithdrawal(actor: Actor, withdrawalId: string, reason: string) {
  if (!can(actor, "finanzas", "manage")) throw forbidden();
  if (reason.trim().length < 5) throw invalid("Explicá el motivo para que el profesional pueda corregirlo.");
  return systemTx(async (tx) => {
    const [w] = await tx<{ id: string; provider_id: string; status: string; amount_minor: number }[]>`select id, provider_id, status, amount_minor from withdrawals where id = ${withdrawalId} for update`;
    if (!w) throw notFound();
    if (w.status !== "requested") throw invalid("Este retiro ya fue procesado.");
    const payouts = await tx<{ id: string }[]>`select id from payouts where withdrawal_id = ${w.id} for update`;
    for (const p of payouts) {
      assertTransition(payoutMachine, "scheduled", "pending", "staff");
      await tx`update payouts set status = 'pending', withdrawal_id = null, scheduled_for = null where id = ${p.id}`;
      await recordEvent(tx, { entityType: "payout", entityId: p.id, action: "status", from: "scheduled", to: "pending", actorId: actor.id, reason: "Retiro rechazado" });
    }
    await tx`update withdrawals set status = 'rejected', reject_reason = ${reason.trim()}, processed_by = ${actor.id} where id = ${w.id}`;
    await recordEvent(tx, { entityType: "withdrawal", entityId: w.id, action: "status", from: "requested", to: "rejected", actorId: actor.id, reason });
    await audit(tx, actor, "withdrawal.reject", "withdrawal", w.id, reason);
    await notify(tx, await providerRecipients(tx, w.provider_id), {
      type: "payout", title: "No pudimos procesar tu retiro", body: `${reason.trim()} Tu saldo sigue disponible: corregí lo necesario y volvé a pedirlo.`, link: "/proveedor/cobros",
    });
  });
}

/** Retiros pendientes para la operación (con los datos bancarios completos: solo staff). */
export async function listPendingWithdrawals(db: Db) {
  return db<{ id: string; provider_id: string; provider_name: string; amount_minor: number; scheduled_for: string; requested_at: Date; bank_snapshot: BankSnapshot; is_test: boolean; due: boolean; jobs: number }[]>`
    select w.id, w.provider_id, p.display_name as provider_name, w.amount_minor, w.scheduled_for::text, w.requested_at, w.bank_snapshot, w.is_test,
      w.scheduled_for <= (now() at time zone ${TZ})::date as due, (select count(*)::int from payouts po where po.withdrawal_id = w.id) as jobs
    from withdrawals w join providers p on p.id = w.provider_id where w.status = 'requested' order by w.scheduled_for, w.requested_at`;
}
