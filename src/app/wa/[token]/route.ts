/**
 * Link que manda el bot de WhatsApp para terminar el pedido en la web.
 * Sin sesión → registro (y vuelve acá). Con sesión → pantalla de confirmación: vincular un teléfono
 * nunca ocurre con un GET, para que un link ajeno no pueda atar otro WhatsApp a tu cuenta.
 */
import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = new URL(req.url);
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return NextResponse.redirect(new URL("/solicitar", url.origin), 303);
  const actor = await getActor();
  if (!actor) return NextResponse.redirect(new URL(`/registro?next=${encodeURIComponent(`/wa/${token}`)}&origen=whatsapp`, url.origin), 303);
  return NextResponse.redirect(new URL(`/wa/${token}/confirmar`, url.origin), 303);
}
