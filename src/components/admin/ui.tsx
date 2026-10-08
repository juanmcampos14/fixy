import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { buttonClass } from "@/components/ui/button";

/** Horas transcurridas desde una fecha (para alertas de plazo en server components). */
export function hoursSince(d: Date | string): number {
  return (Date.now() - new Date(d).getTime()) / 3600_000;
}

/** Barra de filtros (GET): funciona sin JavaScript y deja la URL compartible. */
export function FilterBar({ action, children, clearHref }: { action: string; children: React.ReactNode; clearHref?: string }) {
  return (
    <form action={action} method="get" role="search" className="mb-5 flex flex-wrap items-end gap-3 rounded-2xl bg-white p-4 ring-1 ring-line">
      {children}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("primary", "md")}>Filtrar</button>
        {clearHref && <Link href={clearHref} className={buttonClass("ghost", "md")}>Limpiar</Link>}
      </div>
    </form>
  );
}

export function FilterField({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-40 flex-1 space-y-1", className)}>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-ink">{label}</label>
      {children}
    </div>
  );
}

/** Tabla con desplazamiento horizontal en pantallas chicas (la página nunca se desborda). */
export function DataTable({ children, minWidth = 760, caption }: { children: React.ReactNode; minWidth?: number; caption?: string }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-white ring-1 ring-line" tabIndex={0} aria-label={caption ? `${caption} (desplazable)` : undefined}>
      <table className="w-full text-left text-[15px]" style={{ minWidth }}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th scope="col" className={cn("border-b border-line bg-cream/60 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted", className)}>{children}</th>;
}

export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={cn("border-b border-line px-3 py-3 align-top", className)}>{children}</td>;
}

export function Tabs({ items, current }: { items: { key: string; label: string; href: string; badge?: number }[]; current: string }) {
  return (
    <nav aria-label="Secciones" className="-mx-4 mb-5 overflow-x-auto px-4">
      <ul className="flex gap-1.5">
        {items.map((t) => (
          <li key={t.key}>
            <Link
              href={t.href}
              aria-current={t.key === current ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-sm font-semibold ring-1",
                t.key === current ? "bg-ink text-white ring-ink" : "bg-white text-ink ring-line hover:ring-fixy-500",
              )}
            >
              {t.label}
              {!!t.badge && <span className="rounded-full bg-spark px-1.5 text-xs font-bold text-ink">{t.badge}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-fixy-800 hover:underline">
      <ChevronLeft className="h-4 w-4" aria-hidden /> {children}
    </Link>
  );
}

/** JSON compacto para registros de auditoría (truncado, sin formato). */
export function JsonCompact({ value, max = 280 }: { value: unknown; max?: number }) {
  if (value == null || (typeof value === "object" && Object.keys(value as object).length === 0)) return <span className="text-muted">—</span>;
  const s = JSON.stringify(value);
  return (
    <code className="block max-w-full break-all rounded-lg bg-cream/70 px-2 py-1 font-mono text-xs text-ink-2" title={s.length > max ? s : undefined}>
      {s.length > max ? `${s.slice(0, max)}…` : s}
    </code>
  );
}

export type EventItem = { id: number | string; title: string; created_at: Date; actor_name: string | null; actor_role: string | null; reason: string | null; detail?: React.ReactNode };

/** Historial genérico (estados y acciones) para operación. */
export function EventList({ items, empty = "Sin eventos registrados." }: { items: EventItem[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ol className="relative space-y-4 border-l-2 border-line pl-5">
      {items.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-fixy-500 ring-1 ring-fixy-200" aria-hidden />
          <p className="font-semibold leading-snug">{e.title}</p>
          <p className="text-xs text-muted">
            {formatDateTime(e.created_at)}
            {e.actor_name && <> · {e.actor_name}</>}
            {e.actor_role && ["staff", "operator", "admin"].includes(e.actor_role) ? " (equipo Fixy)" : ""}
          </p>
          {e.reason && <p className="mt-0.5 text-sm text-ink-2">{e.reason}</p>}
          {e.detail}
        </li>
      ))}
    </ol>
  );
}

export function Pagination({ basePath, params, page, hasMore }: { basePath: string; params: Record<string, string | undefined>; page: number; hasMore: boolean }) {
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    if (p > 1) q.set("pagina", String(p));
    const s = q.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <nav aria-label="Paginación" className="mt-5 flex items-center justify-between gap-3">
      {page > 1 ? <Link href={href(page - 1)} className={buttonClass("secondary", "md")}>Anterior</Link> : <span />}
      <span className="text-sm text-muted">Página {page}</span>
      {hasMore ? <Link href={href(page + 1)} className={buttonClass("secondary", "md")}>Siguiente</Link> : <span />}
    </nav>
  );
}

/** Contenedor de sección con título (para páginas de detalle). */
export function Section({ title, description, action, children, className, id }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={cn("rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-6", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={id} className="text-lg font-bold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted">{children}</span>;
}
