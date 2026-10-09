import { PublicHeader } from "@/components/layout/public-header";
import { PublicFooter } from "@/components/layout/public-footer";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PublicHeader />
      <main id="contenido">{children}</main>
      <PublicFooter />
      <WhatsAppButton />
    </>
  );
}
