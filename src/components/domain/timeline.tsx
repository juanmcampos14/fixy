import type { TimelineEvent } from "@/server/queries/shared";
import { formatDateTime } from "@/lib/format";
import { disputeStatusLabel, jobStatusLabel, jobStatusLabelProvider, providerStatusLabel, requestStatusLabel } from "@/server/domain/labels";

const ACTION_LABEL: Record<string, string> = {
  created: "Creado",
  matching_run: "Búsqueda de profesionales",
  invitation_declined: "Un profesional no tomó el pedido",
  quote_received: "Presupuesto recibido",
  category_set: "Categoría asignada por el equipo",
  payment_approved: "Pago acreditado",
  extra_paid: "Adicional pagado",
  technician_assigned: "Técnico asignado",
  evidence_added: "Avance registrado",
  extra_proposed: "Adicional propuesto",
  extra_accepted: "Adicional aceptado",
  extra_rejected: "Adicional rechazado",
  extra_withdrawn: "Adicional retirado",
  reschedule_proposed: "Reprogramación propuesta",
  reschedule_accepted: "Reprogramación acordada",
  reschedule_rejected: "Reprogramación rechazada",
  reschedule_withdrawn: "Reprogramación retirada",
  dispute_opened: "Reclamo abierto",
  opened: "Reclamo abierto",
  submitted: "Enviado a revisión",
  review_approve: "Aprobado",
  review_observe: "Observado",
  review_reject: "Rechazado",
  review_suspend: "Suspendido",
  review_reinstate: "Rehabilitado",
};

export function Timeline({ events, kind = "job", audience = "client" }: { events: TimelineEvent[]; kind?: "job" | "request" | "dispute" | "provider"; audience?: "client" | "provider" | "staff" }) {
  const labels = { job: audience === "client" ? jobStatusLabel : jobStatusLabelProvider, request: requestStatusLabel, dispute: disputeStatusLabel, provider: providerStatusLabel }[kind];
  if (!events.length) return <p className="text-sm text-muted">Sin eventos todavía.</p>;
  return (
    <ol className="relative space-y-4 border-l-2 border-line pl-5">
      {events.map((e) => {
        const title = e.action === "status" && e.to_state ? labels[e.to_state] ?? e.to_state : ACTION_LABEL[e.action] ?? e.action;
        return (
          <li key={e.id} className="relative">
            <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-fixy-500 ring-1 ring-fixy-200" aria-hidden />
            <p className="font-semibold leading-snug">{title}</p>
            <p className="text-xs text-muted">
              {formatDateTime(e.created_at)}
              {e.actor_name && <> · {e.actor_name}</>}
              {e.actor_role === "staff" || e.actor_role === "operator" || e.actor_role === "admin" ? " (equipo Fixy)" : ""}
            </p>
            {e.reason && <p className="mt-0.5 text-sm text-ink-2">{e.reason}</p>}
          </li>
        );
      })}
    </ol>
  );
}
