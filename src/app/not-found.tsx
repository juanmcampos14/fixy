import { Mascot } from "@/components/brand/mascot";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="contenido" className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <Mascot pose="empathy" className="h-36 w-auto" />
      <h1 className="mt-4 text-2xl font-extrabold">No encontramos esta página</h1>
      <p className="mt-2 text-muted">Puede que el enlace sea viejo o que no tengas acceso a este contenido.</p>
      <ButtonLink href="/" className="mt-6">Volver al inicio</ButtonLink>
    </main>
  );
}
