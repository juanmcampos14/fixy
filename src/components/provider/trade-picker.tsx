"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Search, Star, X } from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { POPULAR_TRADES, TRADE_PERSON, tradeMatches, tradeSlugsFromText } from "@/lib/trades";
import { cn } from "@/lib/cn";

export type TradeCategory = { id: string; slug: string; name: string; icon: string };
export type TradeValue = { ids: string[]; primaryId: string | null; other: string };

/**
 * Elegir oficios sin escribir: los más pedidos a la vista, un buscador que entiende cómo lo dice la gente
 * ("plomero", "gasista", "hago aires") y, solo si no está, "No está mi oficio" para escribirlo.
 * El primero que se elige es el principal (se puede cambiar). Con `name`, manda campos ocultos en un formulario común.
 */
export function TradePicker({
  categories, value, onChange, max = 8, size = "md", name,
}: {
  categories: TradeCategory[];
  value: TradeValue;
  onChange: (v: TradeValue) => void;
  max?: number;
  size?: "md" | "lg";
  /** Nombres de los campos ocultos: categoryIds (uno por rubro), primaryCategoryId y otherTrade. */
  name?: { ids: string; primary: string; other: string };
}) {
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [writing, setWriting] = useState(false);
  const [otherDraft, setOtherDraft] = useState(value.other);

  const bySlug = useMemo(() => new Map(categories.map((c) => [c.slug, c])), [categories]);
  const selectable = categories.filter((c) => c.slug !== "otro");
  const popular = POPULAR_TRADES.map((s) => bySlug.get(s)).filter((c): c is TradeCategory => !!c);
  const results = query.trim() ? selectable.filter((c) => tradeMatches(c, query)) : showAll ? selectable : popular;
  const primary = value.primaryId && value.ids.includes(value.primaryId) ? value.primaryId : (value.ids[0] ?? null);
  const full = value.ids.length >= max;

  const toggle = (id: string) => {
    if (value.ids.includes(id)) {
      const ids = value.ids.filter((x) => x !== id);
      onChange({ ...value, ids, primaryId: primary === id ? (ids[0] ?? null) : primary });
    } else if (!full) {
      onChange({ ...value, ids: [...value.ids, id], primaryId: primary ?? id });
    }
  };
  const saveOther = () => {
    const text = otherDraft.trim().slice(0, 80);
    // Si lo que escribió es un oficio conocido, se elige ese rubro en vez de guardarlo como "otro".
    const known = tradeSlugsFromText(text).map((s) => bySlug.get(s)?.id).filter((x): x is string => !!x && !value.ids.includes(x));
    if (known.length) {
      const ids = [...value.ids, ...known].slice(0, max);
      onChange({ ...value, ids, primaryId: primary ?? ids[0], other: "" });
      setOtherDraft("");
    } else {
      onChange({ ...value, other: text });
    }
    setWriting(false);
    setQuery("");
  };

  const big = size === "lg";
  // Grande, como se dice el oficio ("Electricista"); abajo y más chico, el rubro, si es distinto.
  const person = (c: TradeCategory) => TRADE_PERSON[c.slug] ?? c.name;
  // El rubro abajo solo si suma información y es corto: así todas las tarjetas tienen la misma altura.
  const sub = (c: TradeCategory) => {
    const p = TRADE_PERSON[c.slug];
    if (!p || c.name.length > 18 || p.length > 16) return null;
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return norm(p).includes(norm(c.name)) || norm(c.name).includes(norm(p)) ? null : c.name;
  };

  return (
    <div className="space-y-4">
      {name && value.ids.map((id) => <input key={id} type="hidden" name={name.ids} value={id} />)}
      {name && <input type="hidden" name={name.primary} value={primary ?? ""} />}
      {name && <input type="hidden" name={name.other} value={value.other} />}

      {(value.ids.length > 0 || value.other) && (
        <div>
          <p className="mb-2 text-sm font-semibold text-ink-2">Elegiste {value.ids.length > 1 ? `${value.ids.length} oficios` : ""}</p>
          <ul className="flex flex-wrap gap-2">
            {value.ids.map((id) => {
              const c = categories.find((x) => x.id === id);
              if (!c) return null;
              const isPrimary = id === primary;
              return (
                <li key={id} className={cn("inline-flex items-center gap-1.5 rounded-full py-1.5 pl-3 pr-1.5 text-[15px] font-semibold", isPrimary ? "bg-fixy-700 text-white" : "bg-fixy-50 text-fixy-800 ring-1 ring-fixy-500/40")}>
                  <CategoryIcon icon={c.icon} className="h-4 w-4" />{c.name}
                  {isPrimary ? (
                    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-xs"><Star className="h-3 w-3" aria-hidden />Principal</span>
                  ) : value.ids.length > 1 ? (
                    <button type="button" onClick={() => onChange({ ...value, primaryId: id })} className="ml-1 rounded-full px-2 py-0.5 text-xs underline">Hacer principal</button>
                  ) : null}
                  <button type="button" onClick={() => toggle(id)} aria-label={`Quitar ${c.name}`} className="grid h-7 w-7 place-items-center rounded-full hover:bg-black/10"><X className="h-4 w-4" aria-hidden /></button>
                </li>
              );
            })}
            {value.other && (
              <li className="inline-flex items-center gap-1.5 rounded-full bg-cream-2 py-1.5 pl-3 pr-1.5 text-[15px] ring-1 ring-line">
                Otro: <strong>{value.other}</strong>
                <button type="button" onClick={() => { onChange({ ...value, other: "" }); setOtherDraft(""); }} aria-label="Quitar oficio escrito" className="grid h-7 w-7 place-items-center rounded-full hover:bg-black/10"><X className="h-4 w-4" aria-hidden /></button>
              </li>
            )}
          </ul>
          {value.ids.length > 1 && <p className="mt-2 text-sm text-muted">En tu oficio <strong className="text-ink">principal</strong> te llegan más pedidos. Tocá «Hacer principal» para cambiarlo.</p>}
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscá: plomero, pintor…" aria-label="Buscar oficio"
          className={cn("w-full rounded-2xl border border-control bg-surface pl-11 pr-3", big ? "py-3.5 text-lg" : "py-2.5 text-[15px]")} />
      </div>

      {!query.trim() && !showAll && <p className="text-sm font-semibold text-ink-2">Los más pedidos</p>}
      <ul className={cn("grid gap-2.5", big ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3")}>
        {results.map((c) => {
          const on = value.ids.includes(c.id);
          return (
            <li key={c.id}>
              <button type="button" onClick={() => toggle(c.id)} aria-pressed={on} disabled={!on && full}
                className={cn("relative flex h-full w-full cursor-pointer items-center gap-2.5 rounded-2xl p-3 text-left leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  big ? "min-h-[72px] text-[16px]" : "min-h-14 text-[15px]",
                  on ? "bg-fixy-50 ring-2 ring-fixy-700" : "bg-surface ring-1 ring-line hover:ring-fixy-500")}>
                <CategoryIcon icon={c.icon} className={cn("shrink-0", big ? "h-6 w-6" : "h-5 w-5")} />
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 block font-semibold hyphens-auto [overflow-wrap:anywhere]">{person(c)}</span>
                  {sub(c) && <span className={cn("block truncate text-muted", big ? "text-sm" : "text-xs")}>{sub(c)}</span>}
                </span>
                {on && <Check className="h-5 w-5 shrink-0 text-fixy-800" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ul>
      {query.trim() && results.length === 0 && <p className="text-[15px] text-ink-2">No encontramos «{query.trim()}» en la lista.</p>}
      {full && <p className="text-sm text-muted">Elegiste el máximo de {max} oficios. Quitá uno para sumar otro.</p>}

      <div className="flex flex-wrap gap-3">
        {!query.trim() && (
          <button type="button" onClick={() => setShowAll((v) => !v)} className="rounded-full px-1 text-[15px] font-semibold text-fixy-800 underline">
            {showAll ? "Ver solo los más pedidos" : `Ver todos los oficios (${selectable.length})`}
          </button>
        )}
        {!writing && !value.other && (
          <button type="button" onClick={() => { setWriting(true); setOtherDraft(query.trim()); }} className="inline-flex items-center gap-1 rounded-full px-1 text-[15px] font-semibold text-fixy-800 underline">
            <Plus className="h-4 w-4" aria-hidden />No está mi oficio
          </button>
        )}
      </div>

      {writing && (
        <div className="rounded-2xl bg-cream-2 p-4">
          <label htmlFor="other-trade" className="block text-[15px] font-semibold">¿Cuál es tu oficio?</label>
          <p className="mt-0.5 text-sm text-muted">Escribilo como lo decís vos. Si lo reconocemos, lo elegimos de la lista; si no, lo agregamos y te avisamos.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input id="other-trade" value={otherDraft} onChange={(e) => setOtherDraft(e.target.value)} maxLength={80} autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (otherDraft.trim()) saveOther(); } }}
              className="min-w-0 flex-1 rounded-xl border border-control bg-surface px-3 py-2.5 text-[15px]" placeholder="Ej.: afilador, tornero, vitralista" />
            <button type="button" disabled={!otherDraft.trim()} onClick={saveOther} className="rounded-full bg-fixy-700 px-4 py-2.5 text-[15px] font-semibold text-white disabled:opacity-50">Agregar</button>
            <button type="button" onClick={() => setWriting(false)} className="rounded-full px-3 py-2.5 text-[15px] font-semibold text-ink-2">Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
