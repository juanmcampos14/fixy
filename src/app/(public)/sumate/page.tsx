import type { Metadata } from "next";
import { SumateLanding } from "@/components/sumate/landing";

export const metadata: Metadata = {
  title: "Sumate como profesional",
  description: "Recibí pedidos de trabajos en tu zona de CABA y GBA, cotizá con tu precio y cobrá dentro de Fixy. Alta sin costo.",
  openGraph: { title: "Sumate a Fixy · Tu oficio, más oportunidades", description: "Recibí pedidos en tu zona y cobrá dentro de la plataforma. Alta sin costo.", type: "website", locale: "es_AR" },
};

export default async function Sumate({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return <SumateLanding oficio={null} refParam={ref} />;
}
