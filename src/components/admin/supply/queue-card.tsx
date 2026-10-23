"use client";

import { useActionState, useState } from "react";
import { MessageCircle } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";

type Item = { campaignLeadId: string; code: string; businessName: string; trade: string | null; place: string | null; attempt: number; followup: boolean; message: string; waUrl: string | null };

/**
 * Envío asistido: se abre WhatsApp (desde el número comercial) con el mensaje armado, la persona lo manda y
 * recién ahí puede marcarlo como enviado. Un candidato por vez (usar key={campaignLeadId} para reiniciarla).
 */
export function QueueCard({ item, campaignId, action }: { item: Item; campaignId: string; action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [opened, setOpened] = useState(false);
  const [state, formAction] = useActionState(action, {});
  return (
    <div className="rounded-3xl bg-surface p-5 ring-1 ring-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">{item.businessName}</h3>
        <span className="text-sm text-muted">{item.code} · {item.followup ? `Seguimiento (intento ${item.attempt})` : "Primer mensaje"}</span>
      </div>
      <p className="text-sm text-muted">{[item.trade, item.place].filter(Boolean).join(" · ")}</p>
      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-2xl bg-cream-2 p-4 font-sans text-[15px] leading-relaxed">{item.message}</pre>
      {state.error && <Alert tone="danger" className="mt-3">{state.error}</Alert>}
      <form action={formAction} className="mt-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="campaignLeadId" value={item.campaignLeadId} />
        <input type="hidden" name="campaignId" value={campaignId} />
        {item.waUrl ? (
          <a href={item.waUrl} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)} className={buttonClass(opened ? "secondary" : "primary", "md")}>
            <MessageCircle className="h-5 w-5" aria-hidden />{opened ? "Volver a abrir WhatsApp" : "1. Abrir WhatsApp"}
          </a>
        ) : <span className="text-sm text-danger">No tiene un celular válido.</span>}
        <SubmitButton name="outcome" value="sent" disabled={!opened} pendingText="Guardando…">2. Ya lo mandé</SubmitButton>
        <select name="reason" aria-label="Motivo para saltear" defaultValue="No tiene WhatsApp" className="h-11 rounded-full border border-control bg-surface px-3 text-sm">
          <option>No tiene WhatsApp</option>
          <option>Número equivocado</option>
          <option>No corresponde invitarlo</option>
        </select>
        <SubmitButton name="outcome" value="skip" variant="ghost">Saltear</SubmitButton>
      </form>
      {!opened && item.waUrl && <p className="mt-2 text-xs text-muted">Abrí WhatsApp desde el teléfono o la computadora con el número comercial, revisá el mensaje y mandalo. Después marcá «Ya lo mandé».</p>}
    </div>
  );
}
