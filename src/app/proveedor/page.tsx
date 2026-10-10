import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getDashboard, getOnboardingState, requireProviderContext } from "@/server/queries/provider";
import { jobStatusLabelProvider } from "@/server/domain/labels";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { DemoBadge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { ProviderStatusCard } from "@/components/provider/sections";
import { StrengthMeter } from "@/components/provider/strength-meter";
import { getProfileStrength } from "@/server/modules/providers";
import { providerBalance } from "@/server/modules/withdrawals";
import { sql } from "@/server/db/client";
import { alertsState } from "@/server/modules/whatsapp-alerts";
import { WhatsAppAlerts } from "@/components/provider/whatsapp-alerts";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Inicio" };

export default async function ProviderHome() {
  const { actor, provider, isAdmin } = await requireProviderContext();
  const [dash, state] = await Promise.all([
    getDashboard(actor.id, provider.id, isAdmin),
    isAdmin ? getOnboardingState(actor.id, provider.id) : Promise.resolve(null),
  ]);
  const [strength, balance] = isAdmin ? await Promise.all([getProfileStrength(sql(), provider.id), providerBalance(sql(), provider.id)]) : [null, null];
  const alerts = await alertsState(actor.id);
  const pendingActions = dash.toConfirm.length + dash.extrasWaiting.length + dash.reschedulesToAnswer.length + dash.openDisputes.length;

  return (
    <>
      <PageHeader
        eyebrow={isAdmin ? "Panel de proveedor" : "Panel de técnico"}
        title={<span className="inline-flex flex-wrap items-center gap-2">{provider.name} {state?.provider.is_demo && <DemoBadge />}</span>}
        description={isAdmin ? "Tus oportunidades, trabajos y cobros en un solo lugar." : `Hola, ${actor.fullName.split(" ")[0]}. Acá ves los trabajos que te asignaron.`}
        action={isAdmin && provider.status === "approved" ? <ButtonLink href="/proveedor/oportunidades" variant="primary">Ver oportunidades</ButtonLink> : undefined}
      />

      <div className="space-y-5">
        {isAdmin && state && provider.status !== "approved" && (
          <Alert tone="info" title="Completá tu alta">
            Ya te pueden llegar pedidos de tu rubro y zona; para aceptarlos, completá lo que falta en <Link href="/proveedor/alta">Alta de proveedor</Link>.
          </Alert>
        )}
        {strength && strength.score < 100 && <Card><StrengthMeter {...strength} max={3} /></Card>}
        {!alerts.on && (
          <Card className="ring-2 ring-[#25D366]/30">
            <CardHeader title="Avisos por WhatsApp" />
            <WhatsAppAlerts {...alerts} />
          </Card>
        )}
        {isAdmin && state && <ProviderStatusCard provider={state.provider} checklist={state.checklist} eligibility={state.eligibility} />}

        {alerts.on && (
          <Card>
            <CardHeader title="Avisos por WhatsApp" />
            <WhatsAppAlerts {...alerts} />
          </Card>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          {isAdmin && <Stat label="Oportunidades abiertas" value={dash.newOpps} hint="Nuevas o vistas, sin cotizar" />}
          <Stat label={isAdmin ? "Trabajos activos" : "Trabajos asignados activos"} value={dash.activeJobs.length} />
          {isAdmin && <Stat label="Acciones pendientes" value={pendingActions} tone={pendingActions ? "warn" : "default"} />}
        </div>

        {isAdmin && pendingActions > 0 && (
          <Card>
            <CardHeader title="Pendientes" />
            <ul className="divide-y divide-line">
              {dash.toConfirm.map((j) => (
                <PendingRow key={`c-${j.id}`} href={`/proveedor/trabajos/${j.id}`} title={`Confirmá el trabajo ${j.code}`} detail={`${j.title} · el pago del cliente está aprobado`} />
              ))}
              {dash.reschedulesToAnswer.map((r) => (
                <PendingRow key={`r-${r.id}`} href={`/proveedor/trabajos/${r.job_id}`} title={`Respondé la reprogramación de ${r.code}`} detail={`Nueva fecha propuesta por el cliente: ${formatDate(r.new_date)}`} />
              ))}
              {dash.extrasWaiting.map((e) => (
                <PendingRow key={`e-${e.id}`} href={`/proveedor/trabajos/${e.job_id}`} title={`Adicional esperando al cliente · ${e.code}`} detail={e.description} />
              ))}
              {dash.openDisputes.map((d) => (
                <PendingRow key={`d-${d.id}`} href={`/proveedor/reclamos/${d.id}`} title={`Reclamo abierto · ${d.code}`} detail="Revisá el caso y respondé." />
              ))}
            </ul>
          </Card>
        )}
        {isAdmin && dash.awaitingPayment.length > 0 && (
          <Alert tone="info" title="Esperando el pago del cliente">
            {dash.awaitingPayment.map((j) => j.code).join(", ")}: vas a poder confirmar cuando el pago esté aprobado.
          </Alert>
        )}

        <Card>
          <CardHeader title="Trabajos en curso" action={<Link href="/proveedor/trabajos" className="text-sm font-semibold text-fixy-800 underline">Ver todos</Link>} />
          {dash.activeJobs.length === 0 ? (
            <EmptyState title="No hay trabajos en curso" description={isAdmin ? "Cuando un cliente acepte tu presupuesto, el trabajo aparece acá." : "Cuando te asignen un trabajo, aparece acá."} />
          ) : (
            <ul className="divide-y divide-line">
              {dash.activeJobs.map((j) => (
                <li key={j.id}>
                  <Link href={`/proveedor/trabajos/${j.id}`} className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-3 hover:bg-cream/50">
                    <span className="min-w-0">
                      <span className="block font-semibold">{j.code} · {j.title}</span>
                      <span className="text-sm text-muted">{j.scheduled_date ? `${formatDate(j.scheduled_date)}${j.scheduled_window ? ` · ${j.scheduled_window}` : ""}` : "Fecha a coordinar"}</span>
                    </span>
                    <StatusBadge status={j.status} labels={jobStatusLabelProvider} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isAdmin && balance && (
          <Card>
            <CardHeader title="Tu saldo" description="0 % de comisión de Fixy: cobrás el neto de cada trabajo (menos los costos de Mercado Pago e impuestos del cobro)." action={dash.anyTest ? <TestModeBadge /> : undefined} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Disponible para retirar" value={formatMoney(balance.availableMinor)} tone={balance.availableMinor ? "ok" : undefined} />
              <Stat label="Esperando reseña" value={formatMoney(balance.waitingReviewMinor)} />
              <Stat label="Retiro en camino" value={formatMoney(balance.requestedMinor)} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {balance.canRequest && <ButtonLink href="/proveedor/cobros">Retirar {formatMoney(balance.availableMinor)}</ButtonLink>}
              <Link href="/proveedor/cobros" className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 underline">Ver cobros y retiros <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function PendingRow({ href, title, detail }: { href: string; title: string; detail: string }) {
  return (
    <li>
      <Link href={href} className="flex min-h-14 items-center justify-between gap-3 py-3 hover:bg-cream/50">
        <span className="min-w-0">
          <span className="block font-semibold">{title}</span>
          <span className="block truncate text-sm text-muted">{detail}</span>
        </span>
        <ArrowRight className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      </Link>
    </li>
  );
}
