"use client";

import { useState } from "react";
import { computeBreakdown, parseArsToMinor, type CommissionRule } from "@/server/domain/money";
import { proposeExtraAction } from "@/app/proveedor/actions";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Textarea } from "@/components/ui/field";
import { formatMoney } from "@/lib/format";

/** Propuesta de adicional con vista previa del neto (mismas tasas que el contrato). */
export function ExtraForm({ jobId, rule }: { jobId: string; rule: CommissionRule }) {
  const [labor, setLabor] = useState("");
  const [materials, setMaterials] = useState("");
  const l = labor.trim() ? parseArsToMinor(labor) : 0;
  const m = materials.trim() ? parseArsToMinor(materials) : 0;
  const b = l != null && m != null && l + m > 0 ? computeBreakdown({ laborMinor: l, materialsMinor: m, visitMinor: 0 }, rule) : null;
  return (
    <ActionForm action={proposeExtraAction} className="space-y-4" resetOnSuccess>
      <input type="hidden" name="jobId" value={jobId} />
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
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Bruto</dt><dd>{formatMoney(b.subtotalMinor)}</dd></div>
            <div className="flex justify-between gap-4"><dt className="text-ink-2">Comisión Fixy ({rule.providerRateBps / 100} %)</dt><dd>− {formatMoney(b.providerFeeMinor)}</dd></div>
            <div className="flex justify-between gap-4 font-bold"><dt>Neto para vos</dt><dd>{formatMoney(b.providerNetMinor)}</dd></div>
            <div className="flex justify-between gap-4 text-muted"><dt>Total que paga el cliente</dt><dd>{formatMoney(b.totalMinor)}</dd></div>
          </dl>
        ) : (
          <p className="text-muted">Ingresá los importes para ver cuánto recibís.</p>
        )}
      </div>
      <p className="text-sm text-muted">El adicional no se cobra ni se hace hasta que el cliente lo acepte.</p>
      <SubmitButton pendingText="Enviando…">Proponer adicional</SubmitButton>
    </ActionForm>
  );
}
