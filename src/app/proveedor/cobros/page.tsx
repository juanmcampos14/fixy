import type { Metadata } from "next";
import Link from "next/link";
import { getEarnings, getOwnProvider, requireProviderContext } from "@/server/queries/provider";
import { jobStatusLabelProvider, payoutStatusLabel, payoutsStatusLabel } from "@/server/domain/labels";
import { paymentsAreTestMode } from "@/server/env";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";

export const metadata: Metadata = { title: "Cobros" };

export default async function EarningsPage() {
  const { actor, provider } = await requireProviderContext({ adminOnly: true });
  const [rows, own] = await Promise.all([getEarnings(actor.id, provider.id), getOwnProvider(actor.id, provider.id)]);
  const test = paymentsAreTestMode() || rows.some((r) => r.any_test || r.payout_test);

  // Bruto y comisión: lo cobrado (pagos aprobados). Neto: bruto − comisión − reembolsos (ajustes).
  let gross = 0, fees = 0, adjustments = 0, pending = 0, paid = 0, withoutPayout = 0;
  for (const r of rows) {
    if (r.payout_id) {
      gross += r.gross_minor ?? 0;
      fees += r.fee_minor ?? 0;
      adjustments += r.adjustments_minor ?? 0;
      if (r.payout_status === "paid") paid += r.amount_minor ?? 0;
      else if (r.payout_status !== "reversed") pending += r.amount_minor ?? 0;
    } else {
      gross += r.charged_gross;
      fees += r.charged_fee;
      withoutPayout += r.charged_gross - r.charged_fee;
    }
  }
  const net = gross - fees + adjustments;

  return (
    <>
      <PageHeader title="Cobros" description="Lo que cobraste por Fixy, las comisiones y el estado de cada liquidación." action={test ? <TestModeBadge /> : undefined} />
      <p className="-mt-3 mb-6 max-w-3xl text-sm text-muted">Cada liquidación se libera cuando el cliente da conformidad <strong>y deja su reseña</strong>. Las reseñas se publican de forma anónima y días después, por eso no vas a ver cuál cliente dejó cada una.</p>
      <div className="space-y-5">
        {test && <Alert tone="warn" title="Modo de prueba">Los pagos y liquidaciones son simulados. No se mueve dinero real.</Alert>}
        <Alert tone="info" title="Tres momentos distintos">
          <ol className="mt-1 list-decimal space-y-0.5 pl-5">
            <li><strong>Pago aprobado:</strong> el cliente pagó por la pasarela. Todavía no es tu dinero liquidado.</li>
            <li><strong>Trabajo completado:</strong> el cliente dio conformidad. Ahí se genera la liquidación pendiente.</li>
            <li><strong>Liquidación realizada:</strong> el neto se transfirió a tu cuenta de cobro.</li>
          </ol>
        </Alert>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Cuenta de cobro:</span>
          {own && <StatusBadge status={own.payouts_status} labels={payoutsStatusLabel} />}
          {own?.payouts_status !== "enabled" && <Link href="/proveedor/perfil#cobros" className="font-semibold text-fixy-800 underline">Configurar</Link>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Bruto" value={formatMoney(gross)} hint="Suma de tus presupuestos y adicionales pagados" />
          <Stat label="Comisiones Fixy" value={formatMoney(fees)} />
          <Stat label="Neto" value={formatMoney(net)} hint={adjustments ? `Incluye ajustes por ${formatMoney(adjustments)}` : "Bruto menos comisiones y ajustes"} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Pagado, sin conformidad aún" value={formatMoney(withoutPayout)} hint="Todavía no genera liquidación" />
          <Stat label="Pendiente de liquidación" value={formatMoney(pending)} tone="warn" />
          <Stat label="Liquidado" value={formatMoney(paid)} tone="ok" />
        </div>

        <Card>
          <CardHeader title="Detalle por trabajo" />
          {rows.length === 0 ? (
            <EmptyState title="Todavía no hay cobros" description="Cuando un cliente pague un trabajo tuyo, lo vas a ver acá." />
          ) : (
            <div className="-mx-5 overflow-x-auto sm:-mx-6">
              <table className="tabular w-full min-w-[760px] text-left text-sm">
                <caption className="sr-only">Cobros y liquidaciones por trabajo</caption>
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2 font-semibold sm:px-6">Trabajo</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Bruto</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Comisión</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Ajustes</th>
                    <th scope="col" className="px-2 py-2 text-right font-semibold">Neto</th>
                    <th scope="col" className="px-2 py-2 font-semibold">Liquidación</th>
                    <th scope="col" className="px-5 py-2 font-semibold sm:px-6">Liquidada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => {
                    const g = r.payout_id ? r.gross_minor ?? 0 : r.charged_gross;
                    const f = r.payout_id ? r.fee_minor ?? 0 : r.charged_fee;
                    const a = r.payout_id ? r.adjustments_minor ?? 0 : 0;
                    return (
                      <tr key={r.job_id} className="align-top">
                        <td className="px-5 py-3 sm:px-6">
                          <Link href={`/proveedor/trabajos/${r.job_id}`} className="font-semibold text-fixy-800 underline">{r.code}</Link>
                          <span className="block max-w-56 truncate text-muted">{r.title}</span>
                          <span className="text-xs text-muted">{jobStatusLabelProvider[r.job_status] ?? r.job_status}</span>
                        </td>
                        <td className="px-2 py-3 text-right">{formatMoney(g)}</td>
                        <td className="px-2 py-3 text-right">− {formatMoney(f)}</td>
                        <td className="px-2 py-3 text-right">{a ? formatMoney(a) : "—"}</td>
                        <td className="px-2 py-3 text-right font-semibold">{formatMoney(r.payout_id ? r.amount_minor ?? 0 : g - f)}</td>
                        <td className="px-2 py-3">
                          {r.payout_status ? (
                            <span className="flex flex-col items-start gap-1">
                              <StatusBadge status={r.payout_status} labels={payoutStatusLabel} />
                              {r.on_hold && <Badge tone="warn">En pausa{r.hold_reason ? `: ${r.hold_reason}` : ""}</Badge>}
                              {r.awaiting_review && r.payout_status !== "paid" && <Badge tone="info" icon={false}>Se libera cuando el cliente califique</Badge>}
                              {(r.payout_test ?? r.any_test) && <TestModeBadge />}
                            </span>
                          ) : (
                            <span className="text-muted">Sin liquidación (falta conformidad)</span>
                          )}
                        </td>
                        <td className="px-5 py-3 sm:px-6">{r.paid_at ? formatDateTime(r.paid_at) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
