"use client";

import { useState } from "react";
import { HandCoins, TrendingDown } from "lucide-react";
import { placeBidAction } from "@/app/proveedor/actions";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatMoney } from "@/lib/format";

/**
 * Oferta en un pedido con presupuesto del cliente.
 * - Primera vez: "me anoto por tu presupuesto" u "ofrezco menos".
 * - Con una oferta vigente (replacing): solo se puede bajar.
 */
export function BidForm({ invitationId, budgetMinor, bestOfferMinor, replacing, currentMinor, windows, defaultDate }: {
  invitationId: string; budgetMinor: number; bestOfferMinor: number | null; replacing?: string; currentMinor?: number;
  windows: string[]; defaultDate: string;
}) {
  const [choice, setChoice] = useState<"budget" | "lower">(replacing ? "lower" : "budget");
  const cap = replacing && currentMinor ? currentMinor : budgetMinor;
  return (
    <ActionForm action={placeBidAction} className="space-y-4">
      <input type="hidden" name="invitationId" value={invitationId} />
      <input type="hidden" name="budgetMinor" value={budgetMinor} />
      {replacing && <input type="hidden" name="replacing" value={replacing} />}
      <input type="hidden" name="choice" value={choice} />

      {!replacing && (
        <fieldset>
          <legend className="sr-only">Tu oferta</legend>
          <div className="grid gap-2">
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl p-3 ring-1 ring-line has-[:checked]:bg-fixy-50 has-[:checked]:ring-fixy-700">
              <input type="radio" name="_choice" checked={choice === "budget"} onChange={() => setChoice("budget")} className="mt-1" />
              <span><span className="flex items-center gap-1.5 font-semibold"><HandCoins className="h-4 w-4" aria-hidden />Me anoto por {formatMoney(budgetMinor)}</span>
                <span className="block text-sm text-muted">Hacés el trabajo por lo que propone el cliente.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl p-3 ring-1 ring-line has-[:checked]:bg-fixy-50 has-[:checked]:ring-fixy-700">
              <input type="radio" name="_choice" checked={choice === "lower"} onChange={() => setChoice("lower")} className="mt-1" />
              <span><span className="flex items-center gap-1.5 font-semibold"><TrendingDown className="h-4 w-4" aria-hidden />Ofrezco menos</span>
                <span className="block text-sm text-muted">Un precio más bajo te ayuda a que te elijan.</span></span>
            </label>
          </div>
        </fieldset>
      )}

      {choice === "lower" && (
        <Field label={replacing ? "Tu nueva oferta (ARS)" : "Tu oferta (ARS)"} htmlFor="bid-amount" hint={`Menor a ${formatMoney(cap)}.${bestOfferMinor ? ` La oferta más baja hasta ahora es ${formatMoney(bestOfferMinor)}.` : ""}`}>
          <Input id="bid-amount" name="amount" inputMode="decimal" required placeholder="45.000" />
        </Field>
      )}

      {!replacing && (
        <>
          <Field label="¿Incluye materiales?" htmlFor="bid-materials">
            <Select id="bid-materials" name="materialsIncluded" defaultValue="yes">
              <option value="yes">Sí, materiales incluidos</option>
              <option value="no">No, solo mano de obra</option>
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fecha que proponés" htmlFor="bid-date"><Input id="bid-date" name="proposedDate" type="date" min={defaultDate} /></Field>
            <Field label="Horario" htmlFor="bid-window">
              <Select id="bid-window" name="proposedWindow" defaultValue="">
                <option value="">A coordinar</option>
                {windows.map((w) => <option key={w} value={w}>{w}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Comentario para el cliente (opcional)" htmlFor="bid-note" hint="Qué incluye, experiencia en trabajos parecidos. Sin teléfonos ni datos de contacto.">
            <Textarea id="bid-note" name="note" rows={3} maxLength={1000} />
          </Field>
        </>
      )}
      <p className="text-sm text-muted">Fixy no te cobra comisión: recibís tu oferta menos los costos de cobro de Mercado Pago. El cliente paga además su cargo de servicio.</p>
      <SubmitButton size="lg" pendingText="Enviando…">{replacing ? "Bajar mi oferta" : choice === "budget" ? `Anotarme por ${formatMoney(budgetMinor)}` : "Enviar mi oferta"}</SubmitButton>
    </ActionForm>
  );
}
