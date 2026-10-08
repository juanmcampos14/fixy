/** Presupuestos: creación por el proveedor, comparación y aceptación atómica por el cliente. */
import { z } from "zod";
import type { Tx } from "@/server/db/client";
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { audit, recordEvent } from "@/server/audit";
import { DomainError, conflict, forbidden, invalid, notFound } from "@/server/domain/errors";
import { computeBreakdown } from "@/server/domain/money";
import { assertTransition, quoteMachine, requestMachine, type QuoteStatus, type RequestStatus } from "@/server/domain/state-machines";
import { clientRecipients, notify, providerRecipients } from "@/server/notifications";
import { commissionRuleFor } from "./catalog";
import { assertProviderAdmin, check } from "./authz";
import { providerEligibility } from "./providers";
import { createCharge } from "./payments";
import { formatMoney } from "@/lib/format";

export const DEFAULT_CANCELLATION_TERMS =
  "Podés cancelar sin cargo mientras el profesional no haya confirmado el trabajo: si ya pagaste, se reintegra el total por el mismo medio. " +
  "Después de la confirmación, la cancelación se gestiona con el equipo de Fixy según lo realizado. Fixy no ofrece custodia de fondos ni garantías adicionales a las indicadas.";

const itemSchema = z.object({
  kind: z.enum(["labor", "materials", "visit"]),
  description: z.string().trim().min(2, "Describí cada concepto.").max(200),
  quantity: z.coerce.number().int().min(1).max(1000),
  unitPriceMinor: z.coerce.number().int().min(0).max(100_000_000_00),
});

export const quoteSchema = z.object({
  invitationId: z.string().uuid(),
  mode: z.enum(["fixed", "quote", "diagnostic"]),
  scope: z.string().trim().min(10, "Describí qué incluye el trabajo (mínimo 10 caracteres).").max(4000),
  exclusions: z.string().trim().max(2000).default(""),
  materialsIncluded: z.boolean(),
  proposedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indicá una fecha propuesta.").optional().or(z.literal("")),
  proposedWindow: z.string().trim().max(60).optional().or(z.literal("")),
  validDays: z.coerce.number().int().min(1).max(30),
  items: z.array(itemSchema).min(1, "Agregá al menos un concepto.").max(30),
});
export type QuoteInput = z.infer<typeof quoteSchema>;

