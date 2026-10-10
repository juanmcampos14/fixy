"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { act, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor, SESSION_COOKIE } from "@/server/auth/session";
import { deleteAccount } from "@/server/modules/account";

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
