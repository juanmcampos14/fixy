import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
import type { Actor } from "@/server/auth/actor";
import { canAccessAdmin } from "@/server/auth/actor";
import { sql } from "@/server/db/client";
import { Logo } from "@/components/brand/logo";
import { PanelNav, type NavItem } from "./panel-nav";
import { logoutAction } from "@/app/(auth)/actions";
import { cn } from "@/lib/cn";

export type Area = "client" | "provider" | "admin";

export async function PanelShell({ actor, area, nav, children }: { actor: Actor; area: Area; nav: NavItem[]; children: React.ReactNode }) {
  const [{ unread }] = await sql()<{ unread: number }[]>`select count(*)::int as unread from notifications where user_id = ${actor.id} and read_at is null`;
  const areas: { key: Area; href: string; label: string }[] = [
    { key: "client", href: "/app", label: "Cliente" },
    ...(actor.providers.length ? [{ key: "provider" as const, href: "/proveedor", label: "Profesional" }] : []),
    ...(canAccessAdmin(actor) ? [{ key: "admin" as const, href: "/admin", label: "Operación" }] : []),
  ];
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-cream/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <Link href={areas.find((a) => a.key === area)?.href ?? "/"} aria-label="Fixy, inicio del panel" className="shrink-0">
            {/* Con el selector de panel, en celular va solo el símbolo: si no, los íconos de la derecha se salen de la pantalla. */}
            <Logo size="sm" className={areas.length > 1 ? "[&>span:first-of-type]:hidden sm:[&>span:first-of-type]:inline" : undefined} />
          </Link>
          {areas.length > 1 && (
            <nav aria-label="Cambiar de panel" className="flex min-w-0 rounded-full bg-surface p-1 ring-1 ring-line sm:ml-1">
              {areas.map((a) => (
                <Link key={a.key} href={a.href} aria-current={a.key === area ? "page" : undefined}
                  className={cn("rounded-full px-3 py-1.5 text-[13px] font-semibold", a.key === area ? "bg-ivory text-onyx" : "text-ink-2 hover:bg-ink/10")}>
                  {a.label}
                </Link>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-1">
            {area === "client" && !actor.providers.length && !canAccessAdmin(actor) && (
              <Link href="/sumate" className="hidden rounded-full px-3 py-2 text-sm font-semibold text-fixy-800 hover:bg-ink/10 sm:inline">Ofrecé tus servicios</Link>
            )}
            {area === "provider" && (
              <Link href="/solicitar" className="hidden rounded-full px-3 py-2 text-sm font-semibold text-fixy-800 hover:bg-ink/10 sm:inline">Pedir un servicio</Link>
            )}
            <Link href="/notificaciones" className="relative grid h-10 w-10 place-items-center rounded-full hover:bg-ink/10" aria-label={`Notificaciones${unread ? `: ${unread} sin leer` : ""}`}>
              <Bell className="h-5 w-5" aria-hidden />
              {unread > 0 && <span className="absolute right-1 top-1 grid min-w-5 place-items-center rounded-full bg-spark px-1 text-[11px] font-bold text-onyx">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <Link href="/app/cuenta" className="hidden max-w-40 truncate rounded-full px-2 py-2 text-sm font-medium text-ink-2 hover:bg-ink/10 md:inline" title={`${actor.email} · Mi cuenta`}>{actor.fullName}</Link>
            <form action={logoutAction}>
              <button className="grid h-10 w-10 place-items-center rounded-full hover:bg-ink/10" aria-label="Cerrar sesión" title="Cerrar sesión">
                <LogOut className="h-5 w-5" aria-hidden />
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-7xl gap-8 px-4 pt-4 sm:px-6 lg:grid lg:grid-cols-[220px_1fr] lg:pt-8">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <PanelNav items={nav} />
        </aside>
        <main id="contenido" className="min-w-0 pb-24 pt-5 lg:pt-0">{children}</main>
      </div>
    </div>
  );
}
