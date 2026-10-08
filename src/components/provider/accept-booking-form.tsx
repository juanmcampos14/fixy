"use client";

import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatMoney } from "@/lib/format";
import { acceptBookingAction } from "@/app/proveedor/actions";

export function AcceptBookingForm({ invitationId, visitFeeMinor, visitFeeCredited, windows, defaultDate, gated = false }: { gated?: boolean; invitationId: string; visitFeeMinor: number; visitFeeCredited: boolean; windows: string[]; defaultDate: string }) {
  return (
    <ActionForm action={acceptBookingAction} className="space-y-4">
      <input type="hidden" name="invitationId" value={invitationId} />
      <div className="rounded-2xl bg-cream/60 p-3 text-[15px] ring-1 ring-line">
        <p><span className="font-semibold">Tu visita:</span> {visitFeeMinor > 0 ? `${formatMoney(visitFeeMinor)}${visitFeeCredited ? " (se descuenta si el cliente contrata el arreglo)" : ""}` : "sin cargo"}.</p>
        <p className="mt-1 text-sm text-muted">Lo configurás en <Link href="/proveedor/perfil#visita" className="underline">tu perfil</Link>. En el lugar vas a presupuestar el arreglo desde la app.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Día propuesto para la visita" htmlFor="ab-date" required>
          <Input id="ab-date" name="proposedDate" type="date" min={defaultDate} defaultValue={defaultDate} required />
        </Field>
        <Field label="Franja" htmlFor="ab-window" required>
          <Select id="ab-window" name="proposedWindow" required defaultValue={windows[0]}>
            {windows.map((w) => <option key={w} value={w}>{w}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Mensaje para el cliente" htmlFor="ab-note" hint="Opcional. Ej.: qué conviene tener a mano para la visita.">
        <Textarea id="ab-note" name="note" rows={2} maxLength={1000} />
      </Field>
      {gated && (
        <label className="flex items-start gap-3 rounded-2xl bg-warn-bg p-3 text-[15px]">
          <input type="checkbox" name="accessAcknowledged" value="true" required className="mt-1 h-5 w-5 accent-fixy-700" />
          <span>Leí los requisitos de ingreso del barrio y voy a llevar todo lo necesario (seguros, documentación de la persona y del vehículo).</span>
        </label>
      )}
      <SubmitButton pendingText="Aceptando…">Aceptar y proponer visita</SubmitButton>
      <p className="text-xs text-muted">La dirección y los datos de acceso se comparten cuando el cliente confirma la visita. No compartas teléfonos ni datos de pago por fuera de Fixy.</p>
    </ActionForm>
  );
}
