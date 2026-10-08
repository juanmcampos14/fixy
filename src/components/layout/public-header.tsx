import Link from "next/link";
import { getActor } from "@/server/auth/session";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { isStaff } from "@/server/auth/actor";

export async function PublicHeader() {
  const actor = await getActor();
  const home = actor ? (isStaff(actor) ? "/admin" : actor.providers.length && !actor.organizations.length ? "/proveedor" : "/app") : null;
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-cream/90 backdrop-blur supports-[backdrop-filter]:bg-cream/75">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="Fixy, inicio" className="rounded-lg">
          <Logo size="sm" />
        </Link>
        <nav aria-label="Principal" className="hidden items-center gap-1 text-[15px] font-medium lg:flex">
          <Link href="/#como-funciona" className="rounded-full px-3 py-2 hover:bg-ink/5">Cómo funciona</Link>
          <Link href="/#empresas" className="rounded-full px-3 py-2 hover:bg-ink/5">Oficinas y empresas</Link>
          <Link href="/sumate" className="rounded-full px-3 py-2 hover:bg-ink/5">Ofrecé tus servicios</Link>
          <Link href="/#preguntas" className="rounded-full px-3 py-2 hover:bg-ink/5">Preguntas</Link>
        </nav>
        <div className="flex items-center gap-2">
          {actor ? (
            <ButtonLink href={home!} size="sm">Ir a mi panel</ButtonLink>
          ) : (
            <>
              <ButtonLink href="/ingresar" variant="ghost" size="sm">Ingresar</ButtonLink>
              <ButtonLink href="/solicitar" size="sm" className="hidden sm:inline-flex">Pedir presupuesto</ButtonLink>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
