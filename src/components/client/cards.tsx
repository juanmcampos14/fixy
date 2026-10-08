import Link from "next/link";
import { ChevronRight, CalendarDays } from "lucide-react";
import type { JobListItem, RequestListItem } from "@/server/queries/client";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { jobStatusLabel, requestStatusLabel } from "@/server/domain/labels";
import { formatDate, formatMoney, relativeTime } from "@/lib/format";

export function RequestRow({ r }: { r: RequestListItem }) {
  const href = r.job_id ? `/app/trabajos/${r.job_id}` : `/app/solicitudes/${r.id}`;
  return (
    <li>
      <Link href={href} className="flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-line transition hover:ring-fixy-500">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} labels={requestStatusLabel} />
            {r.status === "with_quotes" && <Badge tone="brand" icon={false}>{r.quotes} presupuesto{r.quotes === 1 ? "" : "s"}</Badge>}
            {r.needs_review && r.status === "submitted" && <Badge tone="info" icon={false}>En revisión por el equipo</Badge>}
          </div>
          <p className="mt-1.5 truncate font-semibold">{r.title}</p>
          <p className="text-sm text-muted">{r.code} · {r.property_label}{r.category_name ? ` · ${r.category_name}` : ""} · {relativeTime(r.created_at)}</p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}

export function JobRow({ j, base = "/app/trabajos" }: { j: JobListItem; base?: string }) {
  const action =
    j.pending_charge ? "Pago pendiente" :
    j.pending_extras ? "Adicional para aprobar" :
    j.open_reschedule ? "Reprogramación para responder" :
    j.status === "pending_approval" ? "Confirmá o reclamá" :
    j.status === "completed" && !j.has_review ? "Calificá el trabajo" : null;
  return (
    <li>
      <Link href={`${base}/${j.id}`} className="flex items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-line transition hover:ring-fixy-500">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={j.status} labels={jobStatusLabel} />
            {j.open_dispute && <Badge tone="warn">Reclamo abierto</Badge>}
            {action && <Badge tone="warn" icon={false}>{action}</Badge>}
          </div>
          <p className="mt-1.5 truncate font-semibold">{j.title}</p>
          <p className="text-sm text-muted">
            {j.code} · {j.provider_name} · {j.property_label}
            {j.scheduled_date && <span className="inline-flex items-center gap-1"> · <CalendarDays className="h-3.5 w-3.5" aria-hidden />{formatDate(j.scheduled_date)}</span>}
          </p>
        </div>
        <div className="text-right">
          <p className="tabular font-semibold">{formatMoney(j.total_minor)}</p>
          <ChevronRight className="ml-auto mt-1 h-5 w-5 text-muted" aria-hidden />
        </div>
      </Link>
    </li>
  );
}
