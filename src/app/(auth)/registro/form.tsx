"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction } from "../actions";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { FieldError, SubmitButton } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";

export function RegisterForm({ next }: { next: string }) {
  const [s, action] = useActionState(registerAction, {});
  const fe = (k: string) => s.fieldErrors?.[k]?.[0];
  return (
    <form action={action} className="space-y-4">
      {s.error && <Alert tone="danger">{s.error}</Alert>}
      <input type="hidden" name="next" value={next} />
      <Field label="Nombre y apellido" htmlFor="fullName" required error={fe("fullName")}>
        <Input id="fullName" name="fullName" autoComplete="name" required invalid={!!fe("fullName")} />
      </Field>
      <Field label="Email" htmlFor="email" required error={fe("email")}>
        <Input id="email" name="email" type="email" autoComplete="email" required invalid={!!fe("email")} />
      </Field>
      <Field label="Teléfono" htmlFor="phone" hint="Lo usamos para coordinar trabajos. No se publica." error={fe("phone")}>
        <Input id="phone" name="phone" type="tel" autoComplete="tel" />
      </Field>
      <Field label="Contraseña" htmlFor="password" required hint="Mínimo 8 caracteres." error={fe("password")}>
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required invalid={!!fe("password")} />
      </Field>
      <div>
        <Checkbox name="acceptTerms" required label={<>Acepto los <Link href="/terminos" className="underline" target="_blank">términos</Link> y la <Link href="/privacidad" className="underline" target="_blank">política de privacidad</Link> de Fixy.</>} />
        <FieldError state={s} name="acceptTerms" />
      </div>
      <SubmitButton className="w-full" size="lg" pendingText="Creando cuenta…">Crear cuenta</SubmitButton>
    </form>
  );
}
