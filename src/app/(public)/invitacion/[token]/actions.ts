"use server";

import { redirect } from "next/navigation";
import { act, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import { acceptInvitation } from "@/server/modules/team";

export async function acceptInvitationAction(_: ActionState, f: FormData): Promise<ActionState> {
  const token = str(f, "token");
  const r = await act(async () => {
    await acceptInvitation(await requireActor(`/invitacion/${token}`), token);
  });
  if (r.error) return r;
  redirect("/admin");
}
