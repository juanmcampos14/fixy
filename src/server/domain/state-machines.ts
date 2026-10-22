/**
 * Máquinas de estado. Las transiciones válidas se replican en la base (app.allowed_transitions),
 * que las hace cumplir con triggers; acá además se definen los actores autorizados.
 * Documentación: docs/state-machines.md
 */
import { DomainError } from "./errors";

export type ActorSide = "client" | "provider" | "technician" | "staff" | "system";

type Machine<S extends string> = Record<S, Partial<Record<S, readonly ActorSide[]>>>;

export const REQUEST_STATES = ["draft", "submitted", "searching", "with_quotes", "converted", "cancelled", "no_coverage"] as const;
export type RequestStatus = (typeof REQUEST_STATES)[number];
export const requestMachine: Machine<RequestStatus> = {
  draft: { submitted: ["client"], cancelled: ["client"] },
  submitted: { searching: ["system", "staff"], no_coverage: ["system", "staff"], cancelled: ["client", "staff"] },
  searching: { with_quotes: ["system"], no_coverage: ["system", "staff"], cancelled: ["client", "staff"] },
  no_coverage: { searching: ["staff", "system"], cancelled: ["client", "staff"] },
  with_quotes: { converted: ["client"], searching: ["system", "staff"], cancelled: ["client", "staff"] },
  converted: {},
  cancelled: {},
};

export const QUOTE_STATES = ["draft", "sent", "accepted", "rejected", "expired", "withdrawn"] as const;
export type QuoteStatus = (typeof QUOTE_STATES)[number];
export const quoteMachine: Machine<QuoteStatus> = {
  draft: { sent: ["provider"], withdrawn: ["provider"] },
  sent: { accepted: ["client"], rejected: ["client", "system"], expired: ["system"], withdrawn: ["provider", "staff"] },
  accepted: {},
  rejected: {},
  expired: {},
  withdrawn: {},
};

export const JOB_STATES = ["pending_confirmation", "confirmed", "on_the_way", "in_progress", "pending_approval", "completed", "cancelled"] as const;
export type JobStatus = (typeof JOB_STATES)[number];
export const jobMachine: Machine<JobStatus> = {
  // "system": reserva directa que el profesional ya aceptó y se confirma sola al pagarse (o si la visita es sin cargo).
  pending_confirmation: { confirmed: ["provider", "system"], cancelled: ["client", "provider", "staff"] },
  confirmed: { on_the_way: ["provider", "technician"], in_progress: ["provider", "technician"], cancelled: ["staff"] },
  on_the_way: { in_progress: ["provider", "technician"], cancelled: ["staff"] },
  in_progress: { pending_approval: ["provider", "technician"], cancelled: ["staff"] },
  pending_approval: { completed: ["client", "staff"], in_progress: ["staff"], cancelled: ["staff"] },
  completed: {},
  cancelled: {},
};

export const CHARGE_STATES = ["pending", "processing", "approved", "failed", "partially_refunded", "refunded"] as const;
export type ChargeStatus = (typeof CHARGE_STATES)[number];
export const chargeMachine: Machine<ChargeStatus> = {
  pending: { processing: ["system"], approved: ["system"], failed: ["system"] },
  processing: { approved: ["system"], failed: ["system"] },
  approved: { partially_refunded: ["system"], refunded: ["system"] },
  partially_refunded: { refunded: ["system"] },
  failed: {},
  refunded: {},
};
/** Orden de avance de un cobro, para descartar eventos de la pasarela fuera de orden. */
export const CHARGE_RANK: Record<ChargeStatus, number> = {
  pending: 0,
  processing: 1,
  failed: 2,
  approved: 3,
  partially_refunded: 4,
  refunded: 5,
};

export const PAYOUT_STATES = ["pending", "scheduled", "processing", "paid", "failed", "reversed"] as const;
export type PayoutStatus = (typeof PAYOUT_STATES)[number];
export const payoutMachine: Machine<PayoutStatus> = {
  pending: { scheduled: ["staff", "system"], failed: ["system"] },
  scheduled: { processing: ["system", "staff"], pending: ["staff"], failed: ["system"] },
  processing: { paid: ["system"], failed: ["system"] },
  failed: { scheduled: ["staff"] },
  paid: { reversed: ["staff"] },
  reversed: {},
};

export const DISPUTE_STATES = ["open", "in_review", "awaiting_response", "resolved", "closed"] as const;
export type DisputeStatus = (typeof DISPUTE_STATES)[number];
export const disputeMachine: Machine<DisputeStatus> = {
  open: { in_review: ["staff"], awaiting_response: ["staff"], resolved: ["staff"], closed: ["staff"] },
  in_review: { awaiting_response: ["staff"], resolved: ["staff"], closed: ["staff"] },
  awaiting_response: { in_review: ["staff", "system"], resolved: ["staff"], closed: ["staff"] },
  resolved: { closed: ["staff", "system"], in_review: ["staff"] },
  closed: {},
};

export const PROVIDER_STATES = ["pending", "in_review", "approved", "rejected", "suspended"] as const;
export type ProviderStatus = (typeof PROVIDER_STATES)[number];
export const providerMachine: Machine<ProviderStatus> = {
  pending: { in_review: ["provider"] },
  in_review: { approved: ["staff"], rejected: ["staff"], pending: ["staff"] },
  approved: { suspended: ["staff"] },
  suspended: { approved: ["staff"] },
  rejected: { pending: ["provider"] },
};

export function canTransition<S extends string>(m: Machine<S>, from: S, to: S, side?: ActorSide): boolean {
  const allowed = m[from]?.[to];
  if (!allowed) return false;
  return side ? allowed.includes(side) : true;
}

export function assertTransition<S extends string>(m: Machine<S>, from: S, to: S, side: ActorSide): void {
  if (!canTransition(m, from, to)) {
    throw new DomainError("invalid_transition", "Esa acción no es válida en el estado actual.");
  }
  if (!canTransition(m, from, to, side)) {
    throw new DomainError("forbidden", "No tenés permiso para realizar este cambio de estado.");
  }
}
