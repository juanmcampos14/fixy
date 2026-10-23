import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SumateLanding } from "@/components/sumate/landing";
import { pickUtm } from "@/lib/signup-origin";
import { findOficio } from "@/lib/oficios";

export async function generateMetadata({ params }: { params: Promise<{ oficio: string }> }): Promise<Metadata> {
  const o = findOficio((await params).oficio);
  if (!o) return {};
  const title = `¿Sos ${o.singular}? Sumate a Fixy`;
  const description = `Recibí pedidos de ${o.ejemplos} en tu zona, en toda la Argentina. Cotizá con tu precio y cobrá dentro de Fixy. Alta sin costo.`;
  return { title, description, openGraph: { title, description, type: "website", locale: "es_AR" } };
}

export default async function SumateOficio({ params, searchParams }: { params: Promise<{ oficio: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const o = findOficio((await params).oficio);
  if (!o) notFound();
  const sp = await searchParams;
  const ref = typeof sp.ref === "string" ? sp.ref : undefined;
  return <SumateLanding oficio={o} refParam={ref} utm={pickUtm(sp)} />;
}
