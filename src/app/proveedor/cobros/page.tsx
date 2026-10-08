import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, Wallet } from "lucide-react";
import { getEarnings, requireProviderContext } from "@/server/queries/provider";
import { providerBalance } from "@/server/modules/withdrawals";
import { sql } from "@/server/db/client";
import { BankAccountForm, WithdrawForm } from "@/components/provider/withdraw-forms";
import { jobStatusLabelProvider, payoutStatusLabel } from "@/server/domain/labels";
import { paymentsAreTestMode } from "@/server/env";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";

export const metadata: Metadata = { title: "Cobros" };

export default async function EarningsPage() {
  const { actor, provider } = await requireProviderContext({ adminOnly: true });
  const [rows, b] = await Promise.all([getEarnings(actor.id, provider.id), providerBalance(sql(), provider.id)]);
  const test = paymentsAreTestMode() || rows.some((r) => r.any_test || r.payout_test);
  const day = (iso: string) => new Date(`${iso}T12:00:00-03:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long" });
  const transferDate = (() => {
    const d = new Date(`${b.nextRequestFrom}T12:00:00-03:00`);
    d.setDate(d.getDate() + b.delayDays);
    return d.toLocaleDateString("es-AR", { day: "numeric", month: "long" });
  })();

  return (
    <>
      <PageHeader title="Cobros" description="Tu saldo, tus retiros y lo que ganaste en cada trabajo." action={test ? <TestModeBadge /> : undefined} />
      <div className="space-y-5">
        {test && <Alert tone="warn" title="Modo de prueba">Los pagos y retiros son simulados. No se mueve dinero real.</Alert>}

        <Card className="ring-2 ring-fixy-500/25">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-muted"><Wallet className="h-4 w-4" aria-hidden />Disponible para retirar</p>
              <p className="tabular mt-1 text-4xl font-extrabold">{formatMoney(b.availableMinor)}</p>
              <p className="mt-1 text-sm text-muted">{b.availableJobs ? `De ${b.availableJobs} trabajo${b.availableJobs === 1 ? "" : "s"} terminado${b.availableJobs === 1 ? "" : "s"} y calificado${b.availableJobs === 1 ? "" : "s"}.` : "Se suma cuando el cliente da conformidad y deja su reseña."}</p>
              <p className="mt-4 flex items-start gap-2 rounded-2xl bg-ok-bg px-3 py-2 text-sm text-ok"><BadgePercent className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span><strong>0 % de comisión.</strong> Cobrás el 100 % de tu presupuesto: Fixy solo le cobra un cargo de servicio al cliente.</span></p>
            </div>
            <div>
              {b.thisMonth ? (
                <Alert tone={b.thisMonth.status === "paid" ? "ok" : "info"} title={b.thisMonth.status === "paid" ? "Ya cobraste tu retiro de este mes" : `Retiro en camino: ${formatMoney(b.thisMonth.amount_minor)}`}>
                  {b.thisMonth.status === "paid" ? <>Transferido el {formatDateTime(b.thisMonth.paid_at!)}</> : <>Te lo transferimos el <strong>{day(b.thisMonth.scheduled_for)}</strong>.</>}{" "}
                  Podés pedir el próximo desde el {day(b.nextRequestFrom)}.
                </Alert>
              ) : b.availableMinor > 0 ? (
                <WithdrawForm availableMinor={b.availableMinor} bank={b.bank} transferDate={transferDate} />
              ) : (
                <div className="space-y-2 text-[15px] text-ink-2">
                  <p className="font-semibold text-ink">¿Cómo cobro?</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    <li>Terminás el trabajo y el cliente da conformidad.</li>
                    <li>Cuando deja su reseña, el monto pasa a tu saldo disponible.</li>
                    <li>Una vez por mes pedís el retiro de todo tu saldo y te lo transferimos a los {b.delayDays} días.</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="En trabajos en curso" value={formatMoney(b.inProgressMinor)} hint="Ya pagado por el cliente; falta terminar" />
          <Stat label="Esperando reseña" value={formatMoney(b.waitingReviewMinor)} hint="Se libera cuando el cliente califica" />
          <Stat label="Retiro en camino" value={formatMoney(b.requestedMinor)} tone={b.requestedMinor ? "warn" : undefined} />
          <Stat label="Cobrado en total" value={formatMoney(b.paidMinor)} tone="ok" />
        </div>
        {b.onHoldMinor > 0 && <Alert tone="warn" title={`${formatMoney(b.onHoldMinor)} en pausa por un reclamo`}>Se libera cuando se resuelva el reclamo.</Alert>}

        {b.withdrawals.length > 0 && (
          <Card>
            <CardHeader title="Tus retiros" />
            <ul className="divide-y divide-line">
              {b.withdrawals.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div>
                    <p className="tabular font-semibold">{formatMoney(w.amount_minor)}</p>
                    <p className="text-sm text-muted">
                      Pedido {formatDateTime(w.requested_at)} · {w.status === "paid" ? `transferido ${formatDateTime(w.paid_at!)} · ref. ${w.external_ref}` : w.status === "rejected" ? `rechazado: ${w.reject_reason}` : `se transfiere el ${day(w.scheduled_for)}`}
                    </p>
                  </div>
                  <span className="flex items-center gap-2">
                    <Badge tone={w.status === "paid" ? "ok" : w.status === "rejected" ? "danger" : "info"}>{w.status === "paid" ? "Transferido" : w.status === "rejected" ? "Rechazado" : "En camino"}</Badge>
                    {w.is_test && <TestModeBadge />}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card as="section" id="banco" className="scroll-mt-24">
          <CardHeader title="Datos bancarios" description={b.bank ? "Acá llegan tus retiros. Solo los ve el equipo de pagos de Fixy." : "Opcional hasta tu primer retiro: si los cargás ahora, retirás en un paso."} />
          <BankAccountForm bank={b.bank} />
        </Card>

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
