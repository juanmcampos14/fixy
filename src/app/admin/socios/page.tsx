import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { requireSection } from "@/server/auth/session";
import { getPartnerDashboard, type Kpi } from "@/server/queries/partners";
import { paymentsAreTestMode } from "@/server/env";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Funnel, WeeklyBars } from "@/components/admin/charts";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Panel de socios" };
export const dynamic = "force-dynamic";

const PERIODS = [30, 90, 365] as const;
const STATUS: Record<string, string> = { pending: "Alta incompleta", in_review: "En revisión", approved: "Aprobados", rejected: "Rechazados", suspended: "Suspendidos" };
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : "—");

function Delta({ k, money }: { k: Kpi; money?: boolean }) {
  if (!k.previous && !k.current) return <span className="text-muted">sin datos</span>;
  if (!k.previous) return <span className="text-muted">sin período anterior</span>;
  const d = Math.round(((k.current - k.previous) / k.previous) * 100);
  const Icon = d > 0 ? ArrowUpRight : d < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-semibold", d > 0 ? "text-ok" : d < 0 ? "text-danger" : "text-muted")}>
      <Icon className="h-4 w-4" aria-hidden />{d > 0 ? "+" : ""}{d} % <span className="font-normal text-muted">vs. {money ? formatMoney(k.previous) : k.previous.toLocaleString("es-AR")}</span>
    </span>
  );
}

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ dias?: string }> }) {
  await requireSection("socios");
  const sp = await searchParams;
  const days = PERIODS.find((p) => String(p) === sp.dias) ?? 30;
  const d = await getPartnerDashboard(days);
  const q = d.quality;
  const k = d.kpis;
  const waShare = d.channels.byChannel.find((c) => c.channel === "whatsapp")?.n ?? 0;
  const totalChannel = d.channels.byChannel.reduce((s, c) => s + c.n, 0);

  return (
    <>
      <PageHeader
        eyebrow="Socios"
        title="Panel del negocio"
        description={`Últimos ${days} días comparados con los ${days} anteriores. Importes en pesos; los cobros de modo de prueba se informan aparte.`}
        action={
          <nav aria-label="Período" className="flex rounded-full bg-surface p-1 ring-1 ring-line">
            {PERIODS.map((p) => (
              <Link key={p} href={`/admin/socios?dias=${p}`} aria-current={p === days ? "page" : undefined}
                className={cn("rounded-full px-3 py-1.5 text-sm font-semibold", p === days ? "bg-ivory text-onyx" : "text-ink-2 hover:bg-ink/10")}>
                {p === 365 ? "12 meses" : `${p} días`}
              </Link>
            ))}
          </nav>
        }
      />
      {paymentsAreTestMode() && <Alert tone="warn" className="mb-5" title="Pagos en modo de prueba">Los cobros todavía son simulados: la facturación real empieza a contarse cuando se activen los pagos reales.</Alert>}

      <section aria-labelledby="kpis" className="space-y-3">
        <h2 id="kpis" className="sr-only">Indicadores principales</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Pedidos" value={k.requests.current.toLocaleString("es-AR")} hint={<Delta k={k.requests} />} />
          <Stat label="Trabajos completados" value={k.jobsDone.current.toLocaleString("es-AR")} hint={<Delta k={k.jobsDone} />} />
          <Stat label="Volumen contratado" value={formatMoney(k.gmv.current)} hint={<Delta k={k.gmv} money />} />
          <Stat label="Ingresos de Fixy" value={formatMoney(k.revenue.current)} tone="ok" hint={<Delta k={k.revenue} money />} />
          <Stat label="Clientes nuevos" value={k.newClients.current.toLocaleString("es-AR")} hint={<Delta k={k.newClients} />} />
          <Stat label="Profesionales aprobados" value={k.newPros.current.toLocaleString("es-AR")} hint={<Delta k={k.newPros} />} />
        </div>
      </section>

      <section aria-labelledby="evolucion" className="mt-8">
        <h2 id="evolucion" className="mb-3 text-lg font-bold">Evolución semanal</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <WeeklyBars title="Pedidos" points={d.series.requests} />
          <WeeklyBars title="Trabajos completados" points={d.series.jobs} />
          <WeeklyBars title="Volumen contratado" points={d.series.gmv} format={formatMoney} />
          <WeeklyBars title="Ingresos de Fixy" points={d.series.revenue} format={formatMoney} />
        </div>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Embudo de pedidos" description="De los pedidos del período, cuántos avanzan en cada paso." />
          <Funnel steps={[
            { label: "Pedidos enviados", value: d.funnel.sent },
            { label: "Con profesional elegido o invitado", value: d.funnel.invited },
            { label: "Con respuesta (visita o presupuesto)", value: d.funnel.answered },
            { label: "Contratados", value: d.funnel.hired },
            { label: "Confirmados (pagados)", value: d.funnel.confirmed },
            { label: "Completados", value: d.funnel.completed },
            { label: "Con reseña", value: d.funnel.reviewed },
          ]} />
        </Card>

        <Card>
          <CardHeader title="Calidad" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Calificación promedio" value={q.avg_rating ? `${q.avg_rating.toFixed(1)} ★` : "—"} hint={`${q.reviews} reseña(s) en el período`} />
            <Stat label="Reclamos cada 100 trabajos" value={q.completed ? ((q.disputes / q.completed) * 100).toFixed(1) : "—"} hint={`${q.disputes} reclamo(s) · ${q.completed} completado(s)`} tone={q.completed && q.disputes / q.completed > 0.05 ? "warn" : undefined} />
            <Stat label="Trabajos cancelados" value={pct(q.cancelled, q.jobs)} hint={`${q.cancelled} de ${q.jobs}`} />
            <Stat label="Reintegros (Espíritu Fixy y otros)" value={formatMoney(q.refunds_minor)} hint={`${q.refunds} reintegro(s) · ${q.review_disputes} impugnación(es) de reseñas`} />
          </div>
        </Card>
      </div>

      <section aria-labelledby="oferta" className="mt-8">
        <h2 id="oferta" className="mb-3 text-lg font-bold">Oferta de profesionales</h2>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          <Card>
            <CardHeader title="Profesionales" />
            <p className="text-3xl font-extrabold tabular">{d.supply.active}</p>
            <p className="text-sm text-muted">activos y verificados, recibiendo pedidos</p>
            <ul className="mt-4 space-y-1 text-sm">
              {d.supply.providersByStatus.map((s) => <li key={s.status} className="flex justify-between"><span className="text-ink-2">{STATUS[s.status] ?? s.status}</span><span className="tabular font-semibold">{s.n}</span></li>)}
            </ul>
            <p className="mt-3 text-sm text-muted">Tiempo de aprobación (mediana): <strong className="text-ink">{d.supply.median_approval_hours != null ? `${Math.round(d.supply.median_approval_hours)} h` : "—"}</strong></p>
          </Card>
          <Card>
            <CardHeader title="Por rubro" description="Profesionales activos vs. pedidos del período." />
            <table className="tabular w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="py-1 font-semibold">Rubro</th><th className="py-1 pl-2 text-right font-semibold">Prof.</th><th className="py-1 pl-2 text-right font-semibold">Pedidos</th></tr></thead>
              <tbody>{d.supply.byCategory.map((c) => (
                <tr key={c.name} className="border-t border-line"><td className="py-1.5">{c.name}</td><td className={cn("py-1.5 text-right", c.requests > 0 && c.providers === 0 && "font-semibold text-danger")}>{c.providers}</td><td className="py-1.5 text-right">{c.requests}</td></tr>
              ))}</tbody>
            </table>
          </Card>
          <Card>
            <CardHeader title="Por zona" description="Dónde llegan pedidos y cuántos profesionales cubren." />
            <table className="tabular w-full text-sm">
              <thead className="text-left text-muted"><tr><th className="py-1 font-semibold">Zona</th><th className="py-1 pl-2 text-right font-semibold">Prof.</th><th className="py-1 pl-2 text-right font-semibold">Pedidos</th></tr></thead>
              <tbody>{d.supply.zonesGap.map((z) => (
                <tr key={z.name} className="border-t border-line"><td className="py-1.5">{z.name}</td><td className={cn("py-1.5 text-right", z.requests > 0 && z.providers === 0 && "font-semibold text-danger")}>{z.providers}</td><td className="py-1.5 text-right">{z.requests}</td></tr>
              ))}</tbody>
            </table>
            <p className="mt-2 text-xs text-muted">En rojo: llegan pedidos y no hay profesionales.</p>
          </Card>
        </div>
      </section>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Canales" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Pedidos por WhatsApp" value={pct(waShare, totalChannel)} hint={`${waShare} de ${totalChannel} pedidos`} />
            <Stat label="Conversaciones de WhatsApp" value={d.channels.whatsapp.conversations.toLocaleString("es-AR")} hint={`${d.channels.whatsapp.linked} cuenta(s) con WhatsApp vinculado`} />
          </div>
          <h3 className="mt-4 text-sm font-semibold text-muted">Origen de las altas de profesionales</h3>
          {d.channels.providerSources.length ? (
            <ul className="mt-2 space-y-1 text-sm">{d.channels.providerSources.map((s) => <li key={s.source} className="flex justify-between"><span>{s.source}</span><span className="tabular font-semibold">{s.n}</span></li>)}</ul>
          ) : <p className="mt-2 text-sm text-muted">Sin altas en el período.</p>}
        </Card>
        <Card>
          <CardHeader title="Dinero" description="Cobros reales (sin modo de prueba) y plata de los profesionales." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Cobrado a clientes" value={formatMoney(d.money.charged - d.money.refunded)} hint={`Bruto ${formatMoney(d.money.charged)} · reintegros ${formatMoney(d.money.refunded)}${d.money.test_charged ? ` · prueba ${formatMoney(d.money.test_charged)}` : ""}`} />
            <Stat label="Transferido a profesionales" value={formatMoney(d.money.withdrawn)} hint="Retiros pagados en el período" />
            <Stat label="Saldo disponible de profesionales" value={formatMoney(d.money.available)} hint="Hoy, listo para retirar" />
            <Stat label="Retiros en camino" value={formatMoney(d.money.in_transit)} hint={`Esperando reseña o reclamo: ${formatMoney(d.money.waiting)}`} tone={d.money.in_transit ? "warn" : undefined} />
          </div>
        </Card>
      </div>
    </>
  );
}
