import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import { cookies } from "next/headers";
import { GuidedSignup } from "@/components/sumate/guided-signup";
import { readSignupCookie } from "@/lib/signup-origin";

export const metadata: Metadata = { title: "Sumate a Fixy", description: "Anotate como profesional en pocos pasos: tu oficio, tu zona y tus datos." };
export const dynamic = "force-dynamic";

/** Alta guiada de profesionales en la web: una pregunta por pantalla. (El alta por WhatsApp es /alta.) */
export default async function StartPage() {
  const actor = await getActor();
  if (actor?.providers.length) redirect("/proveedor");
  const [categories, zones] = await Promise.all([
    sql()<{ id: string; slug: string; name: string; icon: string }[]>`select id, slug, name, icon from categories where active and not requires_review order by sort, name`,
    sql()<{ id: string; code: string; name: string; region: string; province: string | null; catch_all: boolean; match_names: string[] }[]>`
      select id, code, name, region, province, catch_all, match_names from zones where active and region <> 'OTRA' order by sort, name`,
  ]);
  // Si llegó desde la landing de un oficio, ese oficio ya viene elegido.
  const { oficio } = readSignupCookie((await cookies()).get("fixy_signup")?.value);
  const initialTrade = categories.find((c) => c.slug === oficio)?.id ?? null;
  return <GuidedSignup categories={categories} zones={zones} signedInName={actor?.fullName ?? null} initialTrade={initialTrade} />;
}