export async function createQuote(actor: Actor, input: QuoteInput) {
  const d = quoteSchema.parse(input);
  if (d.mode === "diagnostic" && d.items.some((i) => i.kind !== "visit")) {
    throw invalid("La visita de diagnóstico solo incluye el costo de la visita. La reparación se cotiza después como adicional.");
  }
  if (d.mode !== "diagnostic" && !d.items.some((i) => i.kind !== "visit")) {
    throw invalid("Incluí la mano de obra o los materiales del trabajo.");
  }
  return systemTx(async (tx) => {
    const [inv] = await tx<{ id: string; provider_id: string; request_id: string; status: string }[]>`
      select id, provider_id, request_id, status from request_invitations where id = ${d.invitationId} for update`;
    if (!inv) throw notFound();
    await assertProviderAdmin(tx, actor, inv.provider_id);
    if (!["invited", "viewed"].includes(inv.status)) throw invalid("Esta oportunidad ya no admite presupuestos.");
    const elig = await providerEligibility(tx, inv.provider_id);
    if (!elig.eligible) throw new DomainError("not_eligible", elig.reasons.join(" "));
    const [req] = await tx<{ status: RequestStatus; category_id: string | null; code: string; service_id: string | null }[]>`
      select status, category_id, code, service_id from service_requests where id = ${inv.request_id} for update`;
    if (!["searching", "with_quotes"].includes(req.status)) throw invalid("La solicitud ya no recibe presupuestos.");
    if (await check(tx, "is_request_client", actor, inv.request_id)) throw invalid("No podés cotizar una solicitud propia.");
    if (d.mode === "fixed") {
      const [svc] = await tx<{ pricing_mode: string }[]>`select pricing_mode from services where id = ${req.service_id}`;
      if (svc?.pricing_mode !== "fixed") throw invalid("El precio cerrado solo aplica a servicios catalogados con alcance definido.");
    }

    const sum = (k: string) => d.items.filter((i) => i.kind === k).reduce((s, i) => s + i.quantity * i.unitPriceMinor, 0);
    const rule = await commissionRuleFor(tx, req.category_id);
    const b = computeBreakdown({ laborMinor: sum("labor"), materialsMinor: sum("materials"), visitMinor: sum("visit") }, rule);
    if (b.subtotalMinor <= 0) throw invalid("El total debe ser mayor a cero.");

    const validUntil = new Date(Date.now() + d.validDays * 86400_000);
    const [q] = await tx<{ id: string }[]>`
      insert into quotes (request_id, provider_id, invitation_id, mode, status, scope, exclusions, materials_included, proposed_date,
        proposed_window, valid_until, labor_minor, materials_minor, visit_minor, subtotal_minor, client_fee_minor, client_fee_tax_minor,
        provider_fee_minor, total_minor, provider_net_minor, provider_rate_bps, client_rate_bps, client_fee_tax_bps,
        cancellation_terms, created_by)
      values (${inv.request_id}, ${inv.provider_id}, ${inv.id}, ${d.mode}, 'draft', ${d.scope}, ${d.exclusions}, ${d.materialsIncluded},
        ${d.proposedDate || null}, ${d.proposedWindow || null}, ${validUntil}, ${b.laborMinor}, ${b.materialsMinor}, ${b.visitMinor},
        ${b.subtotalMinor}, ${b.clientFeeMinor}, ${b.clientFeeTaxMinor}, ${b.providerFeeMinor}, ${b.totalMinor}, ${b.providerNetMinor},
        ${rule.providerRateBps}, ${rule.clientRateBps}, ${rule.clientFeeTaxBps}, ${DEFAULT_CANCELLATION_TERMS}, ${actor.id})
      returning id`;
    for (const [i, it] of d.items.entries()) {
      await tx`insert into quote_items (quote_id, kind, description, quantity, unit_price_minor, amount_minor, sort)
        values (${q.id}, ${it.kind}, ${it.description}, ${it.quantity}, ${it.unitPriceMinor}, ${it.quantity * it.unitPriceMinor}, ${i})`;
    }
    assertTransition(quoteMachine, "draft", "sent", "provider");
    await tx`update quotes set status = 'sent', sent_at = now() where id = ${q.id}`;
    await tx`update request_invitations set status = 'quoted', responded_at = now() where id = ${inv.id}`;
    await recordEvent(tx, { entityType: "quote", entityId: q.id, action: "status", from: "draft", to: "sent", actorId: actor.id });
    if (req.status === "searching") {
      assertTransition(requestMachine, "searching", "with_quotes", "system");
      await tx`update service_requests set status = 'with_quotes' where id = ${inv.request_id}`;
      await recordEvent(tx, { entityType: "request", entityId: inv.request_id, action: "status", from: "searching", to: "with_quotes" });
    }
    await recordEvent(tx, { entityType: "request", entityId: inv.request_id, action: "quote_received", data: { quoteId: q.id, providerId: inv.provider_id } });
    await notify(tx, await clientRecipients(tx, inv.request_id), {
      type: "quote_received",
      title: `Recibiste un presupuesto · ${req.code}`,
      body: `Total: ${formatMoney(b.totalMinor)}. Revisá qué incluye antes de confirmar.`,
      link: `/app/solicitudes/${inv.request_id}`,
    });
    return q.id;
  });
}

