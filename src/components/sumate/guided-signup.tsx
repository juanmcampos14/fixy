"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, LocateFixed, MessageCircle } from "lucide-react";
import { TradePicker } from "@/components/provider/trade-picker";
import { Mascot } from "@/components/brand/mascot";
import { canLocate, locateMe, LOCATE_ERROR } from "@/components/location/locate";
import { guidedSignupAction } from "@/app/(public)/sumate/empezar/actions";
import { cn } from "@/lib/cn";

type Category = { id: string; slug: string; name: string; icon: string };
type Zone = { id: string; code: string; name: string; region: string; province: string | null; catch_all: boolean; match_names: string[] };
type Data = { categoryIds: string[]; primaryId: string; otherTrade: string; province: string; zoneIds: string[]; fullName: string; phone: string; email: string; password: string; acceptTerms: boolean };

const EMPTY: Data = { categoryIds: [], primaryId: "", otherTrade: "", province: "", zoneIds: [], fullName: "", phone: "", email: "", password: "", acceptTerms: false };
const STORE = "fixy-alta-guiada";
const MAX_TRADES = 5;
const field = "block h-14 w-full rounded-2xl border border-control bg-cream px-4 text-lg text-ink placeholder:text-muted/70 focus:border-ivory focus:outline-none";

/**
 * Alta guiada de profesionales: una sola pregunta por pantalla, letra grande y botones grandes.
 * Pensada para celulares viejos y para quien no se lleva bien con los formularios.
 */
