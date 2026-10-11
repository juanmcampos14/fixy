import { PublicHeader } from "@/components/layout/public-header";
import { PublicFooter } from "@/components/layout/public-footer";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";

/** Landing: lienzo oscuro, una sola acción en cobalto, Fixy como único color (docs/design/landing.md). */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mercury min-h-dvh">
      <PublicHeader />
      <main id="contenido">{children}</main>
      <PublicFooter />
      <WhatsAppButton />
    </div>
  );
}
