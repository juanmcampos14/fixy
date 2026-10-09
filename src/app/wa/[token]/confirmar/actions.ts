"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { act, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import { env } from "@/server/env";
import { DRAFT_COOKIE, saveAnonymousDraft } from "@/server/modules/requests";
import { consumeWhatsAppLink } from "@/server/whatsapp/bot";
import { sendWhatsApp } from "@/server/whatsapp/client";

export async function linkWhatsAppAction(_: ActionState, f: FormData): Promise<ActionState> {
  const token = str(f, "token");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { error: "El link no es válido." };
  const actor = await requireActor(`/wa/${token}`);
  let target = "/solicitar?borrador=1";
  const r = await act(async () => {
    const res = await consumeWhatsAppLink(token, actor.id);
    if ("error" in res) return { error: res.error };
    // Link solo para vincular (sin pedido armado): vuelve a sus pedidos.
    if (!res.data?.description) {
      target = "/app";
      await sendWhatsApp(res.phone, { kind: "text", text: `Listo ${actor.fullName.split(" ")[0]}, tu WhatsApp quedó vinculado a tu cuenta de Fixy. Escribime *mis pedidos* para ver cómo van o mandame fotos para sumarlas.` }).catch(() => null);
      return;
    }
    const draft = await saveAnonymousDraft(null, res.data as unknown as Record<string, unknown>);
    (await cookies()).set(DRAFT_COOKIE, draft, { httpOnly: true, sameSite: "lax", secure: env().APP_URL.startsWith("https:"), path: "/", maxAge: 7 * 86400 });
    await sendWhatsApp(res.phone, { kind: "text", text: `Listo ${actor.fullName.split(" ")[0]}, tu WhatsApp quedó vinculado a tu cuenta de Fixy. La próxima vez enviás el pedido directo desde acá.` }).catch(() => null);
  });
  if (r.error) return r;
  redirect(target);
}
