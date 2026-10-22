import Link from "next/link";
import { CircleAlert, Star, TrendingUp } from "lucide-react";
import type { ProviderReach } from "@/server/modules/provider-reach";
import { Card, CardHeader } from "@/components/ui/card";

/** "¿Cómo te llegan los pedidos?": qué lo deja afuera, qué lo sube y cómo le va en cada rubro. */
export function ReachCard({ reach }: { reach: ProviderReach }) {
  const blockers = reach.tips.filter((t) => t.kind === "blocker");
  const boosts = reach.tips.filter((t) => t.kind === "boost").slice(0, 4);
  const primary = reach.categories.find((c) => c.primary);
  return (
    <Card as="section" aria-labelledby="reach-t">
      <CardHeader title={<span id="reach-t">¿Cómo te llegan los pedidos?</span>}
        description="Fixy te manda pedidos de tus rubros y zonas. Primero van los verificados; después, según disponibilidad, estrellas en ese rubro, trabajos en curso, cercanía y perfil completo. Tu rubro principal va adelante." />

      <dl className="grid grid-cols-3 gap-3 text-center">
        <Stat label="Pedidos en tus rubros y zonas" value={reach.stats.demand30d} />
        <Stat label="Te llegaron" value={reach.stats.invitations30d} />
        <Stat label="Respondiste" value={reach.stats.answered30d} />
      </dl>
      <p className="mt-1 text-center text-xs text-muted">Últimos 30 días</p>

      {blockers.length > 0 && (
        <ul className="mt-5 space-y-2">
          {blockers.map((t) => (
            <li key={t.key} className="flex flex-wrap items-start gap-3 rounded-2xl bg-danger-bg px-4 py-3">
              <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
              <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{t.title}</p><p className="text-sm text-ink-2">{t.detail}</p></div>
              <Link href={t.href} className="text-sm font-semibold text-fixy-800 underline">{t.action}</Link>
            </li>
          ))}
        </ul>
      )}

      {boosts.length > 0 && (
        <>
          <h3 className="mt-5 text-[15px] font-semibold">Para aparecer más arriba</h3>
          <ul className="mt-2 space-y-2">
            {boosts.map((t) => (
              <li key={t.key} className="flex flex-wrap items-start gap-3 rounded-2xl bg-cream-2 px-4 py-3">
                <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-fixy-800" aria-hidden />
                <div className="min-w-0 flex-1"><p className="font-semibold text-ink">{t.title}</p><p className="text-sm text-ink-2">{t.detail}</p></div>
                <Link href={t.href} className="text-sm font-semibold text-fixy-800 underline">{t.action}</Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {reach.categories.length > 0 && (
        <>
          <h3 className="mt-5 text-[15px] font-semibold">Tus rubros</h3>
          <ul className="mt-2 divide-y divide-line">
            {reach.categories.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="font-medium">
                  {c.name}
                  {c.primary && <span className="ml-2 rounded-full bg-fixy-700 px-2 py-0.5 text-[11px] font-semibold text-white">Principal</span>}
                </span>
                <span className="flex flex-wrap items-center gap-3 text-sm text-muted">
                  {c.reviews ? <span className="inline-flex items-center gap-1 font-semibold text-ink"><Star className="h-4 w-4 fill-spark text-spark" aria-hidden />{c.rating} <span className="font-normal text-muted">({c.reviews})</span></span> : <span>Sin reseñas</span>}
                  <span>{c.demand30d} pedidos · te llegaron {c.invitations30d}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted">Las estrellas son por rubro: las reseñas de un trabajo de pintura no cuentan para electricidad. <Link href="/proveedor/alta#servicios" className="underline">Cambiar rubros o el principal</Link></p>
        </>
      )}

      {primary && reach.missedZones.length > 0 && (
        <p className="mt-4 rounded-2xl bg-cream-2 px-4 py-3 text-sm text-ink-2">
          En <strong className="text-ink">{primary.name}</strong> hubo pedidos en zonas que no cubrís:{" "}
          {reach.missedZones.map((z) => `${z.name} (${z.requests})`).join(", ")}. Si llegás, <Link href="/proveedor/alta#servicios" className="font-semibold text-fixy-800 underline">sumalas</Link>.
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-cream-2 px-2 py-3">
      <dd className="text-2xl tabular text-ink">{value}</dd>
      <dt className="mt-0.5 text-xs text-muted">{label}</dt>
    </div>
  );
}
