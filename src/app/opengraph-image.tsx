import { ogSize, sumateOgImage } from "@/components/sumate/og";

// Imagen por defecto al compartir cualquier página de Fixy (WhatsApp, redes). Las secciones pueden tener la suya.
export const size = ogSize;
export const contentType = "image/png"; // v2: lienzo oscuro, Fixy sin fondo
export const alt = "Fixy · Servicios para tu hogar y oficina";

export default function Image() {
  return sumateOgImage("Contanos qué pasa. Lo resolvemos.", "Profesionales verificados para tu hogar y oficina, con todo coordinado y pagado dentro de Fixy.", "fixy.solutions");
}
