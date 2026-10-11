"use client";

import { BadgeCheck, CalendarCheck, LoaderCircle, MapPin, Star, Users } from "lucide-react";
import { Mascot } from "@/components/brand/mascot";
import { cn } from "@/lib/cn";
import { ProviderAvatar } from "@/components/domain/provider-avatar";
import { formatMoney } from "@/lib/format";

export type BookableProviderCard = {
  slug: string; displayName: string; kind: string; isDemo: boolean; description: string; yearsExperience: number | null;
  rating: number | null; reviews: number; completedJobs: number; identityVerified: boolean; verified: boolean; credentials: string[];
  visitFeeMinor: number; visitFeeCredited: boolean; priceRefs: { title: string; fromMinor: number; note: string }[];
  availabilityMatch: boolean; sameZone: boolean; avatarUrl: string | null;
};

export function ChooseProvider({ loading, providers, chosen, onChoose, categoryName }: {
  loading: boolean; providers: BookableProviderCard[]; chosen: string | null; onChoose: (slug: string) => void; categoryName: string;
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center py-10 text-center" aria-live="polite">
        <Mascot pose="think" className="h-24 w-auto" />
        <p className="mt-3 flex items-center gap-2 text-muted"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />Buscando profesionales de {categoryName.toLowerCase() || "tu rubro"} en tu zona…</p>
      </div>
    );
  }
  return (
    <fieldset>
      <legend className="text-[15px] text-ink-2">
        {providers.length
          ? <>Estos profesionales cubren tu zona y tu tipo de trabajo. <strong>Elegí uno:</strong> va a ver tu pedido, coordinan la visita en Fixy y te presupuesta el arreglo en el lugar.</>
          : null}
      </legend>
      {providers.length === 0 && (
        <div className="flex flex-col items-center rounded-2xl bg-cream/60 p-6 text-center ring-1 ring-line">
          <Mascot pose="empathy" className="h-24 w-auto" />
          <p className="mt-3 font-semibold">Enviá tu pedido y te conectamos con un profesional{categoryName ? ` de ${categoryName.toLowerCase()}` : ""}.</p>
          <p className="mt-1 text-sm text-muted">Te avisamos apenas lo tome.</p>
        </div>
      )}
      <div className="mt-4 space-y-3">
        {providers.map((p) => (
          <label key={p.slug} className="block cursor-pointer">
            <input type="radio" name="provider" value={p.slug} checked={chosen === p.slug} onChange={() => onChoose(p.slug)} className="peer sr-only" />
            <span className={cn("block rounded-2xl border bg-surface p-4 transition peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40", chosen === p.slug ? "border-fixy-700 bg-fixy-50/60 ring-1 ring-fixy-700" : "border-control hover:border-fixy-500")}>
              <span className="flex flex-wrap items-start justify-between gap-3">
                <span className="flex min-w-0 items-start gap-3">
                <ProviderAvatar url={p.avatarUrl} name={p.displayName} className="h-14 w-14 text-lg" />
                <span className="min-w-0">
                  <span className="block text-lg font-bold">{p.displayName}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {p.reviews ? (
                      <span className="inline-flex items-center gap-1 font-semibold"><Star className="h-4 w-4 fill-spark text-spark" aria-hidden />{p.rating} <span className="font-normal text-muted">({p.reviews})</span></span>
                    ) : <span className="text-muted">Nuevo en Fixy</span>}
                    {p.completedJobs > 0 && <span className="text-muted">{p.completedJobs} trabajo{p.completedJobs === 1 ? "" : "s"}</span>}
                    {p.kind === "company" && <span className="inline-flex items-center gap-1 text-muted"><Users className="h-3.5 w-3.5" aria-hidden />Empresa</span>}
                    {p.yearsExperience ? <span className="text-muted">{p.yearsExperience} años de experiencia</span> : null}
                    {p.isDemo && <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-muted">Demostración</span>}
                  </span>
                </span>
                </span>
                <span className="text-right">
                  <span className="block text-xs text-muted">Visita</span>
                  <span className="tabular block font-display text-xl font-extrabold">{p.visitFeeMinor > 0 ? formatMoney(p.visitFeeMinor) : "Sin cargo"}</span>
                  {p.visitFeeMinor > 0 && p.visitFeeCredited && <span className="block text-xs text-ok">Se descuenta si contratás</span>}
                </span>
              </span>
              <span className="mt-2 flex flex-wrap gap-1.5">
                {p.verified ? <span className="inline-flex items-center gap-1 rounded-full bg-ok-bg px-2 py-0.5 text-xs font-semibold text-ok"><BadgeCheck className="h-3.5 w-3.5" aria-hidden />Identidad verificada</span> : <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn">Todavía sin verificar</span>}
                {p.credentials.map((c) => <span key={c} className="inline-flex items-center gap-1 rounded-full bg-ok-bg px-2 py-0.5 text-xs font-semibold text-ok"><BadgeCheck className="h-3.5 w-3.5" aria-hidden />{c}</span>)}
                {p.availabilityMatch && <span className="inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-xs font-semibold text-info"><CalendarCheck className="h-3.5 w-3.5" aria-hidden />Disponible en tus horarios</span>}
                {p.sameZone && <span className="inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-xs font-semibold text-info"><MapPin className="h-3.5 w-3.5" aria-hidden />De tu zona</span>}
              </span>
              {p.priceRefs.length > 0 && (
                <span className="mt-3 block rounded-xl bg-cream/60 p-3 text-sm">
                  <span className="block text-xs font-semibold text-muted">Precios de referencia (se confirman en el lugar)</span>
                  {p.priceRefs.map((r) => (
                    <span key={r.title} className="mt-1 flex justify-between gap-3"><span>{r.title}</span><span className="tabular whitespace-nowrap font-semibold">desde {formatMoney(r.fromMinor)}</span></span>
                  ))}
                </span>
              )}
              {p.description && <span className="mt-2 line-clamp-2 block text-sm text-ink-2">{p.description}</span>}
              <a href={`/profesionales/${p.slug}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="mt-2 inline-block text-sm font-semibold text-fixy-800 underline">Ver perfil y reseñas</a>
            </span>
          </label>
        ))}
        <label className="block cursor-pointer">
          <input type="radio" name="provider" value="quotes" checked={chosen === "quotes"} onChange={() => onChoose("quotes")} className="peer sr-only" />
          <span className={cn("block rounded-2xl border border-dashed p-4 transition peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40", chosen === "quotes" ? "border-fixy-700 bg-fixy-50/60" : "border-control hover:border-fixy-500")}>
            <span className="block font-semibold">Prefiero recibir presupuestos de varios profesionales</span>
            <span className="block text-sm text-muted">Recomendado para obras grandes o trabajos bien definidos. Invitamos a un grupo acotado y comparás propuestas.</span>
          </span>
        </label>
      </div>
    </fieldset>
  );
}
