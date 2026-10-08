import { cn } from "@/lib/cn";

export function Card({ className, as: As = "div", ...props }: React.HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "article" | "li" }) {
  return <As className={cn("rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-6", className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-4 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, eyebrow, action, back }: { title: React.ReactNode; description?: React.ReactNode; eyebrow?: React.ReactNode; action?: React.ReactNode; back?: React.ReactNode }) {
  return (
    <header className="mb-6 sm:mb-8">
      {back && <div className="mb-3">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1.5 text-sm font-semibold text-fixy-700">{eyebrow}</div>}
          <h1 className="text-[1.65rem] font-extrabold text-ink sm:text-3xl">{title}</h1>
          {description && <p className="mt-1.5 max-w-2xl text-muted">{description}</p>}
        </div>
        {action && <div className="flex flex-wrap gap-2">{action}</div>}
      </div>
    </header>
  );
}

export function Stat({ label, value, hint, tone = "default" }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "ok" | "warn" }) {
  return (
    <div className={cn("rounded-2xl p-4 ring-1", tone === "ok" ? "bg-ok-bg/60 ring-ok/10" : tone === "warn" ? "bg-warn-bg/70 ring-warn/10" : "bg-white ring-line")}>
      <div className="text-sm text-muted">{label}</div>
      <div className="tabular mt-1 font-display text-2xl font-extrabold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function DefinitionList({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2.5 text-[15px]">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
