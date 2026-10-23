import { NextResponse } from "next/server";
import { optOutByToken } from "@/server/modules/supply-campaigns";
import { rateLimit } from "@/server/rate-limit";

/** Confirma la baja pedida desde el email de captación (el token firmado identifica al candidato). */
export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const url = new URL(req.url);
  try {
    await rateLimit(`optout:${ip}`, 20, 600);
  } catch {
    return new NextResponse("Demasiados intentos. Probá en unos minutos.", { status: 429 });
  }
  const form = await req.formData().catch(() => null);
  const t = String(form?.get("t") ?? "");
  const ok = await optOutByToken(t);
  return NextResponse.redirect(new URL(ok ? "/captacion/baja?listo=1" : `/captacion/baja?t=${encodeURIComponent(t)}`, url.origin), 303);
}
