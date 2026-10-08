import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";

export const SIGNUP_COOKIE = "fixy_signup";

/** Guarda el origen de la campaña / referido y lleva al alta (o al registro si no hay sesión). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clean = (v: string | null) => (v ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  const origen = clean(url.searchParams.get("origen")) || "sumate";
  const ref = clean(url.searchParams.get("ref"));
  const actor = await getActor();
  const target = actor ? "/proveedor/alta" : "/registro?tipo=proveedor";
  const res = NextResponse.redirect(new URL(target, url.origin), 303);
  res.cookies.set(SIGNUP_COOKIE, JSON.stringify({ origen, ref }), { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/", maxAge: 30 * 86400 });
  return res;
}
