import Link from "next/link";
import { FileText } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { clientPayments } from "@/server/queries/client";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { chargeKindLabel, chargeStatusLabel } from "@/server/domain/labels";
import { formatDateTime, formatMoney } from "@/lib/format";

export const metadata = { title: "Pagos" };

export default async function Payments() {
  const actor = await requireActor();
  const { charges, refunds, agreed } = await clientPayments(actor.id);
  const ok = charges.filter((c) => ["approved", "partially_refunded", "refunded"].includes(c.status));
  const paid = ok.reduce((s, c) => s + c.amount_minor, 0);
  const refunded = ok.reduce((s, c) => s + c.refunded_minor, 0);
  const pending = charges.filter((c) => c.status === "pending").reduce((s, c) => s + c.amount_minor, 0);
  const anyTest = charges.some((c) => c.is_test);
  return (
    <>
      <PageHeader title="Pagos" description="Todo lo que pagaste dentro de Fixy, con sus comprobantes." action={anyTest ? <TestModeBadge /> : undefined} />
      <div className="mb-8 grid gap-3 sm:grid-cols-4">
        <Stat label="Total acordado" value={formatMoney(agreed)} hint="Trabajos y adicionales aceptados" />
        <Stat label="Pagado" value={formatMoney(paid)} />
        <Stat label="Pendiente de pago" value={formatMoney(pending)} tone={pending ? "warn" : "default"} />
        <Stat label="Reembolsado" value={formatMoney(refunded)} />
      </div>
      {charges.length === 0 ? (
        <EmptyState title="Sin movimientos" description="Cuando contrates un trabajo, vas a ver acá los pagos y sus comprobantes." />
      ) : (
        <Card>
          <CardHeader title="Movimientos" />
          <ul className="divide-y divide-line">
            {charges.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link href={`/app/trabajos/${c.job_id}`} className="font-semibold hover:underline">{c.job_code} · {c.title}</Link>
                  <p className="text-sm text-muted">{chargeKindLabel[c.kind]} · {c.provider_name} · {formatDateTime(c.created_at)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular font-semibold">{formatMoney(c.amount_minor)}</span>
                  <StatusBadge status={c.status} labels={chargeStatusLabel} />
                  {c.status === "pending" && c.checkout_url && <Link href={c.checkout_url} className="text-sm font-semibold text-fixy-800 underline">Pagar</Link>}
                  {["approved", "partially_refunded", "refunded"].includes(c.status) && <Link href={`/app/pagos/${c.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 underline"><FileText className="h-4 w-4" aria-hidden />Comprobante</Link>}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {refunds.length > 0 && (
        <Card className="mt-6">
          <CardHeader title="Reembolsos" />
          <ul className="divide-y divide-line">
            {refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-3 py-3"><span>{r.job_code} · {r.reason}<span className="block text-sm text-muted">{formatDateTime(r.created_at)}</span></span><span className="tabular font-semibold text-ok">− {formatMoney(r.amount_minor)}</span></li>
            ))}
          </ul>
        </Card>
      )}
      <p className="mt-6 text-sm text-muted">Los comprobantes de pago no son facturas fiscales. La emisión de facturas queda pendiente de la definición fiscal de la operación.</p>
    </>
  );
}
