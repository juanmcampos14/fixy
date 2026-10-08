"use server";

import { revalidatePath } from "next/cache";
import { act, files, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import { markNotificationsRead, sendMessage } from "@/server/modules/messaging";

export async function sendMessageAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const [file] = await files(f, "file");
    await sendMessage(actor, str(f, "conversationId"), str(f, "body"), file);
    revalidatePath(str(f, "path") || "/");
    return { ok: true };
  });
}

export async function markAllReadAction() {
  const actor = await requireActor();
  await markNotificationsRead(actor);
  revalidatePath("/notificaciones");
}
