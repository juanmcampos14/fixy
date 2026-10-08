import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const ogSize = { width: 1200, height: 630 };

/** Imagen para compartir (WhatsApp, redes). */
export async function sumateOgImage(title: string, subtitle: string) {
  const mascot = await readFile(join(process.cwd(), "public/brand/fixy-wave.png"));
  const src = `data:image/png;base64,${mascot.toString("base64")}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#15343B", color: "white", padding: "64px 72px", alignItems: "center", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 40, fontWeight: 800 }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, background: "#14B8A6" }} />
            fixy
          </div>
          <div style={{ fontSize: 66, fontWeight: 800, lineHeight: 1.05, marginTop: 40, maxWidth: 720 }}>{title}</div>
          <div style={{ fontSize: 30, marginTop: 24, color: "#CDF6EE", maxWidth: 700 }}>{subtitle}</div>
          <div style={{ display: "flex", marginTop: 40, fontSize: 26, color: "#FF9B54" }}>fixy.solutions/sumate</div>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} width={330} height={375} alt="" />
      </div>
    ),
    ogSize,
  );
}
