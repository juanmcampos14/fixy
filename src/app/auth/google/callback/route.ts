import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { GOOGLE_COOKIE, finishGoogleLogin } from "@/server/auth/google";
import { signInWithGoogle } from "@/server/modules/users";
import { createSession } from "@/server/auth/session";
import { isDomainError } from "@/server/domain/errors";
import { rateLimit } from "@/server/rate-limit";
import { APP_CHALLENGE_COOKIE, createHandoff, validChallenge } from "@/server/auth/app-handoff";

export const dynamic = "force-dynamic";

const fail = (origin: string, msg: string) => NextResponse.redirect(new URL(`/ingresar?aviso=${encodeURIComponent(msg)}`, origin), 303);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get(GOOGLE_COOKIE)?.value;
  jar.delete({ name: GOOGLE_COOKIE, path: "/auth/google" });
  const appChallenge = jar.get(APP_CHALLENGE_COOKIE)?.value;
  jar.delete({ name: APP_CHALLENGE_COOKIE, path: "/auth/google" });
  if (url.searchParams.get("error")) return fail(url.origin, "Cancelaste el ingreso con Google.");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  let saved: { state: string; nonce: string; verifier: string; next: string } | null = null;
  try { saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
  if (!code || !state || !saved || !same(state, saved.state)) return fail(url.origin, "El ingreso con Google venció o no es válido. Probá de nuevo.");
  try {
    const h = await headers();
    await rateLimit(`google:${(h.get("x-forwarded-for") ?? "local").split(",")[0].trim()}`, 30, 600);
    const identity = await finishGoogleLogin(code, saved);
    const { userId } = await signInWithGoogle(identity);
    if (validChallenge(appChallenge)) {
      // No se abre sesión en este navegador: la sesión se crea dentro de la app al canjear el código.
      const handoff = await createHandoff(userId, appChallenge, saved.next || "/app");
      return NextResponse.redirect(new URL(`/auth/app/volver?code=${handoff}`, url.origin), 303);
    }
    await createSession(userId);
    return NextResponse.redirect(new URL(saved.next || "/app", url.origin), 303);
  } catch (e) {
    console.warn("[google] ingreso fallido");
    return fail(url.origin, isDomainError(e) ? e.message : "No pudimos ingresar con Google. Probá de nuevo.");
  }
}
