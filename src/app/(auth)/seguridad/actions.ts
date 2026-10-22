"use server";

import { redirect } from "next/navigation";
import { act, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { markSessionMfaVerified, requireActor, rotateSession } from "@/server/auth/session";
import { confirmMfaEnrollment, regenerateRecoveryCodes, verifyMfaCode } from "@/server/modules/mfa";
import { remainingRecoveryCodes } from "@/server/auth/mfa";
import { sql } from "@/server/db/client";

/** Solo rutas internas: evita redirecciones abiertas. */
const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/admin");

/** Confirma el alta del segundo factor: la sesión queda verificada y se muestran los códigos de respaldo. */
export async function confirmEnrollmentAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor("/seguridad/segundo-factor");
    const codes = await confirmMfaEnrollment(actor, str(f, "code"));
    await markSessionMfaVerified();
    return { ok: true, message: "Listo: el segundo factor quedó activado.", data: { codes } };
  });
}

/** Confirma el código al entrar al panel (o antes de una acción sensible). Cambia el token de la sesión. */
export async function verifyCodeAction(_: ActionState, f: FormData): Promise<ActionState> {
  const next = safeNext(str(f, "next"));
  let left: number | null = null;
  const r = await act(async () => {
    const actor = await requireActor(`/seguridad/verificar?next=${encodeURIComponent(next)}`);
    const { recovery } = await verifyMfaCode(actor, str(f, "code"));
    await rotateSession({ mfaVerified: true });
    if (recovery) left = await remainingRecoveryCodes(sql(), actor.id);
  });
  if (r.error) return r;
  redirect(left !== null ? `/seguridad/segundo-factor?respaldo=${left}` : next);
}

export async function regenerateCodesAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor("/seguridad/segundo-factor");
    const codes = await regenerateRecoveryCodes(actor, str(f, "code"));
    return { ok: true, message: "Códigos nuevos generados. Los anteriores ya no sirven.", data: { codes } };
  });
}
