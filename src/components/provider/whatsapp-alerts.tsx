"use client";

import { useActionState } from "react";
import { BellRing, MessageCircle } from "lucide-react";
import { whatsappAlertsCodeAction, whatsappAlertsToggleAction } from "@/app/proveedor/actions";
import { SubmitButton } from "@/components/ui/form";
import { WHATSAPP_NUMBER } from "@/lib/contact";

/** Tarjeta "Avisos por WhatsApp" del panel del profesional. */
export function WhatsAppAlerts({ linked, phoneTail, on }: { linked: boolean; phoneTail: string | null; on: boolean }) {
  const [codeState, getCode] = useActionState(whatsappAlertsCodeAction, {});
  const [toggleState, toggle] = useActionState(whatsappAlertsToggleAction, {});
  const code = typeof codeState.data?.code === "string" ? codeState.data.code : null;
  const waLink = code ? `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Quiero recibir los pedidos de Fixy por WhatsApp. Mi código: ${code}`)}` : null;

  return (
    <div className="space-y-3">
      <p className="flex items-start gap-2 text-[15px] text-ink-2">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />
        <span>Te avisamos al instante cuando hay un pedido de tu rubro y zona, cuando un cliente te elige y cuando te contratan. Responder rápido te ayuda a ganar más trabajos.</span>
      </p>
      {on ? (
        <form action={toggle} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="on" value="0" />
          <span className="rounded-full bg-ok-bg px-3 py-1 text-sm font-semibold text-ok">Activados en el WhatsApp terminado en {phoneTail}</span>
          <SubmitButton variant="ghost" size="sm" pendingText="Desactivando…">Desactivar</SubmitButton>
        </form>
      ) : linked && !code ? (
        <form action={toggle} className="space-y-2">
          <input type="hidden" name="on" value="1" />
          <p className="text-sm text-muted">Tu WhatsApp terminado en {phoneTail} ya está vinculado.</p>
          <SubmitButton size="sm" pendingText="Activando…">Activar avisos por WhatsApp</SubmitButton>
        </form>
      ) : waLink ? (
        <div className="space-y-2 rounded-2xl bg-cream/60 p-4 ring-1 ring-line">
          <p className="text-[15px]">Mandanos este código desde <strong>tu</strong> WhatsApp (vence en 30 minutos):</p>
          <p className="tabular font-display text-3xl font-extrabold tracking-widest">{code}</p>
          <a href={waLink} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center gap-2 rounded-full bg-[#25D366] px-5 font-semibold text-ink hover:brightness-95">
            <MessageCircle className="h-5 w-5" aria-hidden />Abrir WhatsApp y enviar
          </a>
          <p className="text-xs text-muted">Al enviarlo aceptás recibir avisos de Fixy por WhatsApp. Te das de baja cuando quieras escribiendo BAJA.</p>
        </div>
      ) : (
        <form action={getCode}>
          <SubmitButton size="sm" pendingText="Generando código…">Recibir avisos por WhatsApp</SubmitButton>
        </form>
      )}
      {(codeState.error || toggleState.error) && <p role="alert" className="text-sm text-danger">{codeState.error ?? toggleState.error}</p>}
    </div>
  );
}
