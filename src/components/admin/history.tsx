import type { TimelineEvent } from "@/server/queries/shared";
import type { AuditRow } from "@/server/queries/admin";
import { formatDateTime } from "@/lib/format";
import { EventList, JsonCompact } from "./ui";

const ACTION_LABEL: Record<string, string> = {
  created: "Creado",
  submitted: "Enviado a revisión",
  review_approve: "Aprobado por el equipo",
  review_observe: "Observado: vuelve a pendiente",
  review_reject: "Rechazado",
  review_suspend: "Suspendido",
  review_reinstate: "Rehabilitado",
  matching_run: "Búsqueda de profesionales",
  invitation_declined: "Un profesional no tomó el pedido",
  category_set: "Categoría asignada por el equipo",
  opened: "Reclamo abierto",
  hold: "Liquidación retenida",
  release: "Liquidación liberada",
  adjusted_by_refund: "Ajuste por reembolso",
  gateway_update: "Actualización de la pasarela",
  refund: "Reembolso",
};

/** Convierte eventos de entity_events en ítems legibles con las etiquetas de estado de la entidad. */
export function EntityHistory({ events, labels, empty }: { events: TimelineEvent[]; labels: Record<string, string>; empty?: string }) {
  return (
    <EventList
      empty={empty}
      items={events.map((e) => ({
        id: e.id,
        title:
          e.action === "status" || (e.to_state && !ACTION_LABEL[e.action])
            ? `${e.from_state ? `${labels[e.from_state] ?? e.from_state} → ` : ""}${labels[e.to_state ?? ""] ?? e.to_state ?? e.action}`
            : ACTION_LABEL[e.action] ?? e.action,
        created_at: e.created_at,
        actor_name: e.actor_name,
        actor_role: e.actor_role,
        reason: e.reason,
      }))}
    />
  );
}

export function AuditEntries({ rows }: { rows: AuditRow[] }) {
  if (!rows.length) return <p className="text-sm text-muted">Sin intervenciones registradas.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((a) => (
        <li key={a.id} className="py-3 text-[15px]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <code className="font-mono text-sm font-semibold text-ink">{a.action}</code>
            <span className="text-xs text-muted">{formatDateTime(a.created_at)} · {a.actor_name ?? "Sistema"}{a.actor_role ? ` (${a.actor_role === "admin" ? "admin" : a.actor_role === "operator" ? "operación" : a.actor_role})` : ""}</span>
          </div>
          {a.reason && <p className="mt-1 text-ink-2">{a.reason}</p>}
          {a.data && Object.keys(a.data).length > 0 && <div className="mt-1"><JsonCompact value={a.data} /></div>}
        </li>
      ))}
    </ul>
  );
}
