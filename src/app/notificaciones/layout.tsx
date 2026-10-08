import { requireActor } from "@/server/auth/session";
import { PanelShell } from "@/components/layout/panel-shell";

export default async function NotifLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor("/notificaciones");
  return <PanelShell actor={actor} area="client" nav={[{ href: "/notificaciones", label: "Notificaciones", icon: "bell" }, { href: "/app", label: "Volver al panel", icon: "dashboard", exact: true }]}>{children}</PanelShell>;
}
