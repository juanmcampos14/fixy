"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { act, bool, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { authenticate, registerSchema, registerUser, requestPasswordReset, resetPassword } from "@/server/modules/users";
import { createSession, destroySession } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { demoLoginEnabled } from "@/server/env";
import { sql } from "@/server/db/client";
import { DomainError } from "@/server/domain/errors";

/** Solo rutas internas: evita redirecciones abiertas. */
function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/app";
}

async function clientKey() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "local").trim();
}

export async function loginAction(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const email = str(f, "email").trim().toLowerCase();
    await rateLimit(`login:${await clientKey()}`, 20, 600);
    await rateLimit(`login:${email}`, 8, 600);
    const userId = await authenticate(email, str(f, "password"));
    await createSession(userId);
  });
  if (r.error) return r;
  redirect(safeNext(str(f, "next")));
}

export async function registerAction(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    await rateLimit(`register:${await clientKey()}`, 10, 3600);
    const userId = await registerUser(
      registerSchema.parse({ fullName: str(f, "fullName"), email: str(f, "email"), phone: str(f, "phone"), password: str(f, "password"), acceptTerms: bool(f, "acceptTerms") }),
    );
    await createSession(userId);
  });
  if (r.error) return r;
  redirect(safeNext(str(f, "next")));
}

/** Acceso directo a cuentas de demostración. Deshabilitado en producción y solo para usuarios is_demo. */
export async function demoLoginAction(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    if (!demoLoginEnabled()) throw new DomainError("forbidden", "Los accesos de demostración no están habilitados.");
    const [u] = await sql()<{ id: string }[]>`select id from users where email = ${str(f, "email")} and is_demo`;
    if (!u) throw new DomainError("not_found", "Cuenta de demostración inexistente.");
    await createSession(u.id);
  });
  if (r.error) return r;
  redirect(safeNext(str(f, "next")));
}

export async function logoutAction() {
  await destroySession();
  (await cookies()).delete("fixy_draft");
  redirect("/");
}

export async function requestResetAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await rateLimit(`reset:${await clientKey()}`, 5, 3600);
    await requestPasswordReset(str(f, "email"));
    return { ok: true, message: "Si el email está registrado, te enviamos un enlace para restablecer la contraseña. Revisá tu correo." };
  });
}

export async function resetPasswordAction(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    await rateLimit(`reset-confirm:${await clientKey()}`, 10, 3600);
    await resetPassword(str(f, "token"), str(f, "password"));
  });
  if (r.error) return r;
  redirect("/ingresar?restablecida=1");
}
