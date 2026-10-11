"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { computeBreakdown, parseArsToMinor, type CommissionRule } from "@/server/domain/money";
import { createQuoteAction } from "@/app/proveedor/actions";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { ITEM_KIND_LABEL } from "./constants";

type Item = { key: number; kind: "labor" | "materials" | "visit"; description: string; quantity: string; unitPrice: string };
type Mode = "quote" | "diagnostic" | "fixed";

const MODE_HELP: Record<Mode, string> = {
  quote: "Cotizás el trabajo completo con el alcance que describas.",
  diagnostic: "Cobrás solo la visita para revisar. La reparación se cotiza después como adicional, que el cliente acepta o no.",
  fixed: "Precio cerrado para un servicio de catálogo con alcance definido.",
};

export function QuoteForm({ invitationId, rule, allowFixed, windows, defaultDate }: { invitationId: string; rule: CommissionRule; allowFixed: boolean; windows: { key: string; label: string }[]; defaultDate: string }) {
  const [mode, setMode] = useState<Mode>("quote");
  const [seq, setSeq] = useState(2);
  const [items, setItems] = useState<Item[]>([{ key: 1, kind: "labor", description: "", quantity: "1", unitPrice: "" }]);

  const effectiveItems = mode === "diagnostic" ? items.map((i) => ({ ...i, kind: "visit" as const })) : items;

  const preview = useMemo(() => {
    let invalidRow = false;
    const sums = { labor: 0, materials: 0, visit: 0 };
    for (const i of effectiveItems) {
      const q = Number(i.quantity);
      const p = i.unitPrice.trim() ? parseArsToMinor(i.unitPrice) : 0;
      if (!Number.isInteger(q) || q < 1 || p == null) {
        invalidRow = true;
        continue;
      }
      sums[i.kind] += q * p;
    }
    try {
      return { b: computeBreakdown({ laborMinor: sums.labor, materialsMinor: sums.materials, visitMinor: sums.visit }, rule), invalidRow };
    } catch {
      return { b: null, invalidRow: true };
    }
  }, [effectiveItems, rule]);

  const update = (key: number, patch: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const payload = JSON.stringify(effectiveItems.map(({ kind, description, quantity, unitPrice }) => ({ kind, description, quantity, unitPrice })));

  return (
    <ActionForm action={createQuoteAction} className="space-y-5">
      <input type="hidden" name="invitationId" value={invitationId} />
      <input type="hidden" name="items" value={payload} />

      <fieldset>
        <legend className="mb-2 text-[15px] font-semibold">Tipo de propuesta</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {(["quote", "diagnostic", ...(allowFixed ? (["fixed"] as const) : [])] as Mode[]).map((m) => (
            <label key={m} className="flex min-h-11 cursor-pointer items-start gap-2 rounded-2xl p-3 ring-1 ring-line has-[:checked]:bg-fixy-50 has-[:checked]:ring-fixy-700">
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1 accent-fixy-700" />
              <span>
                <span className="block font-semibold">{m === "quote" ? "Presupuesto" : m === "diagnostic" ? "Visita de diagnóstico" : "Precio cerrado"}</span>
                <span className="block text-sm text-muted">{MODE_HELP[m]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label="Qué incluye (alcance)" htmlFor="q-scope" required hint="Contá con claridad qué vas a hacer. El cliente lo revisa antes de confirmar.">
        <Textarea id="q-scope" name="scope" required minLength={10} maxLength={4000} />
      </Field>
      <Field label="Qué no incluye" htmlFor="q-excl">
        <Textarea id="q-excl" name="exclusions" maxLength={2000} className="min-h-20" placeholder="Ej.: no incluye reparación de revoque ni pintura." />
      </Field>
      <Field label="¿Los materiales están incluidos en el precio?" htmlFor="q-mat" required>
        <Select id="q-mat" name="materialsIncluded" defaultValue="no">
          <option value="yes">Sí, están incluidos</option>
          <option value="no">No, los aporta el cliente o se cotizan aparte</option>
        </Select>
      </Field>

      <fieldset className="space-y-3">
        <legend className="text-[15px] font-semibold">Conceptos</legend>
        {mode === "diagnostic" && <p className="text-sm text-muted">En una visita de diagnóstico todos los conceptos se cobran como visita.</p>}
        {items.map((it, idx) => (
          <div key={it.key} className="rounded-2xl bg-cream/60 p-3 ring-1 ring-line">
            <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
              <Field label="Tipo" htmlFor={`it-kind-${it.key}`} required>
                <Select id={`it-kind-${it.key}`} value={mode === "diagnostic" ? "visit" : it.kind} disabled={mode === "diagnostic"} onChange={(e) => update(it.key, { kind: e.target.value as Item["kind"] })}>
                  {Object.entries(ITEM_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </Field>
              <Field label={`Descripción del concepto ${idx + 1}`} htmlFor={`it-desc-${it.key}`} required>
                <Input id={`it-desc-${it.key}`} value={it.description} maxLength={200} onChange={(e) => update(it.key, { description: e.target.value })} />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-[90px_1fr_auto] items-end gap-3">
              <Field label="Cantidad" htmlFor={`it-qty-${it.key}`} required>
                <Input id={`it-qty-${it.key}`} inputMode="numeric" value={it.quantity} onChange={(e) => update(it.key, { quantity: e.target.value.replace(/\D/g, "") })} />
              </Field>
              <Field label="Precio unitario ($)" htmlFor={`it-price-${it.key}`} required>
                <Input id={`it-price-${it.key}`} inputMode="decimal" placeholder="12.500" value={it.unitPrice} onChange={(e) => update(it.key, { unitPrice: e.target.value })} />
              </Field>
              <Button type="button" variant="ghost" className="h-12 w-12 px-0" aria-label={`Quitar concepto ${idx + 1}`} disabled={items.length === 1}
                onClick={() => setItems((xs) => xs.filter((x) => x.key !== it.key))}>
                <Trash2 className="h-5 w-5" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="soft" size="sm" disabled={items.length >= 30}
          onClick={() => { setItems((xs) => [...xs, { key: seq, kind: mode === "diagnostic" ? "visit" : "materials", description: "", quantity: "1", unitPrice: "" }]); setSeq(seq + 1); }}>
          <Plus className="h-4 w-4" aria-hidden /> Agregar concepto
        </Button>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Fecha propuesta" htmlFor="q-date">
          <Input id="q-date" name="proposedDate" type="date" min={defaultDate} />
        </Field>
        <Field label="Franja" htmlFor="q-window">
          <Select id="q-window" name="proposedWindow" defaultValue="">
            <option value="">A coordinar</option>
            {windows.map((w) => <option key={w.key} value={w.label}>{w.label}</option>)}
          </Select>
        </Field>
        <Field label="Vigencia (días)" htmlFor="q-valid" required hint="Entre 1 y 30.">
          <Input id="q-valid" name="validDays" type="number" min={1} max={30} defaultValue={7} required />
        </Field>
      </div>

      <section aria-live="polite" aria-labelledby="q-preview" className="rounded-2xl bg-surface p-4 ring-1 ring-line">
        <h3 id="q-preview" className="font-bold">Vista previa</h3>
        {preview.invalidRow && <p className="mt-1 text-sm text-warn">Hay importes o cantidades sin completar o con formato inválido.</p>}
        {preview.b && (
          <dl className="tabular mt-2 divide-y divide-line text-[15px]">
            <div className="flex justify-between gap-4 py-2"><dt className="text-ink-2">Importe bruto (tu presupuesto)</dt><dd>{formatMoney(preview.b.subtotalMinor)}</dd></div>
            <div className="flex justify-between gap-4 py-2"><dt className="text-ink-2">Comisión Fixy</dt><dd className="font-semibold text-ok">{preview.b.providerFeeMinor ? `− ${formatMoney(preview.b.providerFeeMinor)}` : "0 % · $ 0"}</dd></div>
            <div className="flex justify-between gap-4 py-2.5 text-lg font-bold"><dt>Neto para vos</dt><dd>{formatMoney(preview.b.providerNetMinor)}</dd></div>
            <div className="flex justify-between gap-4 py-2 text-muted">
              <dt>El cliente paga en total (incluye cargo de servicio de {rule.clientRateBps / 100} %{preview.b.clientFeeTaxMinor ? " e impuestos" : ""})</dt>
              <dd>{formatMoney(preview.b.totalMinor)}</dd>
            </div>
          </dl>
        )}
        <p className="mt-2 text-xs text-muted">Fixy no te cobra comisión (el cargo de servicio lo paga el cliente aparte). De lo que cobres se descuentan los costos de Mercado Pago e impuestos del cobro. El importe final se confirma al enviar.</p>
      </section>

      <SubmitButton size="lg" pendingText="Enviando presupuesto…" className="w-full sm:w-auto">Enviar presupuesto</SubmitButton>
    </ActionForm>
  );
}
