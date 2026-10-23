import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { pickUtm } from "@/lib/signup-origin";

export const SIGNUP_COOKIE = "fixy_signup";

/** Guarda el origen de la campaña / referido y lleva al alta guiada. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const clean = (v: string | null) => (v ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  const origen = clean(url.searchParams.get("origen")) || clean(url.searchParams.get("utm_source")) || "sumate";
  const ref = clean(url.searchParams.get("ref"));
  // Campaña (Meta / Google Ads…) y oficio / zona de la landing, para atribuir el alta y precargar el oficio.
  const utm = pickUtm(url.searchParams);
  const oficio = clean(url.searchParams.get("oficio"));
  const zona = clean(url.searchParams.get("zona"));
  const actor = await getActor();
  // Alta guiada (una pregunta por pantalla). Quien ya tiene perfil va a su alta; el formulario completo sigue en /registro?tipo=proveedor.
  const target = actor?.providers.length ? "/proveedor/alta" : "/sumate/empezar";
  const res = NextResponse.redirect(new URL(target, url.origin), 303);
  res.cookies.set(SIGNUP_COOKIE, JSON.stringify({ origen, ref, utm, oficio, zona }), { httpOnly: true, sameSite: "lax", secure: url.protocol === "https:", path: "/", maxAge: 30 * 86400 });
  return res;
}
