import { Logo } from "@/components/brand/logo";
import { APP_SCHEME } from "@/server/auth/app-handoff";
import { ReturnToApp } from "./return";

export const metadata = { title: "Volver a Fixy", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Se muestra en el navegador del sistema después de ingresar con Google: devuelve a la persona a la app. */
export default async function BackToApp({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const code = (await searchParams).code ?? "";
  const valid = /^[A-Za-z0-9_-]{20,100}$/.test(code);
  return (
    <main id="contenido" className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <Logo variant="white" />
      {valid ? (
        <>
          <h1 className="mt-8 text-2xl">Ya ingresaste</h1>
          <p className="mt-2 text-muted">Volvé a la app para continuar.</p>
          <ReturnToApp href={`${APP_SCHEME}://auth?code=${code}`} />
        </>
      ) : (
        <>
          <h1 className="mt-8 text-2xl">Este enlace venció</h1>
          <p className="mt-2 text-muted">Volvé a la app de Fixy y probá ingresar de nuevo.</p>
        </>
      )}
    </main>
  );
}
