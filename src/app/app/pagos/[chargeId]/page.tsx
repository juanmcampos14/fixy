import { notFound } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { asUser } from "@/server/db/client";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { TestModeBadge } from "@/components/ui/badge";
import { chargeKindLabel, chargeStatusLabel } from "@/server/domain/labels";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PrintButton } from "@/components/client/print-button";

export const metadata = { title: "Comprobante de pago" };

export default async function Receipt({ params }: { params: Promise<{ chargeId: string }> }) {
  const { chargeId } = await params;
  const actor = await requireActor();
  const [c] = await asUser(actor.id, (tx) => tx<{ id: string; kind: string; status: string; amount_minor: number; client_fee_minor: number; tax_minor: number; refunded_minor: number; is_test: boolean; external_reference: string; external_payment_id: string | null; approved_at: Date | null; job_code: string; title: string; provider_name: string; payer: string; ok: boolean }[]>`
    select c.id, c.kind, c.status, c.amount_minor, c.client_fee_minor, c.tax_minor, c.refunded_minor, c.is_test, c.external_reference, c.external_payment_id, c.approved_at,
      j.code as job_code, r.title, pp.display_name as provider_name, u.full_name as payer, app.is_job_client(${actor.id}, c.job_id) as ok
    from charges c join jobs j on j.id = c.job_id join service_requests r on r.id = j.request_id join provider_public pp on pp.id = j.provider_id join user_names u on u.id = c.payer_user_id
    where c.id = ${chargeId}`);
  if (!c || !c.ok || !c.approved_at) notFound();
  return (
    <div className="mx-auto max-w-xl">
      <Card className="print:shadow-none print:ring-0">
        <div className="flex items-center justify-between"><Logo size="sm" />{c.is_test && <TestModeBadge />}</div>
        <h1 className="mt-6 text-2xl font-extrabold">Comprobante de pago</h1>
        <p className="text-sm text-muted">No válido como factura.{c.is_test ? " Emitido en modo de prueba: no corresponde a un pago real." : ""}</p>
        <dl className="tabular mt-5 divide-y divide-line text-[15px]">
          {[
            ["Referencia Fixy", c.external_reference],
            ["Referencia de la pasarela", c.external_payment_id ?? "—"],
            ["Fecha de acreditación", formatDateTime(c.approved_at)],
            ["Pagado por", c.payer],
            ["Trabajo", `${c.job_code} · ${c.title}`],
            ["Profesional", c.provider_name],
            ["Concepto", chargeKindLabel[c.kind]],
            ["Cargo de servicio incluido", formatMoney(c.client_fee_minor + c.tax_minor)],
            ["Estado", chargeStatusLabel[c.status]],
            ...(c.refunded_minor ? [["Reembolsado", `− ${formatMoney(c.refunded_minor)}`]] : []),
          ].map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted">{k}</dt><dd className="text-right">{v}</dd></div>)}
          <div className="flex justify-between py-3 text-lg font-bold"><dt>Total pagado</dt><dd>{formatMoney(c.amount_minor)}</dd></div>
        </dl>
        <div className="mt-4 print:hidden"><PrintButton /></div>
      </Card>
    </div>
  );
}