export async function withdrawQuote(actor: Actor, quoteId: string, reason: string) {
  return systemTx(async (tx) => {
    const [q] = await tx<{ provider_id: string; status: QuoteStatus; request_id: string }[]>`select provider_id, status, request_id from quotes where id = ${quoteId} for update`;
    if (!q) throw notFound();
    await assertProviderAdmin(tx, actor, q.provider_id);
    assertTransition(quoteMachine, q.status, "withdrawn", "provider");
    await tx`update quotes set status = 'withdrawn', decided_at = now() where id = ${quoteId}`;
    await recordEvent(tx, { entityType: "quote", entityId: quoteId, action: "status", from: q.status, to: "withdrawn", actorId: actor.id, reason });
    await reopenIfNoQuotes(tx, q.request_id);
  });
}

export async function rejectQuote(actor: Actor, quoteId: string, reason: string) {
  return systemTx(async (tx) => {
    const [q] = await tx<{ provider_id: string; status: QuoteStatus; request_id: string }[]>`select provider_id, status, request_id from quotes where id = ${quoteId} for update`;
    if (!q) throw notFound();
    if (!(await check(tx, "is_request_client", actor, q.request_id))) throw forbidden();
    assertTransition(quoteMachine, q.status, "rejected", "client");
    await tx`update quotes set status = 'rejected', decided_at = now() where id = ${quoteId}`;
    await recordEvent(tx, { entityType: "quote", entityId: quoteId, action: "status", from: q.status, to: "rejected", actorId: actor.id, reason });
    await notify(tx, await providerRecipients(tx, q.provider_id), { type: "quote_received", title: "El cliente no eligió tu presupuesto", body: reason || "", link: "/proveedor/oportunidades" });
    await reopenIfNoQuotes(tx, q.request_id);
  });
}

