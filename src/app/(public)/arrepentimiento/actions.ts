"use server";

import { headers } from "next/headers";
import { act, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { getActor } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";
import { createRevocation } from "@/server/modules/revocations";

export async function revocationAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const h = await headers();
    await rateLimit(`revocation:${h.get("x-forwarded-for") ?? "local"}`, 10, 3600);
    const code = await createRevocation(await getActor(), { fullName: str(f, "fullName"), email: str(f, "email"), reference: str(f, "reference"), details: str(f, "details") });
    return { ok: true, message: `Recibimos tu pedido. Tu código de seguimiento es ${code}. Te respondemos por correo dentro de las 24 horas.` };
  });
}
