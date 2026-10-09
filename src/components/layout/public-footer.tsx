import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { LEGAL } from "@/lib/legal";
import { paymentsAreTestMode } from "@/server/env";
import { Logo } from "@/components/brand/logo";

export function PublicFooter() {
  return (
    <footer className="mt-20 bg-ink text-white/85">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo variant="white" size="sm" />
          <p className="mt-3 max-w-xs text-sm text-white/70">Servicios para tu hogar y oficina. Cobertura inicial: Ciudad de Buenos Aires y GBA.</p>
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Clientes</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link className="hover:underline" href="/solicitar">Pedir presupuesto</Link></li>
            <li><Link className="hover:underline" href="/#como-funciona">Cómo funciona</Link></li>
            <li><Link className="hover:underline" href="/#empresas">Oficinas y empresas</Link></li>
            <li><Link className="hover:underline" href="/#trabajos-grandes">Trabajos grandes y obras</Link></li>
            <li><a className="hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Profesionales</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link className="hover:underline" href="/sumate">Ofrecé tus servicios</Link></li>
            <li><Link className="hover:underline" href="/proveedor">Panel de proveedores</Link></li>
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Legales</h2>
          <ul className="mt-3 space-y-2 text-sm">
            <li><Link className="hover:underline" href="/terminos">Términos y condiciones</Link></li>
            <li><Link className="hover:underline" href="/terminos/profesionales">Condiciones para profesionales</Link></li>
            <li><Link className="hover:underline" href="/privacidad">Privacidad</Link></li>
            <li><Link className="hover:underline font-semibold" href="/arrepentimiento">Botón de arrepentimiento</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-white/60 sm:px-6">
          © {new Date().getFullYear()} {LEGAL.company} · CUIT {LEGAL.cuit} · {LEGAL.brand} · {LEGAL.site}{paymentsAreTestMode() ? " · Pagos en modo de prueba: no se mueve dinero real." : ""}
        </p>
      </div>
    </footer>
  );
}
