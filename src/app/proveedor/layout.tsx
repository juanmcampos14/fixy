import type { Metadata } from "next";
import { getActor } from "@/server/auth/session";
import { asUser } from "@/server/db/client";
import { activeMembership } from "@/server/queries/provider";
import { PanelShell } from "@/components/layout/panel-shell";
import type { NavItem } from "@/components/layout/panel-nav";
import { PublicHeader } from "@/components/layout/public-header";

export const metadata: Metadata = { title: { template: "%s · Proveedor · Fixy", default: "Panel de proveedor · Fixy" } };
export const dynamic = "force-dynamic";

/**
 * Sin sesión o sin proveedor (alta en curso) se muestra un marco simple: cada página decide
 * a dónde redirigir (las del panel mandan al alta; el alta manda a registrarse).
 * La navegación de técnicos es reducida, y además cada página lo valida en el servidor.
 */
export default async function ProviderLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();
  const m = actor ? activeMembership(actor) : null;
  if (!actor || !m) {
    return (
      <>
        <PublicHeader />
        <main id="contenido" className="mx-auto max-w-3xl px-4 pb-24 pt-6 sm:px-6 sm:pt-10">{children}</main>
      </>
    );
  }
  const admin = m.role === "admin";
  const nav: NavItem[] = admin
    ? [
        { href: "/proveedor", label: "Inicio", icon: "dashboard", exact: true },
        { href: "/proveedor/oportunidades", label: "Oportunidades", icon: "inbox" },
        { href: "/proveedor/trabajos", label: "Trabajos", icon: "briefcase" },
        { href: "/proveedor/agenda", label: "Agenda", icon: "clipboard" },
        { href: "/proveedor/perfil", label: "Perfil", icon: "store" },
        ...(m.status === "approved" || m.status === "suspended" ? [] : [{ href: "/proveedor/alta", label: "Alta", icon: "scroll" as const }]),
        ...(await isCompany(actor.id, m.id) ? [{ href: "/proveedor/equipo", label: "Equipo", icon: "users" as const }] : []),
        { href: "/proveedor/cobros", label: "Cobros", icon: "wallet" },
        { href: "/proveedor/recomendaciones", label: "Recomendaciones", icon: "users" },
        { href: "/proveedor/resenas", label: "Reseñas", icon: "star" },
      ]
    : [
        { href: "/proveedor", label: "Inicio", icon: "dashboard", exact: true },
        { href: "/proveedor/trabajos", label: "Trabajos", icon: "briefcase" },
      ];
  return (
    <PanelShell actor={actor} area="provider" nav={nav}>
      {children}
    </PanelShell>
  );
}

async function isCompany(userId: string, providerId: string) {
  const [p] = await asUser(userId, (tx) => tx<{ kind: string }[]>`select kind from providers where id = ${providerId}`);
  return p?.kind === "company";
}
