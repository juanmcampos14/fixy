import { ogSize, sumateOgImage } from "@/components/sumate/og";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Sumate a Fixy";

export default function Image() {
  return sumateOgImage("Tu oficio, más oportunidades.", "Recibí pedidos en tu zona y cobrá dentro de Fixy. Alta sin costo.");
}
