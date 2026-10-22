import { requireStaff } from "@/server/auth/session";
import { mfaAvailable } from "@/server/auth/mfa";
import { Alert } from "@/components/ui/alert";
import { isPlatformAdmin } from "@/server/auth/actor";
import { ADMIN_SECTIONS, levelFor, type AdminSection } from "@/server/auth/permissions";
import { navCounts } from "@/server/queries/admin";
import { PanelShell } from "@/components/layout/panel-shell";
import type { NavIcon, NavItem } from "@/components/layout/panel-nav";

export const metadata = { title: { default: "Operación", template: "%s · Operación Fixy" } };
export const dynamic = "force-dynamic";

const ICON: Record<AdminSection, NavIcon> = {
  resumen: "dashboard", socios: "chart", proveedores: "store", solicitudes: "inbox", trabajos: "briefcase", reclamos: "flag", resenas: "star",
  finanzas: "wallet", catalogo: "clipboard", comisiones: "coins", arrepentimientos: "flag", whatsapp: "message", auditoria: "scroll", salud: "activity",
};

/** Nombres para la barra de abajo en celular. */
const SHORT: Partial<Record<AdminSection, string>> = { resumen: "Resumen", socios: "Socios", proveedores: "Profes.", solicitudes: "Pedidos" };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaff();
  const counts = await navCounts(actor.id);
  const badge: Partial<Record<AdminSection, number>> = { proveedores: counts.providers, solicitudes: counts.requests, reclamos: counts.disputes, resenas: counts.reviewDisputes };
  const nav: NavItem[] = ADMIN_SECTIONS.filter((s) => levelFor(actor, s.key) !== "none").map((s) => ({
    href: s.href, label: s.label, short: SHORT[s.key], icon: ICON[s.key], badge: badge[s.key], exact: s.key === "resumen",
  }));
  if (isPlatformAdmin(actor)) nav.push({ href: "/admin/equipo", label: "Equipo y permisos", icon: "users" });
  return (
    <PanelShell actor={actor} area="admin" nav={nav}>
      {!mfaAvailable() && isPlatformAdmin(actor) && (
        <Alert tone="warn" className="mb-4" title="Falta activar el segundo factor del equipo">
          Cargá MFA_ENCRYPTION_KEY en Vercel (una clave aleatoria larga) y volvé a desplegar: desde ahí el panel pide código al entrar.
        </Alert>
      )}
      {children}
    </PanelShell>
  );
}
