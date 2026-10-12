import { NextResponse } from "next/server";
import { GOOGLE_COOKIE, googleConfigured, startGoogleLogin } from "@/server/auth/google";
import { APP_CHALLENGE_COOKIE, validChallenge } from "@/server/auth/app-handoff";

export const dynamic = "force-dynamic";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/app");

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleConfigured()) return NextResponse.redirect(new URL("/ingresar?error=google", url.origin), 303);
  const { url: target, cookie } = startGoogleLogin(safeNext(url.searchParams.get("next")));
  const res = NextResponse.redirect(target, 303);
  const opts = { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/auth/google", maxAge: 600 } as const;
  res.cookies.set(GOOGLE_COOKIE, cookie, opts);
  // Ingreso iniciado desde la app (en el navegador del sistema): al terminar se vuelve a la app con un código.
  const app = url.searchParams.get("app");
  if (validChallenge(app)) res.cookies.set(APP_CHALLENGE_COOKIE, app, opts);
  else res.cookies.delete({ name: APP_CHALLENGE_COOKIE, path: "/auth/google" });
  return res;
}
