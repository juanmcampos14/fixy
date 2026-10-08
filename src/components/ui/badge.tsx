import { CircleCheck, Clock, CircleX, TriangleAlert, Info, Ban, Hourglass } from "lucide-react";
import { cn } from "@/lib/cn";

export type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "brand";
const tones: Record<Tone, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  neutral: "bg-ink/[0.06] text-ink-2",
  brand: "bg-fixy-50 text-fixy-800",
};
const icons: Record<Tone, React.ComponentType<{ className?: string }> | null> = {
  ok: CircleCheck,
  warn: Clock,
  danger: CircleX,
  info: Info,
  neutral: null,
  brand: null,
};

/** Los estados siempre llevan texto (y opcionalmente ícono): nunca dependen solo del color. */
export function Badge({ tone = "neutral", children, className, icon = true }: { tone?: Tone; children: React.ReactNode; className?: string; icon?: boolean }) {
  const Icon = icon ? icons[tone] : null;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap", tones[tone], className)}>
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  // solicitudes
  draft: "neutral", submitted: "info", searching: "info", with_quotes: "brand", converted: "ok", cancelled: "neutral", no_coverage: "warn",
  // presupuestos
  sent: "brand", accepted: "ok", rejected: "neutral", expired: "neutral", withdrawn: "neutral",
  // trabajos
  pending_confirmation: "warn", confirmed: "info", on_the_way: "info", in_progress: "info", pending_approval: "warn", completed: "ok",
  // cobros / liquidaciones
  pending: "warn", processing: "info", approved: "ok", failed: "danger", partially_refunded: "info", refunded: "neutral",
  scheduled: "info", paid: "ok", reversed: "danger",
  // reclamos
  open: "warn", in_review: "info", awaiting_response: "warn", resolved: "ok", closed: "neutral",
  // proveedores
  suspended: "danger", verified: "ok", unverified: "neutral", enabled: "ok", not_started: "neutral", disabled: "danger",
};

export function StatusBadge({ status, labels, className }: { status: string; labels: Record<string, string>; className?: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? "neutral"} className={className}>
      {labels[status] ?? status}
    </Badge>
  );
}

export function TestModeBadge({ className }: { className?: string }) {
  return (
    <Badge tone="warn" className={className} icon={false}>
      <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> Modo de prueba
    </Badge>
  );
}

export function DemoBadge() {
  return <Badge tone="neutral" icon={false}>Demostración</Badge>;
}

export { Ban, Hourglass };
