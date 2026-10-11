"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import type { ActionState } from "@/lib/action-state";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-sm text-muted">{label}</span>
      <code className="min-w-0 flex-1 break-all text-sm">{value}</code>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(value).then(() => setCopied(true)); }}
        className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm ring-1 ring-control hover:bg-cream-2">
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

/** Genera (o renueva) las cuentas que piden Apple y Google para revisar la app. */
export function ReviewAccounts({ action, exists }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; exists: boolean }) {
  return (
    <ActionForm action={action} className="space-y-3">
      {(state) => {
        const d = state.data as { clientEmail: string; providerEmail: string; password: string } | undefined;
        return (
          <>
            {d && (
              <div className="space-y-2 rounded-2xl bg-ok-bg p-4">
                <CopyRow label="Cliente" value={d.clientEmail} />
                <CopyRow label="Profesional" value={d.providerEmail} />
                <CopyRow label="Contraseña" value={d.password} />
                <p className="text-xs text-muted">La misma contraseña sirve para las dos cuentas. Cargala en App Store Connect («Información para la revisión») y en Google Play («Acceso a la app»).</p>
              </div>
            )}
            <SubmitButton pendingText="Generando…">{exists || d ? "Renovar contraseña" : "Generar cuentas"}</SubmitButton>
          </>
        );
      }}
    </ActionForm>
  );
}
