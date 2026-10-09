import { requireStaff } from "@/server/auth/session";
import { navCounts } from "@/server/queries/admin";
import { PanelShell } from "@/components/layout/panel-shell";
import type { NavItem } from "@/components/layout/panel-nav";

export const metadata = { title: { default: "Operación", template: "%s · Operación Fixy" } };
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireStaff();
  const counts = await navCounts(actor.id);
  const nav: NavItem[] = [
    { href: "/admin", label: "Resumen", icon: "dashboard", exact: true },
    { href: "/admin/proveedores", label: "Proveedores", icon: "store", badge: counts.providers },
    { href: "/admin/solicitudes", label: "Solicitudes", icon: "inbox", badge: counts.requests },
    { href: "/admin/trabajos", label: "Trabajos", icon: "briefcase" },
    { href: "/admin/reclamos", label: "Reclamos", icon: "flag", badge: counts.disputes },
    { href: "/admin/resenas", label: "Reseñas", icon: "star", badge: counts.reviewDisputes },
    { href: "/admin/finanzas", label: "Finanzas", icon: "wallet" },
    { href: "/admin/catalogo", label: "Catálogo", icon: "clipboard" },
    { href: "/admin/comisiones", label: "Comisiones", icon: "coins" },
    { href: "/admin/arrepentimientos", label: "Arrepentimientos", icon: "flag" },
    { href: "/admin/whatsapp", label: "WhatsApp", icon: "inbox" },
    { href: "/admin/auditoria", label: "Auditoría", icon: "scroll" },
  ];
  return (
    <PanelShell actor={actor} area="admin" nav={nav}>
      {children}
    </PanelShell>
  );
}
