import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Desglose para el cliente: todo lo que paga, quién paga la comisión y el total. Sin cargos ocultos. */
export function ClientPriceBreakdown({ a, className, title = "Desglose", discountMinor = 0 }: {
  a: { laborMinor: number; materialsMinor: number; visitMinor: number; clientFeeMinor: number; clientFeeTaxMinor: number; totalMinor: number; clientRateBps: number; clientFeeTaxBps?: number };
  className?: string;
  title?: string | null;
  discountMinor?: number;
}) {
  const rows: [string, number][] = [];
  if (a.laborMinor) rows.push(["Mano de obra", a.laborMinor]);
  if (a.materialsMinor) rows.push(["Materiales", a.materialsMinor]);
  if (a.visitMinor) rows.push(["Visita / diagnóstico", a.visitMinor]);
  if (discountMinor) rows.push(["Descuento de la visita ya pagada", -discountMinor]);
  rows.push([`Cargo de servicio Fixy (${a.clientRateBps / 100} %, lo pagás vos)`, a.clientFeeMinor]);
  return (
    <div className={className}>
      {title && <h3 className="mb-1 text-sm font-semibold text-muted">{title}</h3>}
      <dl className="tabular divide-y divide-line text-[15px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-ink-2">{k}</dt><dd>{v < 0 ? `− ${formatMoney(-v)}` : formatMoney(v)}</dd></div>
        ))}
        <div className="flex justify-between gap-4 py-2">
          <dt className="text-ink-2">Impuestos configurados sobre el cargo</dt>
          <dd>{a.clientFeeTaxMinor ? formatMoney(a.clientFeeTaxMinor) : <span className="text-muted">No aplica</span>}</dd>
        </div>
        <div className="flex justify-between gap-4 py-2.5 text-lg font-bold"><dt>Total</dt><dd>{formatMoney(a.totalMinor)}</dd></div>
      </dl>
    </div>
  );
}

/** Vista del proveedor: bruto, comisión (hoy 0 %; los trabajos viejos pueden tener una) y neto. */
export function ProviderNetBreakdown({ grossMinor, feeMinor, netMinor, rateBps, adjustmentsMinor = 0, className }: { grossMinor: number; feeMinor: number; netMinor: number; rateBps?: number; adjustmentsMinor?: number; className?: string }) {
  return (
    <dl className={cn("tabular divide-y divide-line text-[15px]", className)}>
      <div className="flex justify-between py-2"><dt className="text-ink-2">Importe bruto (tu presupuesto)</dt><dd>{formatMoney(grossMinor)}</dd></div>
      {feeMinor === 0
        ? <div className="flex justify-between py-2"><dt className="text-ink-2">Comisión Fixy</dt><dd className="font-semibold text-ok">0 % · $ 0</dd></div>
        : <div className="flex justify-between py-2"><dt className="text-ink-2">Comisión Fixy{rateBps != null ? ` (${rateBps / 100} %)` : ""}</dt><dd>− {formatMoney(feeMinor)}</dd></div>}
      {adjustmentsMinor !== 0 && <div className="flex justify-between py-2"><dt className="text-ink-2">Ajustes (reembolsos)</dt><dd>{adjustmentsMinor < 0 ? "− " : ""}{formatMoney(Math.abs(adjustmentsMinor))}</dd></div>}
      <div className="flex justify-between py-2.5 text-lg font-bold"><dt>Neto para vos</dt><dd>{formatMoney(netMinor + adjustmentsMinor)}</dd></div>
    </dl>
  );
}
