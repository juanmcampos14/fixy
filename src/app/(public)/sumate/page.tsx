import type { Metadata } from "next";
import { SumateLanding } from "@/components/sumate/landing";
import { pickUtm } from "@/lib/signup-origin";

export const metadata: Metadata = {
  title: "Sumate como profesional",
  description: "Recibí pedidos de trabajos en tu zona, en toda la Argentina. Cotizá con tu precio y cobrá dentro de Fixy. Alta sin costo.",
  openGraph: { title: "Sumate a Fixy · Tu oficio, más oportunidades", description: "Recibí pedidos en tu zona y cobrá dentro de la plataforma. Alta sin costo.", type: "website", locale: "es_AR" },
};

export default async function Sumate({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const ref = typeof sp.ref === "string" ? sp.ref : undefined;
  return <SumateLanding oficio={null} refParam={ref} utm={pickUtm(sp)} />;
}
