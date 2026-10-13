import { requireActor } from "@/server/auth/session";
import { PanelShell } from "@/components/layout/panel-shell";
import type { NavItem } from "@/components/layout/panel-nav";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("/app");
  const nav: NavItem[] = [
    { href: "/app", label: "Inicio", icon: "dashboard", exact: true },
    { href: "/app/solicitudes", label: "Solicitudes", short: "Pedidos", icon: "inbox" },
    { href: "/app/trabajos", label: "Trabajos", icon: "briefcase" },
    { href: "/app/propiedades", label: "Propiedades", short: "Lugares", icon: "house" },
    { href: "/app/pagos", label: "Pagos", icon: "receipt" },
    { href: "/app/organizaciones", label: actor.organizations.length ? "Organizaciones" : "Mi empresa", icon: "building" },
    { href: "/app/cuenta", label: "Mi cuenta", icon: "user" },
  ];
  return (
    <PanelShell actor={actor} area="client" nav={nav}>
      {children}
    </PanelShell>
  );
}
