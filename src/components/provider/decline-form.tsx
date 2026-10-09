"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Select, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/action-state";

type Colleague = { id: string; display_name: string; verified: boolean; covers_zone: boolean };

/** "No puedo tomarlo" con la opción de recomendar a un colega (gana el 10 % si el cliente acepta y el colega hace el trabajo). */
export function DeclineForm({ action, invitationId, colleagues, feePct }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; invitationId: string; colleagues: Colleague[]; feePct: number }) {
  const [open, setOpen] = useState(false);
  const [refer, setRefer] = useState("");
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="font-semibold text-fixy-800 underline">No puedo tomarlo</button>;
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="invitationId" value={invitationId} />
      <Field label="¿Por qué no podés? (no se le muestra al cliente)" htmlFor="dec-reason" required>
        <Textarea id="dec-reason" name="reason" rows={2} required minLength={3} maxLength={500} />
      </Field>
      <div className="rounded-2xl bg-fixy-50 p-4">
        <p className="font-semibold">¿Conocés a alguien que lo pueda hacer?</p>
        <p className="mt-1 text-sm text-ink-2">Recomendá a un colega de Fixy. Si el cliente acepta y tu colega hace el trabajo, <strong>ganás el {feePct} % de lo que él cobre</strong> por ese trabajo. Tu colega lo ve antes de aceptar.</p>
        {colleagues.length ? (
          <div className="mt-3 space-y-3">
            <Field label="Colega" htmlFor="dec-refer">
              <Select id="dec-refer" name="referTo" value={refer} onChange={(e) => setRefer(e.target.value)}>
                <option value="">No recomendar a nadie</option>
                {colleagues.map((c) => <option key={c.id} value={c.id}>{c.display_name}{c.covers_zone ? "" : " (otra zona)"}{c.verified ? "" : " · sin verificar"}</option>)}
              </Select>
            </Field>
            {refer && (
              <Field label="Mensaje para el cliente (opcional)" htmlFor="dec-note" hint="Ej.: trabajamos juntos hace años, es muy prolijo.">
                <Textarea id="dec-note" name="referNote" rows={2} maxLength={500} />
              </Field>
            )}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Todavía no hay otros profesionales de este rubro en Fixy. Invitá a tus colegas desde <a href="/proveedor/recomendaciones" className="underline">Recomendaciones</a>.</p>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <SubmitButton variant="secondary" pendingText="Enviando…">{refer ? "No lo tomo y recomiendo" : "No lo tomo"}</SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted underline">Volver</button>
      </div>
    </ActionForm>
  );
}
