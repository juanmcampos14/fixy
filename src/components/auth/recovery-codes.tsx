"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/form";

/**
 * Formulario con un campo de código que, si la acción devuelve códigos de respaldo, los muestra una sola vez para
 * que la persona los guarde.
 */
export function CodeForm({ action, label, submit, hidden }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; label: string; submit: string; hidden?: Record<string, string> }) {
  const [state, formAction] = useActionState(action, {});
  const codes = (state.data?.codes as string[] | undefined) ?? null;
  if (state.ok && codes) {
    return (
      <div className="space-y-3">
        <Alert tone="ok">{state.message}</Alert>
        <p className="text-sm text-ink-2"><strong className="text-ink">Guardá estos códigos de respaldo</strong> en un lugar seguro (gestor de contraseñas o papel). Cada uno sirve una sola vez si perdés el celular. No los vamos a volver a mostrar.</p>
        <ul className="grid grid-cols-2 gap-2 rounded-2xl bg-cream-2 p-4 font-mono text-[15px] tabular">
          {codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <a href="/admin" className="inline-block text-sm font-semibold text-fixy-800 underline">Ir al panel</a>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-3">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label htmlFor="code" className="block text-sm font-medium">{label}</label>
      <input id="code" name="code" required autoComplete="one-time-code" inputMode="text" maxLength={12}
        className="w-full rounded-xl border border-control bg-surface px-3 py-2.5 text-lg tracking-widest tabular" />
      <SubmitButton className="w-full" size="lg" pendingText="Verificando…">{submit}</SubmitButton>
    </form>
  );
}
