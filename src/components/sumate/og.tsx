import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

// Símbolo de Fixy (mismo dibujo que components/brand/logo.tsx), en SVG para la imagen.
const SYMBOL = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 16 L82 34.5 L82 70.5 L50 89 L18 70.5 L18 34.5 Z" fill="#14B8A6" stroke="#14B8A6" stroke-width="12" stroke-linejoin="round"/><rect x="34" y="45" width="8" height="13" rx="4" fill="#15343B"/><rect x="58" y="45" width="8" height="13" rx="4" fill="#15343B"/><path d="M42 65 Q50 72 58 65" fill="none" stroke="#15343B" stroke-width="4.5" stroke-linecap="round"/><rect x="63" y="0" width="9" height="15" rx="3" fill="#FF9B54" transform="rotate(30 67 8)"/></svg>`,
).toString("base64")}`;

/** Imagen para compartir (WhatsApp, redes): mascota + logo + mensaje, en el lienzo oscuro del sitio. */
export async function sumateOgImage(title: string, subtitle: string, footer = "fixy.solutions/sumate") {
  const mascot = await readFile(join(process.cwd(), "public/brand/fixy-wave.png"));
  const src = `data:image/png;base64,${mascot.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#171721", backgroundImage: "radial-gradient(circle at 82% 50%, rgba(82,102,235,0.30), rgba(82,102,235,0) 46%)", color: "#EDEDF3", padding: "64px 72px", alignItems: "center", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 52, fontWeight: 500 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={SYMBOL} width={58} height={58} alt="" />
            <span style={{ letterSpacing: -2 }}>fixy</span>
          </div>
          <div style={{ fontSize: 66, fontWeight: 500, lineHeight: 1.08, marginTop: 40, maxWidth: 720 }}>{title}</div>
          <div style={{ fontSize: 30, marginTop: 24, color: "#C3C3CC", maxWidth: 700 }}>{subtitle}</div>
          <div style={{ display: "flex", marginTop: 40, fontSize: 26, color: "#B9C1FA" }}>{footer}</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={330} height={375} alt="" />
      </div>
    ),
    ogSize,
  );
}
