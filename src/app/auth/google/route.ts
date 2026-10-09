import { NextResponse } from "next/server";
import { GOOGLE_COOKIE, googleConfigured, startGoogleLogin } from "@/server/auth/google";

export const dynamic = "force-dynamic";

const safeNext = (n: string | null) => (n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/app");

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!googleConfigured()) return NextResponse.redirect(new URL("/ingresar?error=google", url.origin), 303);
  const { url: target, cookie } = startGoogleLogin(safeNext(url.searchParams.get("next")));
  const res = NextResponse.redirect(target, 303);
  res.cookies.set(GOOGLE_COOKIE, cookie, { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/auth/google", maxAge: 600 });
  return res;
}
