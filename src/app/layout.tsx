import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", weight: ["600", "700", "800"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "Fixy · Servicios para tu hogar y oficina", template: "%s · Fixy" },
  description: "Contanos qué pasa. Encontrá quién lo resuelva. Pedí presupuestos a profesionales y gestioná el trabajo en un solo lugar.",
  applicationName: "Fixy",
};

export const viewport: Viewport = { themeColor: "#FFF9F1", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${inter.variable} ${jakarta.variable}`}>
      <body className="min-h-dvh">
        <a href="#contenido" className="sr-only z-50 rounded-full bg-ink px-4 py-2 text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
