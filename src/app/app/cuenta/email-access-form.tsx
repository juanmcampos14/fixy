"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/field";
import { setEmailAccessAction } from "./actions";

/** Email y clave para quien se anotó por WhatsApp. La clave se ve mientras se escribe (se puede ocultar). */
export function EmailAccessForm({ currentEmail }: { currentEmail: string | null }) {
  const [show, setShow] = useState(true);
  return (
    <ActionForm action={setEmailAccessAction} className="grid gap-4">
      {(state) => (
        <>
          <Field label="Tu email" htmlFor="ea-email" required error={state.fieldErrors?.email}>
            <Input id="ea-email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={200} defaultValue={currentEmail ?? ""} placeholder="juan@gmail.com" />
          </Field>
          <Field label="Una clave" htmlFor="ea-pass" required hint="8 letras o números, como mínimo. Anotala en un papel para no olvidarla." error={state.fieldErrors?.password}>
            <div className="relative">
              <Input id="ea-pass" name="password" type={show ? "text" : "password"} autoComplete="new-password" autoCapitalize="none" spellCheck={false} required minLength={8} maxLength={200} className="pr-24" />
              <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-1.5 top-1.5 h-9 cursor-pointer rounded-lg px-3 text-sm text-fixy-800">{show ? "Ocultar" : "Mostrar"}</button>
            </div>
          </Field>
          <div><SubmitButton pendingText="Guardando…">{currentEmail ? "Cambiar email y clave" : "Guardar email y clave"}</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}
