/**
 * Link que manda el bot de WhatsApp para terminar el pedido en la web.
 * Sin sesión → registro (y vuelve acá). Con sesión → vincula el número a la cuenta, guarda el pedido como borrador y lo abre listo para enviar.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getActor } from "@/server/auth/session";
import { DRAFT_COOKIE, saveAnonymousDraft } from "@/server/modules/requests";
import { consumeWhatsAppLink } from "@/server/whatsapp/bot";
import { sendWhatsApp } from "@/server/whatsapp/client";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(req.url);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return NextResponse.redirect(new URL("/solicitar", url.origin), 303);
  const actor = await getActor();
  if (!actor) return NextResponse.redirect(new URL(`/registro?next=${encodeURIComponent(`/wa/${token}`)}&origen=whatsapp`, url.origin), 303);
  const r = await consumeWhatsAppLink(token, actor.id);
  if ("error" in r) return NextResponse.redirect(new URL(`/solicitar?aviso=${encodeURIComponent(r.error)}`, url.origin), 303);
  const draft = await saveAnonymousDraft(null, r.data as unknown as Record<string, unknown>);
  (await cookies()).set(DRAFT_COOKIE, draft, { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/", maxAge: 7 * 86400 });
  await sendWhatsApp(r.phone, { kind: "text", text: `Listo ${actor.fullName.split(" ")[0]}, tu WhatsApp quedó vinculado a tu cuenta de Fixy. La próxima vez enviás el pedido directo desde acá.` }).catch(() => null);
  return NextResponse.redirect(new URL("/solicitar?borrador=1", url.origin), 303);
}
