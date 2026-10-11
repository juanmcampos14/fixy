import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { LEGAL } from "@/lib/legal";
import { paymentsAreTestMode } from "@/server/env";
import { Logo } from "@/components/brand/logo";

const COLUMNS = [
  { title: "Clientes", links: [["Pedir un servicio", "/solicitar"], ["Cómo funciona", "/#como-funciona"], ["Empresas", "/#empresas"], ["Trabajos grandes y obras", "/#trabajos-grandes"]] },
  { title: "Profesionales", links: [["Ofrecé tus servicios", "/sumate"], ["Panel de profesionales", "/proveedor"]] },
  { title: "Legales", links: [["Términos y condiciones", "/terminos"], ["Condiciones para profesionales", "/terminos/profesionales"], ["Privacidad", "/privacidad"], ["Botón de arrepentimiento", "/arrepentimiento"]] },
];

export function PublicFooter() {
  return (
    <footer className="mt-28 border-t border-slate-line/30">
      <div className="mx-auto grid max-w-[1200px] gap-10 px-5 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo variant="white" size="sm" />
          <p className="mt-4 max-w-xs text-sm leading-relaxed text-ash">Tu centro de soluciones para el hogar, la oficina y la obra. Ciudad de Buenos Aires y GBA.</p>
        </div>
        {COLUMNS.map((col) => (
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
  );
}
