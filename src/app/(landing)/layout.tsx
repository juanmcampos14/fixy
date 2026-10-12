import { PublicHeader } from "@/components/layout/public-header";
import { PublicFooter } from "@/components/layout/public-footer";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { inFixyApp } from "@/components/auth/google-button";

/** Landing: lienzo oscuro, una sola acción en cobalto (docs/design/landing.md). Dentro de la app, solo la pantalla de inicio. */
export default async function LandingLayout({ children }: { children: React.ReactNode }) {
  if (await inFixyApp()) return <div className="mercury min-h-dvh">{children}</div>;
  return (
    <div className="mercury min-h-dvh">
      <PublicHeader />
      <main id="contenido">{children}</main>
      <PublicFooter />
      <WhatsAppButton />
    </div>
  );
}
