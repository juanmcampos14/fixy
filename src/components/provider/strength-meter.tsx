import { CheckCircle2, Circle, TrendingUp } from "lucide-react";
import type { StrengthItem } from "@/lib/profile-strength";
import { cn } from "@/lib/cn";

/** Barra de "fuerza del perfil" con los próximos pasos que más suman. Sirve en servidor y en cliente. */
export function StrengthMeter({ score, level, items, max = 4, compact, links = true, className }: {
  score: number; level: string; items: StrengthItem[]; max?: number; compact?: boolean; links?: boolean; className?: string;
}) {
  const pending = items.filter((i) => i.earned < i.points).sort((a, b) => (b.points - b.earned) - (a.points - a.earned));
  const tone = score >= 70 ? "bg-fixy-600" : score >= 40 ? "bg-fixy-500" : "bg-warn";
  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted">Fuerza de tu perfil</p>
          <p className="text-2xl font-extrabold tabular">{score}% <span className="text-base font-semibold text-ink-2">· {level}</span></p>
        </div>
        <TrendingUp className="h-7 w-7 text-fixy-700" aria-hidden />
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-fixy-50 ring-1 ring-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Fuerza del perfil">
        <div className={cn("h-full rounded-full transition-all duration-500", tone)} style={{ width: `${Math.max(score, 3)}%` }} />
      </div>
      <p className="text-sm text-ink-2">Los perfiles más completos aparecen más arriba cuando un cliente elige profesional, y reciben más pedidos.</p>
      {!compact && pending.length > 0 && (
        <ul className="space-y-1.5">
          {pending.slice(0, max).map((i) => (
            <li key={i.key}>
              <a href={links ? i.href : undefined} className={cn("group flex items-start gap-2 rounded-xl px-2 py-1.5", links && "hover:bg-fixy-50")}>
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn("font-semibold", links && "group-hover:underline")}>{i.label}</span>
                  <span className="block text-sm text-muted">{i.hint}</span>
                </span>
                <span className="shrink-0 rounded-full bg-fixy-50 px-2 py-0.5 text-xs font-bold text-fixy-800">+{i.points - i.earned}%</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {!compact && pending.length === 0 && (
        <p className="flex items-center gap-2 font-semibold text-ok"><CheckCircle2 className="h-5 w-5" aria-hidden />¡Perfil completo! Mantené tus fotos y precios al día.</p>
      )}
    </div>
  );
}
