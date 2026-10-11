import Link from "next/link";
import { Archivo } from "next/font/google";
import { getActor } from "@/server/auth/session";
import { canAccessAdmin } from "@/server/auth/actor";
import { paymentsAreTestMode } from "@/server/env";
import { Logo } from "@/components/brand/logo";
import { ScrollHeader } from "@/components/landing/scroll-header";
import { WhatsAppButton } from "@/components/layout/whatsapp-button";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { LEGAL } from "@/lib/legal";

/** Tipografía ancha para títulos (eje de ancho variable), en peso intermedio. */
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

const NAV = [
  { href: "/#como-funciona", label: "Cómo funciona" },
  { href: "/#trabajos-grandes", label: "Trabajos grandes" },
  { href: "/#empresas", label: "Empresas" },
  { href: "/sumate", label: "Profesionales" },
  { href: "/#preguntas", label: "Preguntas" },
];

/** Landing: lienzo oscuro, una sola acción en cobalto, Fixy como único color (docs/design/landing.md). */
export default async function LandingLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  const home = actor ? (canAccessAdmin(actor) ? "/admin" : actor.providers.length && !actor.organizations.length ? "/proveedor" : "/app") : null;
  return (
    <div className={`mercury ${archivo.variable} min-h-dvh`}>
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

      <main id="contenido">{children}</main>

      <footer className="mt-28 border-t border-slate-line/30">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Logo variant="white" size="sm" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ash">Tu centro de soluciones para el hogar, la oficina y la obra. Ciudad de Buenos Aires y GBA.</p>
          </div>
          {[
            { title: "Clientes", links: [["Pedir un servicio", "/solicitar"], ["Cómo funciona", "/#como-funciona"], ["Empresas", "/#empresas"], ["Trabajos grandes y obras", "/#trabajos-grandes"]] },
            { title: "Profesionales", links: [["Ofrecé tus servicios", "/sumate"], ["Panel de profesionales", "/proveedor"]] },
            { title: "Legales", links: [["Términos y condiciones", "/terminos"], ["Condiciones para profesionales", "/terminos/profesionales"], ["Privacidad", "/privacidad"], ["Botón de arrepentimiento", "/arrepentimiento"]] },
          ].map((col) => (
            <div key={col.title}>
              <p className="m-strong text-sm text-ivory">{col.title}</p>
              <ul className="mt-4 space-y-3 text-sm text-ash">
                {col.links.map(([label, href]) => <li key={href}><Link className="hover:text-ivory" href={href}>{label}</Link></li>)}
                {col.title === "Clientes" && <li><a className="hover:text-ivory" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></li>}
              </ul>
            </div>
          ))}
        </div>
        <p className="mx-auto max-w-[1200px] px-5 pb-10 text-xs leading-relaxed tracking-[0.01em] text-ash/80 sm:px-8">
          © {new Date().getFullYear()} {LEGAL.company} · CUIT {LEGAL.cuit} · {LEGAL.address} · {LEGAL.site}
          {paymentsAreTestMode() ? " · Pagos en modo de prueba: no se mueve dinero real." : ""} Fixy conecta a clientes con profesionales independientes; no reemplaza a los servicios de emergencia.
        </p>
      </footer>
      <WhatsAppButton tone="dark" />
    </div>
  );
}
