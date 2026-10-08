"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="contenido" className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-extrabold">No pudimos cargar esta pantalla</h1>
      <p className="mt-2 text-muted">Probá de nuevo en unos segundos. Si el problema sigue, avisanos.</p>
      <Button className="mt-6" onClick={() => reset()}>Reintentar</Button>
    </main>
  );
}
