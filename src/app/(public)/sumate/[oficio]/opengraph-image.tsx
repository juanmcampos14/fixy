import { ogSize, sumateOgImage } from "@/components/sumate/og";
import { OFICIOS, findOficio } from "@/lib/oficios";

export const size = ogSize;
export const contentType = "image/png"; // v2: lienzo oscuro, Fixy sin fondo
export const alt = "Sumate a Fixy";

export function generateStaticParams() {
  return OFICIOS.map((o) => ({ oficio: o.slug }));
}

export default async function Image({ params }: { params: Promise<{ oficio: string }> }) {
  const o = findOficio((await params).oficio);
  return sumateOgImage(o ? `¿Sos ${o.singular}? Sumate a Fixy.` : "Sumate a Fixy.", o ? `Pedidos de ${o.ejemplos} en tu zona.` : "Recibí pedidos en tu zona.");
}
