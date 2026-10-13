import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import { GuidedSignup } from "@/components/sumate/guided-signup";

export const metadata: Metadata = { title: "Sumate a Fixy", description: "Anotate como profesional en pocos pasos: tu oficio, tu zona y tus datos." };
export const dynamic = "force-dynamic";

/** Alta guiada de profesionales en la web: una pregunta por pantalla. (El alta por WhatsApp es /alta.) */
export default async function StartPage() {
  const actor = await getActor();
  if (actor?.providers.length) redirect("/proveedor");
  const [categories, zones] = await Promise.all([
    sql()<{ id: string; name: string; icon: string }[]>`select id, name, icon from categories where active and not requires_review order by sort, name`,
    sql()<{ id: string; code: string; name: string; region: string; province: string | null; catch_all: boolean; match_names: string[] }[]>`
      select id, code, name, region, province, catch_all, match_names from zones where active and region <> 'OTRA' order by sort, name`,
  ]);
  return <GuidedSignup categories={categories} zones={zones} signedInName={actor?.fullName ?? null} />;
}
