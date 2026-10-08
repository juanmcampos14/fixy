import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SumateLanding } from "@/components/sumate/landing";
import { findOficio } from "@/lib/oficios";

export async function generateMetadata({ params }: { params: Promise<{ oficio: string }> }): Promise<Metadata> {
  const o = findOficio((await params).oficio);
  if (!o) return {};
  const title = `¿Sos ${o.singular}? Sumate a Fixy`;
  const description = `Recibí pedidos de ${o.ejemplos} en tu zona de CABA y GBA. Cotizá con tu precio y cobrá dentro de Fixy. Alta sin costo.`;
  return { title, description, openGraph: { title, description, type: "website", locale: "es_AR" } };
}

export default async function SumateOficio({ params, searchParams }: { params: Promise<{ oficio: string }>; searchParams: Promise<{ ref?: string }> }) {
  const o = findOficio((await params).oficio);
  if (!o) notFound();
  const { ref } = await searchParams;
  return <SumateLanding oficio={o} refParam={ref} />;
}
