import { NextResponse } from "next/server";
import { whatsappUrl } from "@/lib/contact";
import { recordInviteClick } from "@/server/modules/supply-campaigns";

export const dynamic = "force-dynamic";

/**
 * Link corto para invitar profesionales (fixy.solutions/alta): abre el WhatsApp de Fixy con el mensaje ya escrito.
 * `?ref=<perfil>` deja anotado quién lo invitó.
 */
export async function GET(req: Request) {
  // Los códigos de candidatos se reparten en mayúsculas (FX-012): se aceptan igual.
  const ref = (new URL(req.url).searchParams.get("ref") ?? "").trim().toLowerCase();
  const invite = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(ref) && ref.length <= 80 ? ` (invitación ${ref})` : "";
  // Clic en la invitación de una campaña de captación (FX-001…): queda en el historial del candidato.
  await recordInviteClick(ref, "whatsapp");
  return NextResponse.redirect(whatsappUrl(`Hola, quiero trabajar con Fixy${invite}`), 302);
}
