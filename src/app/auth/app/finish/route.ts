import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { redeemHandoff } from "@/server/auth/app-handoff";
import { createSession } from "@/server/auth/session";
import { rateLimit } from "@/server/rate-limit";

export const dynamic = "force-dynamic";

const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/app");

/** La app vuelve del navegador con el código: se canjea por la sesión dentro de la app. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = () => NextResponse.redirect(new URL(`/ingresar?aviso=${encodeURIComponent("No pudimos completar el ingreso con Google. Probá de nuevo.")}`, url.origin), 303);
  try {
    const h = await headers();
    await rateLimit(`app-handoff:${(h.get("x-forwarded-for") ?? "local").split(",")[0].trim()}`, 20, 600);
    const r = await redeemHandoff(url.searchParams.get("code") ?? "", url.searchParams.get("verifier") ?? "");
    if (!r) return fail();
    await createSession(r.userId);
    return NextResponse.redirect(new URL(safeNext(r.next), url.origin), 303);
  } catch {
    return fail();
  }
}
