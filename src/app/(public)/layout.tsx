import { PublicHeader } from "@/components/layout/public-header";
import { PublicFooter } from "@/components/layout/public-footer";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { inFixyApp } from "@/components/auth/google-button";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  // En la app no va el botón flotante: tapa contenido en pantallas chicas y ya hay un acceso a la ayuda en el pie.
  const inApp = await inFixyApp();
  return (
    <>
      <PublicHeader />
      <main id="contenido">{children}</main>
      <PublicFooter />
      {!inApp && <WhatsAppButton />}
    </>
  );
}
