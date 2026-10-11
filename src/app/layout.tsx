import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import "./globals.css";
import { NativeAppBridge } from "@/components/native/app-bridge";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
/** Tipografía ancha para títulos (eje de ancho variable), en peso intermedio. */
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "Fixy · Servicios para tu hogar y oficina", template: "%s · Fixy" },
  description: "Contanos qué pasa. Encontrá quién lo resuelva. Pedí presupuestos a profesionales y gestioná el trabajo en un solo lugar.",
  applicationName: "Fixy",
  openGraph: { type: "website", locale: "es_AR", siteName: "Fixy" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = { themeColor: "#171721", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className={`${inter.variable} ${archivo.variable}`}>
      <body className="min-h-dvh">
        <a href="#contenido" className="sr-only z-50 rounded-full bg-ivory px-4 py-2 text-onyx focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
          Saltar al contenido
        </a>
        {children}
        <NativeAppBridge />
      </body>
    </html>
  );
}
