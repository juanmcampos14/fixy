"use client";

import { useState } from "react";
import { computeBreakdown, parseArsToMinor, type CommissionRule } from "@/server/domain/money";
import { proposeExtraAction } from "@/app/proveedor/actions";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatMoney } from "@/lib/format";

/** Propuesta de adicional con vista previa del neto (mismas tasas que el contrato). */
export function ExtraForm({ jobId, rule, mainQuote }: { jobId: string; rule: CommissionRule; mainQuote?: { creditMinor: number } | null }) {
  const [labor, setLabor] = useState("");
  const [materials, setMaterials] = useState("");
  const l = labor.trim() ? parseArsToMinor(labor) : 0;
  const m = materials.trim() ? parseArsToMinor(materials) : 0;
  const discount = mainQuote && l != null && m != null ? Math.min(mainQuote.creditMinor, l + m) : 0;
  const b = l != null && m != null && l + m > 0 ? computeBreakdown({ laborMinor: l + m - discount, materialsMinor: 0, visitMinor: 0 }, rule) : null;
  return (
    <ActionForm action={proposeExtraAction} className="space-y-4" resetOnSuccess>
      <input type="hidden" name="jobId" value={jobId} />
      {mainQuote && <input type="hidden" name="isMainQuote" value="1" />}
      {mainQuote && <p className="rounded-2xl bg-fixy-50 p-3 text-[15px] text-fixy-800 ring-1 ring-fixy-200">Presupuesto del arreglo después de ver el problema. {mainQuote.creditMinor > 0 ? `Se descuenta la visita (${formatMoney(mainQuote.creditMinor)}).` : ""} El cliente lo aprueba (o no) en la app antes de que empieces.</p>}
      <Field label="Qué hay que hacer" htmlFor="ex-desc" required>
        <Textarea id="ex-desc" name="description" required minLength={5} maxLength={2000} className="min-h-20" />
      </Field>
      <Field label="Por qué es necesario" htmlFor="ex-reason" required>
        <Textarea id="ex-reason" name="reason" required minLength={5} maxLength={1000} className="min-h-20" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mano de obra ($)" htmlFor="ex-labor">
          <Input id="ex-labor" name="labor" inputMode="decimal" placeholder="0" value={labor} onChange={(e) => setLabor(e.target.value)} />
        </Field>
        <Field label="Materiales ($)" htmlFor="ex-mat">
          <Input id="ex-mat" name="materials" inputMode="decimal" placeholder="0" value={materials} onChange={(e) => setMaterials(e.target.value)} />
        </Field>
      </div>
      <div aria-live="polite" className="rounded-2xl bg-cream/60 p-3 text-[15px] ring-1 ring-line">
        {l == null || m == null ? (
          <p className="text-warn">Revisá el formato de los importes (por ejemplo: 12.500 o 12.500,50).</p>
        ) : b ? (
          <dl className="tabular space-y-1">
            {discount > 0 && <div className="flex justify-between gap-4"><dt className="text-ink-2">Descuento de la visita</dt><dd>− {formatMoney(discount)}</dd></div>}
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Bruto</dt><dd>{formatMoney(b.subtotalMinor)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Comisión Fixy</dt><dd className="font-semibold text-ok">{b.providerFeeMinor ? `− ${formatMoney(b.providerFeeMinor)}` : "0 % · $ 0"}</dd></div>
            <div className="flex justify-between gap-4 font-bold"><dt>Neto para vos</dt><dd>{formatMoney(b.providerNetMinor)}</dd></div>
            <div className="flex justify-between gap-4 text-muted"><dt>Total que paga el cliente</dt><dd>{formatMoney(b.totalMinor)}</dd></div>
          </dl>
        ) : (
          <p className="text-muted">Ingresá los importes para ver cuánto recibís.</p>
        )}
      </div>
      <p className="text-sm text-muted">{mainQuote ? "No se cobra ni se hace hasta que el cliente lo apruebe." : "El adicional no se cobra ni se hace hasta que el cliente lo acepte."}</p>
      <SubmitButton pendingText="Enviando…">{mainQuote ? "Enviar presupuesto del arreglo" : "Proponer adicional"}</SubmitButton>
    </ActionForm>
  );
}