export function GuidedSignup({ categories, zones, signedInName, initialTrade = null }: { categories: Category[]; zones: Zone[]; signedInName: string | null; initialTrade?: string | null }) {
  const steps = signedInName ? (["oficio", "zona", "celular"] as const) : (["oficio", "zona", "nombre", "celular", "clave"] as const);
  const [i, setI] = useState(0);
  const [d, setD] = useState<Data>({ ...EMPTY, fullName: signedInName ?? "", ...(initialTrade ? { categoryIds: [initialTrade], primaryId: initialTrade } : {}) });
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  // La clave se ve mientras la escribe (se equivoca menos); la puede ocultar.
  const [showPass, setShowPass] = useState(true);
  const [pending, start] = useTransition();
  const step = steps[i];

  // Si se le cierra la página a mitad de camino, al volver sigue donde estaba (la clave nunca se guarda).
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "null") as Partial<Data> | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee del navegador al montar
      if (saved) setD((cur) => ({ ...cur, ...saved, password: "", fullName: signedInName ?? saved.fullName ?? "" }));
    } catch { /* sin almacenamiento */ }
  }, [signedInName]);
  useEffect(() => {
    try { sessionStorage.setItem(STORE, JSON.stringify({ ...d, password: "" })); } catch { /* sin almacenamiento */ }
  }, [d]);

  const provinces = useMemo(() => [...new Set(zones.map((z) => z.province).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, "es")), [zones]);
  const inProvince = useMemo(() => zones.filter((z) => z.province === d.province).sort((a, b) => Number(a.catch_all) - Number(b.catch_all)), [zones, d.province]);
  const set = (patch: Partial<Data>) => { setError(null); setD((cur) => ({ ...cur, ...patch })); };
  const toggle = (key: "categoryIds" | "zoneIds", id: string, max: number) => {
    const has = d[key].includes(id);
    if (!has && d[key].length >= max) return setError(`Podés elegir hasta ${max}.`);
    set({ [key]: has ? d[key].filter((x) => x !== id) : [...d[key], id] });
  };

  const problem = (): string | null => {
    if (step === "oficio" && !d.categoryIds.length && !d.otherTrade) return "Tocá al menos un oficio (o escribí el tuyo si no está).";
    if (step === "zona" && !d.zoneIds.length) return d.province ? "Tocá al menos una zona." : "Elegí tu provincia.";
    if (step === "nombre" && d.fullName.trim().split(/\s+/).length < 2) return "Escribí tu nombre y tu apellido.";
    if (step === "celular" && d.phone.replace(/\D/g, "").length < 8) return "Escribí tu número de celular con el código de área.";
    if (step === "clave") {
      if (!/^\S+@\S+\.\S+$/.test(d.email.trim())) return "Escribí tu email.";
      if (d.password.length < 8) return "La clave tiene que tener al menos 8 letras o números.";
      if (!d.acceptTerms) return "Tildá la casilla para aceptar las condiciones.";
    }
    return null;
  };

  const next = () => {
    const p = problem();
    if (p) return setError(p);
    if (i < steps.length - 1) { setError(null); setI(i + 1); window.scrollTo({ top: 0 }); return; }
    start(async () => {
      const r = await guidedSignupAction({ categoryIds: d.categoryIds, primaryCategoryId: d.primaryId, otherTrade: d.otherTrade, zoneIds: d.zoneIds, fullName: d.fullName, phone: d.phone, email: d.email, password: d.password, acceptTerms: d.acceptTerms });
      if (r?.error) setError(r.error);
      else { try { sessionStorage.removeItem(STORE); } catch { /* sin almacenamiento */ } }
    });
  };

  const useLocation = async () => {
    setLocating(true); setError(null);
    const r = await locateMe(zones.map((z) => ({ ...z })));
    setLocating(false);
    if (!r.ok) return setError(LOCATE_ERROR[r.error]);
    const z = zones.find((x) => x.id === r.located.zone?.id);
    if (!z?.province) return setError("No reconocimos esa zona. Elegí tu provincia de la lista.");
    set({ province: z.province, zoneIds: [z.id] });
  };

  const TITLES: Record<(typeof steps)[number], [string, string]> = {
    oficio: ["¿Qué trabajo hacés?", `Tocá tu oficio. Podés elegir hasta ${MAX_TRADES}.`],
    zona: ["¿Dónde trabajás?", "Elegí tu provincia y después las zonas a las que vas."],
    nombre: ["¿Cómo te llamás?", "Tu nombre y apellido, como figura en tu DNI."],
    celular: ["¿Cuál es tu celular?", "Te avisamos ahí cuando haya un trabajo. No se publica."],
    clave: ["Último paso: tu clave", "Con tu email y esta clave vas a entrar a Fixy."],
  };

  return (
    <div data-guided className="mx-auto flex min-h-[calc(100dvh-72px)] max-w-xl flex-col px-5 pb-10 pt-4">
      {/* Avance */}
      <div className="flex items-center gap-3">
        {i > 0 ? (
          <button type="button" onClick={() => { setError(null); setI(i - 1); }} className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full ring-1 ring-control" aria-label="Volver al paso anterior">
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
        ) : <Mascot pose="wave" animate={false} className="h-11 w-auto shrink-0" />}
        <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={i + 1} aria-label={`Paso ${i + 1} de ${steps.length}`}>
          {steps.map((s, k) => <span key={s} className={cn("h-2 flex-1 rounded-full", k <= i ? "bg-fixy-700" : "bg-cream-2")} />)}
        </div>
        <span className="shrink-0 text-sm text-muted">{i + 1} de {steps.length}</span>
      </div>

      <h1 className="mt-7 text-[2rem]" style={{ lineHeight: 1.1 }}>{TITLES[step][0]}</h1>
      <p className="mt-2 text-lg text-ink-2">{TITLES[step][1]}</p>

      <div className="mt-6 flex-1">
        {step === "oficio" && (
          <TradePicker categories={categories} size="lg" max={MAX_TRADES}
            value={{ ids: d.categoryIds, primaryId: d.primaryId || null, other: d.otherTrade }}
            onChange={(v) => set({ categoryIds: v.ids, primaryId: v.primaryId ?? "", otherTrade: v.other })} />
        )}

        {step === "zona" && (
          <div className="space-y-4">
            {canLocate() && (
              <button type="button" onClick={useLocation} disabled={locating} className="flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl text-lg ring-1 ring-control disabled:opacity-60">
                <LocateFixed className="h-5 w-5" aria-hidden />{locating ? "Buscando…" : "Usar mi ubicación"}
              </button>
            )}
            <div>
              <label htmlFor="gs-prov" className="mb-1.5 block text-[15px] text-ink-2">Provincia</label>
              <select id="gs-prov" value={d.province} onChange={(e) => set({ province: e.target.value, zoneIds: [] })} className={cn(field, "appearance-auto")}>
                <option value="">Elegí tu provincia…</option>
                {provinces.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            {d.province && (
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {inProvince.map((z) => {
                  const on = d.zoneIds.includes(z.id);
                  return (
                    <li key={z.id}>
                      <button type="button" onClick={() => toggle("zoneIds", z.id, 12)} aria-pressed={on}
                        className={cn("flex min-h-14 w-full cursor-pointer items-center justify-between gap-2 rounded-2xl px-4 py-3 text-left text-[17px] leading-tight transition-colors",
                          on ? "bg-fixy-50 ring-2 ring-fixy-700" : "bg-surface ring-1 ring-line")}>
                        <span>{z.name}</span>
                        {on && <Check className="h-5 w-5 shrink-0 text-fixy-800" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {step === "nombre" && (
          <div>
            <label htmlFor="gs-name" className="sr-only">Nombre y apellido</label>
            <input id="gs-name" autoFocus autoComplete="name" value={d.fullName} maxLength={120} onChange={(e) => set({ fullName: e.target.value })} onKeyDown={(e) => e.key === "Enter" && next()}
              placeholder="Juan Pérez" className={field} />
          </div>
        )}

        {step === "celular" && (
          <div>
            <label htmlFor="gs-phone" className="sr-only">Celular</label>
            <input id="gs-phone" autoFocus type="tel" inputMode="tel" autoComplete="tel" value={d.phone} maxLength={40} onChange={(e) => set({ phone: e.target.value })} onKeyDown={(e) => e.key === "Enter" && next()}
              placeholder="11 2345 6789" className={field} />
          </div>
        )}

        {step === "clave" && (
          <div className="space-y-4">
            <div>
              <label htmlFor="gs-email" className="mb-1.5 block text-[15px] text-ink-2">Tu email</label>
              <input id="gs-email" type="email" inputMode="email" autoComplete="email" value={d.email} maxLength={200} onChange={(e) => set({ email: e.target.value })} placeholder="juan@gmail.com" className={field} />
            </div>
            <div>
              <label htmlFor="gs-pass" className="mb-1.5 block text-[15px] text-ink-2">Inventá una clave (8 letras o números, como mínimo)</label>
              <div className="relative">
                <input id="gs-pass" type={showPass ? "text" : "password"} autoComplete="new-password" autoCapitalize="none" spellCheck={false} value={d.password} maxLength={200} onChange={(e) => set({ password: e.target.value })} className={cn(field, "pr-24")} />
                <button type="button" onClick={() => setShowPass((v) => !v)} className="absolute right-2 top-2 h-10 cursor-pointer rounded-xl px-3 text-[15px] text-fixy-800">{showPass ? "Ocultar" : "Mostrar"}</button>
              </div>
              <p className="mt-1.5 text-sm text-muted">Anotala en un papel para no olvidarla.</p>
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-surface p-4 text-[16px] ring-1 ring-line">
              <input type="checkbox" checked={d.acceptTerms} onChange={(e) => set({ acceptTerms: e.target.checked })} className="mt-0.5 h-6 w-6 shrink-0 accent-fixy-700" />
              <span>Acepto los <Link href="/terminos" target="_blank" className="underline">términos</Link>, la <Link href="/privacidad" target="_blank" className="underline">privacidad</Link> y las <Link href="/terminos/profesionales" target="_blank" className="underline">condiciones para profesionales</Link>.</span>
            </label>
            <p className="text-[15px] text-muted">¿No usás email? <a href="/alta" className="inline-flex items-center gap-1 text-fixy-800 underline"><MessageCircle className="h-4 w-4" aria-hidden />Anotate por WhatsApp</a>, sin email ni clave.</p>
          </div>
        )}
      </div>

      {/* El aviso y el botón quedan siempre a la vista, aunque la lista sea larga. El fondo se funde hacia arriba para
          que las tarjetas que pasan por detrás se desvanezcan en vez de quedar cortadas. */}
      <div className="sticky bottom-0 -mx-4 mt-5 space-y-2 bg-gradient-to-t from-cream from-70% to-transparent px-4 pb-4 pt-8">
        {error && <p role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-[16px] text-danger shadow-[var(--shadow-lift)]">{error}</p>}
        <button type="button" onClick={next} disabled={pending} className="m-btn m-btn-primary h-16 w-full text-xl shadow-[var(--shadow-lift)] disabled:opacity-60">
          {pending ? "Creando tu perfil…" : i === steps.length - 1 ? "Listo, sumarme" : <>Siguiente <ArrowRight className="h-5 w-5" aria-hidden /></>}
        </button>
      </div>
      {i === 0 && (
        <p className="mt-4 text-center text-[15px] text-muted">
          ¿Preferís el formulario completo? <Link href="/registro?tipo=proveedor" className="text-fixy-800 underline">Registrarme como antes</Link>
        </p>
      )}
    </div>
  );
}
