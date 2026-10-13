import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/server/auth/session";
import { isPlatformAdmin } from "@/server/auth/actor";
import { ADMIN_SECTIONS, levelFor } from "@/server/auth/permissions";
import { getAttention, getOverview, parsePeriod, PERIODS } from "@/server/queries/admin";
import { disputeReasonLabel, disputeStatusLabel, requestStatusLabel } from "@/server/domain/labels";
import { PageHeader, Stat } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge, TestModeBadge, DemoBadge } from "@/components/ui/badge";
import { Section, Tabs } from "@/components/admin/ui";
import { formatMoney, relativeTime } from "@/lib/format";

export const metadata = { title: "Resumen" };

const hours = (h: number | null) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1).replace(".", ",")} h`);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : "—");

export default async function AdminHome({ searchParams }: { searchParams: Promise<{ periodo?: string; error?: string }> }) {
  const sp = await searchParams;
  const actor = await requireStaff();
  if (levelFor(actor, "resumen") === "none") {
    const first = ADMIN_SECTIONS.find((x) => levelFor(actor, x.key) !== "none");
    redirect(first ? first.href : isPlatformAdmin(actor) ? "/admin/equipo" : "/app");
  }
  const period = parsePeriod(sp.periodo);
  const [o, a] = await Promise.all([getOverview(actor.id, period.days), getAttention(actor.id)]);
  const periodText = period.days ? `últimos ${period.days} días` : "todo el historial";
  const anyTest = o.chargesTest > 0;
  const attentionCount = a.providers.length + a.review.length + a.unanswered.length + a.disputes.length + a.holds.length;

  return (
    <>
      <PageHeader
        eyebrow="Operación"
        title={`Hola, ${actor.fullName.split(" ")[0]}`}
        description="Indicadores calculados con los datos de la plataforma y los temas que necesitan una persona del equipo."
      />
      {sp.error === "forbidden" && (
        <Alert tone="warn" className="mb-5" title="No tenés acceso a esa sección">
          Si lo necesitás, pedíselo al dueño de la cuenta desde Equipo y permisos.
        </Alert>
      )}

      <Section
        id="atencion"
        title="Requiere atención"
        description={attentionCount ? `${attentionCount} tema(s) pendiente(s).` : "No hay temas pendientes."}
        className="mb-6"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <AttentionList title="Proveedores en revisión" empty="Ningún alta esperando revisión." href="/admin/proveedores?estado=in_review"
            items={a.providers.map((p) => ({ key: p.id, href: `/admin/proveedores/${p.id}`, title: p.display_name, meta: p.submitted_at ? `Enviado ${relativeTime(p.submitted_at)}` : "Sin fecha de envío", badge: p.is_demo ? <DemoBadge /> : null }))} />
          <AttentionList title="Solicitudes para revisar o sin cobertura" empty="No hay solicitudes para derivar." href="/admin/solicitudes?revision=1"
            items={a.review.map((r) => ({ key: r.id, href: `/admin/solicitudes/${r.id}`, title: `${r.code} · ${r.title}`, meta: r.review_reason ?? (r.status === "no_coverage" ? "No hay proveedores elegibles para la zona y categoría" : "Marcada para revisión"), badge: <StatusBadge status={r.status} labels={requestStatusLabel} /> }))} />
          <AttentionList title="Sin respuesta hace más de 24 h" empty="Todas las solicitudes recientes tienen presupuestos o están en plazo." href="/admin/solicitudes"
            items={a.unanswered.map((r) => ({ key: r.id, href: `/admin/solicitudes/${r.id}`, title: `${r.code} · ${r.title}`, meta: `${r.invitations} invitación(es) · enviada ${r.submitted_at ? relativeTime(r.submitted_at) : "—"}`, badge: <Badge tone="warn">Sin respuesta</Badge> }))} />
          <AttentionList title="Reclamos abiertos" empty="No hay reclamos abiertos." href="/admin/reclamos"
            items={a.disputes.map((d) => ({ key: d.id, href: `/admin/reclamos/${d.id}`, title: `${d.job_code} · ${disputeReasonLabel[d.reason_code] ?? d.reason_code}`, meta: `Abierto ${relativeTime(d.created_at)}`, badge: <StatusBadge status={d.status} labels={disputeStatusLabel} /> }))} />
          <AttentionList title="Liquidaciones retenidas" empty="No hay liquidaciones retenidas." href="/admin/finanzas?tab=liquidaciones"
            items={a.holds.map((p) => ({ key: p.id, href: `/admin/trabajos/${p.job_id}`, title: `${p.job_code} · ${p.provider_name}`, meta: `${formatMoney(p.amount_minor)} · ${p.hold_reason ?? "Retenida"}`, badge: p.is_test ? <TestModeBadge /> : null }))} />
        </div>
      </Section>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold">Indicadores · {periodText}</h2>
        {anyTest && <TestModeBadge />}
      </div>
      <Tabs current={period.key} items={PERIODS.map((p) => ({ key: p.key, label: p.label, href: p.key === "30" ? "/admin" : `/admin?periodo=${p.key}` }))} />

      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Demanda y conversión</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Solicitudes creadas" value={o.requestsCreated} hint="Enviadas en el período" />
        <Stat label="Conversión a contratación" value={pct(o.requestsConverted, o.requestsCreated)} hint={`${o.requestsConverted} de ${o.requestsCreated} terminaron en un trabajo`} />
        <Stat label="Pedidos sin presupuesto" value={o.unquoted} hint={`Ahora · ${o.unquotedOver24h} sin respuesta hace +24 h`} tone={o.unquotedOver24h ? "warn" : "default"} />
        <Stat label="Tiempo al primer presupuesto" value={hours(o.firstQuoteMedianHours)} hint={o.firstQuoteSample ? `Mediana · promedio ${hours(o.firstQuoteAvgHours)} (${o.firstQuoteSample} solicitudes)` : "Sin datos en el período"} />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">Ejecución</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Trabajos completados" value={o.jobsCompleted} tone="ok" hint="Con conformidad o cierre del equipo" />
        <Stat label="Cancelaciones" value={o.jobsCancelled + o.requestsCancelled} hint={`${o.jobsCancelled} trabajo(s) · ${o.requestsCancelled} solicitud(es)`} />
        <Stat label="Reclamos" value={`${o.disputesOpen} / ${o.disputesTotal}`} hint="Abiertos ahora / creados en el período" tone={o.disputesOpen ? "warn" : "default"} />
        <Stat label="Liquidaciones pendientes" value={formatMoney(o.payoutsPendingMinor)} hint={`${o.payoutsPendingCount} pendiente(s) o programada(s) · ${o.payoutsOnHold} retenida(s)`} />
      </div>

      <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">Dinero</h3>
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Volumen contratado" value={formatMoney(o.contractedMinor)} hint={`Total pactado de ${o.contractedJobs} trabajo(s) + adicionales aceptados. No es dinero cobrado.`} />
        <Stat label="Dinero procesado (neto)" value={formatMoney(o.chargedGrossMinor - o.refundedMinor)} hint={`Cobros aprobados ${formatMoney(o.chargedGrossMinor)} − reembolsos ${formatMoney(o.refundedMinor)}. Incluye lo que corresponde al proveedor.`} />
        <Stat label="Ingresos de plataforma" value={formatMoney(o.platformRevenueMinor)} tone="ok" hint={`Cargo de servicio a clientes (a profesionales no se les cobra comisión), neto de reembolsos. Impuestos aparte: ${formatMoney(o.taxesMinor)}.`} />
      </div>
      <Alert tone="info" className="mt-4" title="Cómo leer estos importes">
        El <strong>volumen contratado</strong> es lo pactado con los clientes, se haya cobrado o no. El <strong>dinero procesado</strong> es lo que efectivamente
        aprobó la pasarela menos los reembolsos; la mayor parte se le debe al proveedor. Los <strong>ingresos de plataforma</strong> salen del registro financiero
        (cuenta de ingresos de plataforma). Un cobro aprobado no implica trabajo completado, y una liquidación pendiente no está pagada.
        {anyTest && <> En el período hay {o.chargesTest} de {o.chargesTotal} cobro(s) en <strong>modo de prueba</strong>: no representan dinero real.</>}
      </Alert>
    </>
  );
}

function AttentionList({ title, items, empty, href }: { title: string; empty: string; href: string; items: { key: string; href: string; title: string; meta: string; badge?: React.ReactNode }[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-bold">{title} <span className="text-muted">({items.length})</span></h3>
        <Link href={href} className="shrink-0 whitespace-nowrap text-sm font-semibold text-fixy-800 hover:underline">Ver todo</Link>
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl bg-cream/60 px-3 py-2.5 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
          {items.slice(0, 6).map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex min-h-11 items-start justify-between gap-3 px-3 py-2.5 hover:bg-cream/60">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{i.title}</span>
                  <span className="block text-sm text-muted">{i.meta}</span>
                </span>
                {i.badge}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
