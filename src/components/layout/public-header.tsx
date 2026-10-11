import Link from "next/link";
import { getActor } from "@/server/auth/session";
import { canAccessAdmin } from "@/server/auth/actor";
import { Logo } from "@/components/brand/logo";
import { ScrollHeader } from "@/components/landing/scroll-header";

const NAV = [
  { href: "/#como-funciona", label: "Cómo funciona" },
  { href: "/#trabajos-grandes", label: "Trabajos grandes" },
  { href: "/#empresas", label: "Empresas" },
  { href: "/sumate", label: "Profesionales" },
  { href: "/#preguntas", label: "Preguntas" },
];

/** Barra superior del sitio público: transparente arriba, esmerilada al scrollear; una sola acción en cobalto. */
export async function PublicHeader() {
  const actor = await getActor();
  const home = actor ? (canAccessAdmin(actor) ? "/admin" : actor.providers.length && !actor.organizations.length ? "/proveedor" : "/app") : null;
  return (
    <ScrollHeader>
      <div className="mx-auto flex h-[72px] max-w-[1200px] items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" aria-label="Fixy, inicio" className="rounded-full">
          <Logo size="sm" variant="white" />
        </Link>
        <nav aria-label="Principal" className="hidden items-center text-[15px] xl:flex">
          {NAV.map((n) => <Link key={n.href} href={n.href} className="m-nav-link">{n.label}</Link>)}
        </nav>
        <div className="flex items-center gap-2">
          {actor ? (
            <Link href={home!} className="m-btn m-btn-primary !min-h-11 !px-5">Ir a mi panel</Link>
          ) : (
            <>
              <Link href="/ingresar" className="m-nav-link">Ingresar</Link>
              <span className="hidden sm:block"><Link href="/solicitar" className="m-btn m-btn-primary !min-h-11 !px-5">Pedir un servicio</Link></span>
            </>
          )}
        </div>
      </div>
    </ScrollHeader>
  );
}
