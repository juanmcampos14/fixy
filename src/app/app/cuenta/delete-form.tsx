"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/field";
import { deleteAccountAction } from "./actions";

export function DeleteAccountForm({ word }: { word: string }) {
  const [v, setV] = useState("");
  return (
    <ActionForm action={deleteAccountAction} className="mt-4 space-y-3">
      <Field label={`Para confirmar, escribí ${word}`} htmlFor="del-confirm" required>
        <Input id="del-confirm" name="confirmation" value={v} onChange={(e) => setV(e.target.value)} autoComplete="off" autoCapitalize="characters" />
      </Field>
      <SubmitButton variant="danger" disabled={v.trim().toUpperCase() !== word} pendingText="Eliminando…">Eliminar mi cuenta para siempre</SubmitButton>
    </ActionForm>
  );
}
