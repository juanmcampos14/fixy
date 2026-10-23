"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/button";

/** Crea una clave de la API y la muestra una sola vez para copiarla. */
export function ApiKeyForm({ action }: { action: (s: ActionState, f: FormData) => Promise<ActionState> }) {
  const [state, formAction] = useActionState(action, {});
  const [copied, setCopied] = useState(false);
  const key = typeof state.data?.key === "string" ? state.data.key : null;
  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {key && (
        <Alert tone="ok">
          <p className="font-semibold">{state.message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="break-all rounded-lg bg-surface px-2 py-1 text-sm">{key}</code>
            <button type="button" className={buttonClass("secondary", "sm")} onClick={async () => { try { await navigator.clipboard.writeText(key); setCopied(true); } catch {} }}>
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copiada" : "Copiar"}
            </button>
          </div>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        <Field label="Nombre" htmlFor="k-name" required hint="Para reconocerla: «GPT de captación», «Claude de Juan»…"><Input id="k-name" name="name" required minLength={3} maxLength={80} /></Field>
        <Field label="Vence" htmlFor="k-exp">
          <Select id="k-exp" name="expiresDays" defaultValue="90">
            <option value="30">En 30 días</option>
            <option value="90">En 90 días</option>
            <option value="365">En un año</option>
            <option value="">Nunca</option>
          </Select>
        </Field>
      </div>
      <SubmitButton>Crear clave</SubmitButton>
    </form>
  );
}
