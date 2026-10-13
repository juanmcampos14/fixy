"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Inbox, House, Building2, Receipt, Bell, Briefcase, Wallet, Star, Users, Store, ClipboardList, Flag, Settings,
  ScrollText, HandCoins, FileText, UserRound, Search, Wrench, ChartColumnIncreasing, MessageCircle, Ellipsis,
} from "lucide-react";
import { cn } from "@/lib/cn";

const ICONS = {
  dashboard: LayoutDashboard, inbox: Inbox, house: House, building: Building2, receipt: Receipt, bell: Bell, briefcase: Briefcase,
  wallet: Wallet, star: Star, users: Users, store: Store, clipboard: ClipboardList, flag: Flag, settings: Settings, scroll: ScrollText,
  coins: HandCoins, file: FileText, user: UserRound, search: Search, wrench: Wrench, chart: ChartColumnIncreasing, message: MessageCircle,
} as const;
export type NavIcon = keyof typeof ICONS;
export type NavItem = { href: string; label: string; icon: NavIcon; badge?: number; exact?: boolean };

/** En celular entran cinco destinos: los cuatro principales y "Más" con el resto. */
const BAR_SLOTS = 5;

export function PanelNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const active = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));
  const main = items.length > BAR_SLOTS ? items.slice(0, BAR_SLOTS - 1) : items;
  const rest = items.length > BAR_SLOTS ? items.slice(BAR_SLOTS - 1) : [];
  const [open, setOpen] = useState(false);
  // Al cambiar de pantalla, o con Escape, el panel "Más" se cierra.
  const [seen, setSeen] = useState(path);
  if (seen !== path) { setSeen(path); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  const restActive = rest.some(active);
  const restBadge = rest.reduce((n, i) => n + (i.badge ?? 0), 0);
  const tab = (on: boolean) => cn("relative flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-1 px-1 text-[11px] leading-none transition-colors", on ? "text-ivory" : "text-muted");
  const dot = (n: number) => <span className="absolute left-1/2 top-1.5 ml-1.5 min-w-4 rounded-full bg-spark px-1 text-center text-[10px] leading-4 text-onyx">{n > 99 ? "99+" : n}</span>;

  return (
    <>
      {/* Celular: barra fija abajo, al alcance del pulgar */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Cerrar" className="absolute inset-0 cursor-default bg-black/60" onClick={() => setOpen(false)} />
          <div id="panel-mas" role="dialog" aria-label="Más secciones" className="absolute inset-x-0 bottom-0 max-h-[75dvh] overflow-y-auto rounded-t-3xl bg-obsidian px-3 pt-3 motion-safe:animate-fade-up"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 76px)" }}>
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-control" aria-hidden />
            <ul>
              {rest.map((i) => {
                const I = ICONS[i.icon];
                return (
                  <li key={i.href}>
                    <Link href={i.href} aria-current={active(i) ? "page" : undefined}
                      className={cn("flex min-h-12 items-center gap-3 rounded-xl px-3 text-[16px]", active(i) ? "bg-cream-2 text-ivory" : "text-ink-2")}>
                      <I className="h-5 w-5 shrink-0 text-muted" aria-hidden />
                      <span className="flex-1">{i.label}</span>
                      {!!i.badge && <span className="rounded-full bg-spark px-2 text-xs text-onyx">{i.badge}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      <nav aria-label="Secciones" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-cream/95 backdrop-blur lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <ul className="mx-auto flex h-16 max-w-lg items-stretch">
          {main.map((i) => {
            const I = ICONS[i.icon];
            const on = active(i) && !open;
            return (
              <li key={i.href} className="flex min-w-0 flex-1">
                <Link href={i.href} aria-current={active(i) ? "page" : undefined} className={tab(on)}>
                  <I className="h-[22px] w-[22px]" strokeWidth={on ? 2.2 : 1.8} aria-hidden />
                  <span className="max-w-full truncate">{i.label}</span>
                  {!!i.badge && dot(i.badge)}
                </Link>
              </li>
            );
          })}
          {rest.length > 0 && (
            <li className="flex min-w-0 flex-1">
              <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="panel-mas" className={tab(open || restActive)}>
                <Ellipsis className="h-[22px] w-[22px]" strokeWidth={open || restActive ? 2.2 : 1.8} aria-hidden />
                <span>Más</span>
                {!open && restBadge > 0 && dot(restBadge)}
              </button>
            </li>
          )}
        </ul>
      </nav>
      {/* Escritorio: barra lateral */}
      <nav aria-label="Secciones" className="hidden lg:block">
        <ul className="space-y-1">
          {items.map((i) => {
            const I = ICONS[i.icon];
            return (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={active(i) ? "page" : undefined}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition-colors",
                    active(i) ? "bg-cream-2 text-ink" : "text-ink-2 hover:bg-surface",
                  )}
                >
                  <I className={cn("h-5 w-5", active(i) ? "text-fixy-800" : "text-muted")} aria-hidden />
                  <span className="flex-1">{i.label}</span>
                  {!!i.badge && <span className="rounded-full bg-spark px-2 text-xs font-bold text-onyx">{i.badge}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
