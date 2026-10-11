"use client";

import { useActionState } from "react";
import { loginAction, demoLoginAction } from "../actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email" required>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Contraseña" htmlFor="password" required>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Ingresando…">Ingresar</SubmitButton>
    </form>
  );
}

export function DemoLogin({ next, users }: { next: string; users: { email: string; name: string; desc: string }[] }) {
  const [state, action] = useActionState(demoLoginAction, {});
  return (
    <form action={action} className="mt-3">
      {state.error && <Alert tone="danger" className="mb-3">{state.error}</Alert>}
      <input type="hidden" name="next" value={next} />
      <ul className="grid gap-2">
        {users.map((u) => (
          <li key={u.email}>
            <button name="email" value={u.email} className="w-full rounded-2xl bg-surface p-3 text-left ring-1 ring-line transition hover:ring-fixy-500 focus-visible:ring-fixy-500">
              <span className="block font-semibold">{u.name}</span>
              <span className="block text-sm text-muted">{u.desc}</span>
            </button>
          </li>
        ))}
      </ul>
    </form>
  );
}
