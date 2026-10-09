/** Gráficos simples del panel (SVG en el servidor): una serie por gráfico, valor al pasar el mouse y tabla accesible. */
import { cn } from "@/lib/cn";

type Point = { week: string; value: number };

export function WeeklyBars({ title, points, format = (n) => n.toLocaleString("es-AR"), className }: {
  title: string; points: Point[]; format?: (n: number) => string; className?: string;
}) {
  const W = 560, H = 180, padL = 4, padB = 22, padT = 18;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = (W - padL) / points.length;
  const bw = Math.max(6, step - 8);
  const total = points.reduce((s, p) => s + p.value, 0);
  const last = points[points.length - 1]?.value ?? 0;
  return (
    <figure className={cn("rounded-[var(--radius-card)] bg-white p-5 ring-1 ring-line", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold text-ink">{title}</span>
        <span className="text-sm text-muted">Última semana: <strong className="tabular text-ink">{format(last)}</strong> · 12 semanas: <span className="tabular">{format(total)}</span></span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label={`${title}, últimas 12 semanas`}>
        <line x1={0} x2={W} y1={H - padB} y2={H - padB} stroke="var(--color-line)" strokeWidth={1} />
        {points.map((p, i) => {
          const h = p.value ? Math.max(3, ((H - padB - padT) * p.value) / max) : 0;
          const x = padL + i * step + (step - bw) / 2;
          const y = H - padB - h;
          const r = Math.min(4, bw / 2, h);
          return (
            <g key={p.week} className="group">
              <title>{`Semana del ${p.week}: ${format(p.value)}`}</title>
              <rect x={padL + i * step} y={padT - 10} width={step} height={H - padT + 10} fill="transparent" />
              {h > 0 && <path d={`M${x},${H - padB} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${H - padB} Z`} className="fill-fixy-600 transition-opacity group-hover:fill-fixy-800" />}
              {(i === 0 || i === points.length - 1 || i === points.length - 7) && (
                <text x={x + bw / 2} y={H - 6} textAnchor="middle" className="fill-muted" fontSize={11}>{p.week}</text>
              )}
              {p.value === max && p.value > 0 && <text x={x + bw / 2} y={y - 5} textAnchor="middle" className="fill-ink-2" fontSize={11}>{format(p.value)}</text>}
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted">Ver como tabla</summary>
        <table className="tabular mt-2 w-full text-left">
          <thead className="text-muted"><tr><th className="py-1 font-semibold">Semana</th><th className="py-1 text-right font-semibold">Valor</th></tr></thead>
          <tbody>{points.map((p) => <tr key={p.week} className="border-t border-line"><td className="py-1">{p.week}</td><td className="py-1 text-right">{format(p.value)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** Embudo: barras horizontales con el % respecto del primer paso y, entre paréntesis, la caída contra el paso anterior. */
export function Funnel({ steps }: { steps: { label: string; value: number }[] }) {
  const top = Math.max(1, steps[0]?.value ?? 0);
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const pct = Math.round((s.value / top) * 100);
        const prev = i > 0 ? steps[i - 1].value : null;
        const drop = prev && prev > 0 ? Math.round(((prev - s.value) / prev) * 100) : null;
        return (
          <li key={s.label} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-ink-2">{s.label}</span>
              <span className="tabular shrink-0 text-right"><strong className="text-ink">{s.value.toLocaleString("es-AR")}</strong> <span className="text-muted">· {pct} %</span>{drop !== null && drop > 0 && <span className="text-xs text-muted"> (−{drop} %)</span>}</span>
            </div>
            <span className="mt-1 block h-3 overflow-hidden rounded-r-[4px] bg-fixy-50" title={`${s.label}: ${s.value} (${pct} %)`}>
              <span className="block h-full rounded-r-[4px] bg-fixy-600" style={{ width: `${s.value ? Math.max(pct, 1.5) : 0}%` }} />
            </span>
          </li>
        );
      })}
    </ol>
  );
}