async function reopenIfNoQuotes(tx: Tx, requestId: string) {
  const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from quotes where request_id = ${requestId} and status = 'sent'`;
  const [r] = await tx<{ status: RequestStatus }[]>`select status from service_requests where id = ${requestId}`;
  if (n === 0 && r.status === "with_quotes") {
    await tx`update service_requests set status = 'searching' where id = ${requestId}`;
    await recordEvent(tx, { entityType: "request", entityId: requestId, action: "status", from: "with_quotes", to: "searching", reason: "Sin presupuestos vigentes" });
  }
}

/** Marca como vencidos los presupuestos fuera de vigencia (job periódico y también antes de mostrar/aceptar). */
export async function expireQuotes(tx: Tx, requestId?: string) {
  const expired = await tx<{ id: string; request_id: string }[]>`
    update quotes set status = 'expired', decided_at = now()
    where status = 'sent' and valid_until < now() ${requestId ? tx`and request_id = ${requestId}` : tx``}
    returning id, request_id`;
  for (const q of expired) {
    await recordEvent(tx, { entityType: "quote", entityId: q.id, action: "status", from: "sent", to: "expired" });
    await reopenIfNoQuotes(tx, q.request_id);
  }
  return expired.length;
}

/**
 * Aceptación atómica: bloquea la solicitud (serializa aceptaciones concurrentes), valida vigencia y estado,
 * crea UNA orden de trabajo con copia inmutable del contrato y el cobro correspondiente.
 * Es idempotente: si el mismo presupuesto ya fue aceptado, devuelve el trabajo existente.
 */
export async function acceptQuote(actor: Actor, quoteId: string, confirmation: { totalMinor: number; acceptedTerms: boolean }) {
  if (!confirmation.acceptedTerms) throw invalid("Para contratar tenés que aceptar el alcance y las condiciones.");
  try {
    return await acceptQuoteTx(actor, quoteId, confirmation);
  } catch (e) {
    // El vencimiento se registra aunque la aceptación se revierta.
    if (e instanceof DomainError && e.code === "expired") await systemTx((tx) => expireQuotes(tx));
    throw e;
  }
}

async function acceptQuoteTx(actor: Actor, quoteId: string, confirmation: { totalMinor: number; acceptedTerms: boolean }) {
  return systemTx(async (tx) => {
    const [qRef] = await tx<{ request_id: string }[]>`select request_id from quotes where id = ${quoteId}`;
    if (!qRef) throw notFound();
    const [req] = await tx<{ id: string; status: RequestStatus; created_by: string; organization_id: string | null; property_id: string; category_id: string | null; code: string; title: string; description: string }[]>`
      select id, status, created_by, organization_id, property_id, category_id, code, title, description
      from service_requests where id = ${qRef.request_id} for update`;
    if (!(await check(tx, "is_request_client", actor, req.id))) throw forbidden();

    const [q] = await tx<{
      id: string; status: QuoteStatus; provider_id: string; valid_until: Date; mode: "fixed" | "quote" | "diagnostic"; scope: string; exclusions: string;
      materials_included: boolean; proposed_date: string | null; proposed_window: string | null; labor_minor: number; materials_minor: number;
      visit_minor: number; subtotal_minor: number; client_fee_minor: number; client_fee_tax_minor: number; provider_fee_minor: number;
      total_minor: number; provider_net_minor: number; provider_rate_bps: number; client_rate_bps: number; client_fee_tax_bps: number;
      cancellation_terms: string; sent_at: Date;
    }[]>`select * from quotes where id = ${quoteId} for update`;

    if (q.status === "accepted") {
      const [existing] = await tx<{ id: string }[]>`select id from jobs where quote_id = ${quoteId}`;
      const [charge] = await tx<{ checkout_url: string | null; status: string }[]>`select checkout_url, status from charges where job_id = ${existing.id} order by created_at desc limit 1`;
      return { jobId: existing.id, checkoutUrl: charge?.status === "pending" ? charge.checkout_url : null, alreadyAccepted: true };
    }
    if (req.status === "converted") throw conflict("Esta solicitud ya fue contratada con otro presupuesto.");
    if (q.status !== "sent") throw invalid(q.status === "expired" ? "Este presupuesto está vencido." : "Este presupuesto ya no está disponible.");
    if (new Date(q.valid_until) < new Date()) {
      throw new DomainError("expired", "Este presupuesto venció. Podés pedirle al profesional que lo actualice.");
    }
    // El total confirmado en pantalla tiene que coincidir con el del servidor (evita cambios de precio inadvertidos).
    if (confirmation.totalMinor !== q.total_minor) throw conflict("El total cambió. Revisá el presupuesto antes de confirmar.");
    const items = await tx<{ kind: string; description: string; quantity: number; unit_price_minor: number; amount_minor: number }[]>`
      select kind, description, quantity, unit_price_minor, amount_minor from quote_items where quote_id = ${quoteId} order by sort`;
    const itemsTotal = items.reduce((s, i) => s + i.amount_minor, 0);
    if (itemsTotal !== q.subtotal_minor) throw new Error("Inconsistencia de importes en el presupuesto");

    const [prov] = await tx<{ status: string; display_name: string; payout_account_ref: string | null }[]>`
      select status, display_name, payout_account_ref from providers where id = ${q.provider_id}`;
    if (prov.status !== "approved") throw new DomainError("not_eligible", "Este profesional no está habilitado en este momento.");
    const [{ own }] = await tx<{ own: string | null }[]>`select app.provider_role(${actor.id}, ${q.provider_id}) as own`;
    if (own) throw invalid("No podés contratar a un proveedor del que formás parte.");

    assertTransition(quoteMachine, "sent", "accepted", "client");
    assertTransition(requestMachine, req.status, "converted", "client");
    await tx`update quotes set status = 'accepted', decided_at = now() where id = ${quoteId}`;
    const others = await tx<{ id: string; provider_id: string }[]>`
      update quotes set status = 'rejected', decided_at = now() where request_id = ${req.id} and status = 'sent' and id <> ${quoteId} returning id, provider_id`;
    await tx`update request_invitations set status = 'closed' where request_id = ${req.id} and status in ('invited','viewed')`;
    await tx`update service_requests set status = 'converted' where id = ${req.id}`;

    const snapshot = {
      version: 1,
      acceptedAt: new Date().toISOString(),
      acceptedBy: actor.id,
      request: { code: req.code, title: req.title, description: req.description },
      provider: { id: q.provider_id, name: prov.display_name },
      quote: {
        id: q.id, mode: q.mode, scope: q.scope, exclusions: q.exclusions, materialsIncluded: q.materials_included,
        proposedDate: q.proposed_date, proposedWindow: q.proposed_window, sentAt: q.sent_at, validUntil: q.valid_until,
      },
      items,
      amounts: {
        currency: "ARS", laborMinor: q.labor_minor, materialsMinor: q.materials_minor, visitMinor: q.visit_minor,
        subtotalMinor: q.subtotal_minor, clientFeeMinor: q.client_fee_minor, clientFeeTaxMinor: q.client_fee_tax_minor,
        providerFeeMinor: q.provider_fee_minor, totalMinor: q.total_minor, providerNetMinor: q.provider_net_minor,
        providerRateBps: q.provider_rate_bps, clientRateBps: q.client_rate_bps, clientFeeTaxBps: q.client_fee_tax_bps,
      },
      cancellationTerms: q.cancellation_terms,
    };
    const [job] = await tx<{ id: string; code: string }[]>`
      insert into jobs (request_id, quote_id, provider_id, client_user_id, organization_id, property_id, category_id, mode,
        scheduled_date, scheduled_window, contract_snapshot, total_minor, provider_net_minor)
      values (${req.id}, ${quoteId}, ${q.provider_id}, ${req.created_by}, ${req.organization_id}, ${req.property_id}, ${req.category_id},
        ${q.mode}, ${q.proposed_date}, ${q.proposed_window}, ${tx.json(snapshot as never)}, ${q.total_minor}, ${q.provider_net_minor})
      returning id, code`;
    await tx`update conversations set job_id = ${job.id} where request_id = ${req.id} and provider_id = ${q.provider_id}`;

    const charge = await createCharge(tx, {
      jobId: job.id,
      kind: q.mode === "diagnostic" ? "visit" : "job_total",
      amountMinor: q.total_minor,
      clientFeeMinor: q.client_fee_minor,
      taxMinor: q.client_fee_tax_minor,
      providerFeeMinor: q.provider_fee_minor,
      providerNetMinor: q.provider_net_minor,
      payerUserId: actor.id,
      description: `${job.code} · ${req.title}`,
      payoutAccountRef: prov.payout_account_ref,
    });

    await recordEvent(tx, { entityType: "quote", entityId: quoteId, action: "status", from: "sent", to: "accepted", actorId: actor.id });
    await recordEvent(tx, { entityType: "request", entityId: req.id, action: "status", from: req.status, to: "converted", actorId: actor.id });
    await recordEvent(tx, { entityType: "job", entityId: job.id, action: "created", to: "pending_confirmation", actorId: actor.id, data: { quoteId } });
    for (const o of others) {
      await recordEvent(tx, { entityType: "quote", entityId: o.id, action: "status", from: "sent", to: "rejected", reason: "Se eligió otro presupuesto" });
      await notify(tx, await providerRecipients(tx, o.provider_id), { type: "quote_received", title: `El cliente eligió otro presupuesto · ${req.code}`, link: "/proveedor/oportunidades" });
    }
    await notify(tx, await providerRecipients(tx, q.provider_id), {
      type: "quote_accepted",
      title: `¡Te contrataron! · ${job.code}`,
      body: "El cliente aceptó tu presupuesto. Vas a poder confirmar el trabajo cuando se registre el pago.",
      link: `/proveedor/trabajos/${job.id}`,
    });
    await audit(tx, actor, "quote.accept", "job", job.id, null, { quoteId, totalMinor: q.total_minor });
    return { jobId: job.id, checkoutUrl: charge.checkout_url, alreadyAccepted: false };
  });
}
