"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { act, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor, SESSION_COOKIE } from "@/server/auth/session";
import { deleteAccount } from "@/server/modules/account";
import { setEmailAccess } from "@/server/modules/users";
import { revalidatePath } from "next/cache";

export async function deleteAccountAction(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const actor = await requireActor("/app/cuenta");
    await deleteAccount(actor, str(f, "confirmation"));
  });
  if (r.error) return r;
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete("fixy_draft");
  redirect("/?cuenta=eliminada");
}

/** Cuenta creada por WhatsApp: suma email y clave para entrar también desde la pantalla de ingreso. */
export async function setEmailAccessAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor("/app/cuenta");
    await setEmailAccess(actor, { email: str(f, "email"), password: str(f, "password") });
    revalidatePath("/app/cuenta");
    return { ok: true, message: "Listo. Ya podés entrar con ese email y esa clave." };
  });
}
