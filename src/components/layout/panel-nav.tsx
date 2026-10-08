"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Inbox, House, Building2, Receipt, Bell, Briefcase, Wallet, Star, Users, Store, ClipboardList, Flag, Settings,
  ScrollText, HandCoins, FileText, UserRound, Search, Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";

const ICONS = {
  dashboard: LayoutDashboard, inbox: Inbox, house: House, building: Building2, receipt: Receipt, bell: Bell, briefcase: Briefcase,
  wallet: Wallet, star: Star, users: Users, store: Store, clipboard: ClipboardList, flag: Flag, settings: Settings, scroll: ScrollText,
  coins: HandCoins, file: FileText, user: UserRound, search: Search, wrench: Wrench,
} as const;
export type NavIcon = keyof typeof ICONS;
export type NavItem = { href: string; label: string; icon: NavIcon; badge?: number; exact?: boolean };

export function PanelNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const active = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(i.href + "/"));
  return (
    <>
      {/* Móvil: pestañas desplazables */}
      <nav aria-label="Secciones" className="-mx-4 overflow-x-auto px-4 pb-1 lg:hidden">
        <ul className="flex gap-1.5">
          {items.map((i) => {
            const I = ICONS[i.icon];
            return (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={active(i) ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-semibold ring-1 transition-colors",
                    active(i) ? "bg-ink text-white ring-ink" : "bg-white text-ink ring-line hover:ring-fixy-500",
                  )}
                >
                  <I className="h-4 w-4" aria-hidden />
                  {i.label}
                  {!!i.badge && <span className="rounded-full bg-spark px-1.5 text-xs font-bold text-ink">{i.badge}</span>}
                </Link>
              </li>
            );
          })}
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
                    active(i) ? "bg-white text-ink shadow-[var(--shadow-card)] ring-1 ring-line" : "text-ink-2 hover:bg-white/70",
                  )}
                >
                  <I className={cn("h-5 w-5", active(i) ? "text-fixy-700" : "text-muted")} aria-hidden />
                  <span className="flex-1">{i.label}</span>
                  {!!i.badge && <span className="rounded-full bg-spark px-2 text-xs font-bold text-ink">{i.badge}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
