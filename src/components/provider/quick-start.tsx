"use client";

import { useMemo, useState, useTransition } from "react";
import { ArrowLeft, Building2, LoaderCircle, Plus, Sparkles, Trash2, User } from "lucide-react";
import { CategoryIcon } from "@/components/category-icon";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { StrengthMeter } from "./strength-meter";
import { profileStrength } from "@/lib/profile-strength";
import { cn } from "@/lib/cn";
import { draftProfileWithAi, quickStartAction, type QuickDraft } from "@/app/proveedor/alta/actions";

type Cat = { id: string; name: string; icon: string };
type Zone = { id: string; name: string; region: string };
const REGION: Record<string, string> = { CABA: "Ciudad de Buenos Aires", GBA_NORTE: "GBA Norte", GBA_OESTE: "GBA Oeste", GBA_SUR: "GBA Sur" };
const PRESETS: { key: QuickDraft["availability"]; label: string; slots: number }[] = [
  { key: "weekdays", label: "Lunes a viernes, 8 a 18 h", slots: 5 },
  { key: "weekdays_sat", label: "Lunes a sábado, 8 a 18 h", slots: 6 },
  { key: "every_day", label: "Todos los días, 8 a 20 h", slots: 7 },
  { key: "evenings", label: "Lunes a viernes, 17 a 21 h", slots: 5 },
  { key: "", label: "Lo configuro después", slots: 0 },
];
const EXAMPLE = "Ej.: Soy gasista matriculado hace 12 años. Instalo y reparo calefones, termotanques y cocinas, y hago pruebas de hermeticidad. Trabajo en Vicente López, San Isidro y Belgrano, de lunes a sábado. La visita la cobro $15.000 y si hacemos el trabajo te la descuento. Cambio de flexible desde $25.000.";

const chip = (on: boolean) => cn(
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 py-2 text-[15px] font-semibold ring-1 transition",
  on ? "bg-fixy-700 text-white ring-fixy-700" : "bg-white text-ink ring-line hover:ring-fixy-500",
);

export function QuickStart({ categories, zones, aiAvailable, defaultName }: { categories: Cat[]; zones: Zone[]; aiAvailable: boolean; defaultName: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [kind, setKind] = useState<"individual" | "company">("individual");
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [d, setD] = useState<QuickDraft>({ displayName: "", description: "", yearsExperience: "", categoryIds: [], zoneIds: [], baseZoneId: "", availability: "weekdays", priceRefs: [], tips: [] });
  const [aiUsed, setAiUsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [drafting, startDraft] = useTransition();
  const [saving, startSave] = useTransition();

  const strength = useMemo(() => profileStrength({
    descriptionLength: d.description.trim().length, hasPhone: phone.trim().length >= 6, hasYears: d.yearsExperience !== "",
    categories: d.categoryIds.length, zones: d.zoneIds.length, hasBaseZone: !!d.baseZoneId,
    availabilitySlots: PRESETS.find((p) => p.key === d.availability)?.slots ?? 0, photos: 0, identity: "none",
    credentialsComplete: false, priceRefs: d.priceRefs.filter((p) => p.categoryId && p.title && Number(p.fromPesos) > 0).length, visitConfigured: false, payoutsEnabled: false,
  }), [d, phone]);

  const toggle = (k: "categoryIds" | "zoneIds", id: string) =>
    setD((p) => {
      const list = p[k].includes(id) ? p[k].filter((x) => x !== id) : [...p[k], id];
      return { ...p, [k]: list, ...(k === "zoneIds" && !list.includes(p.baseZoneId) ? { baseZoneId: "" } : {}) };
    });
  const toggleRegion = (region: string) =>
    setD((p) => {
      const ids = zones.filter((z) => z.region === region).map((z) => z.id);
      const all = ids.every((id) => p.zoneIds.includes(id));
      return { ...p, zoneIds: all ? p.zoneIds.filter((id) => !ids.includes(id)) : [...new Set([...p.zoneIds, ...ids])] };
    });

  function withAi() {
    setError(null);
    startDraft(async () => {
      const res = await draftProfileWithAi({ kind, name, text });
      if (res.error || !res.draft) return setError(res.error ?? "No pudimos armar el borrador.");
      setD({ ...res.draft, displayName: res.draft.displayName || name, availability: res.draft.availability || "weekdays" });
      setAiUsed(true);
      setStep(2);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  function manual() {
    setError(null);
    setD((p) => ({ ...p, displayName: p.displayName || name, description: p.description || text }));
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function save() {
    setError(null);
    setFieldErrors({});
    startSave(async () => {
      const r = await quickStartAction({ kind, displayName: d.displayName, contactPhone: phone, description: d.description, yearsExperience: d.yearsExperience,
        categoryIds: d.categoryIds, zoneIds: d.zoneIds, baseZoneId: d.baseZoneId, availability: d.availability, priceRefs: d.priceRefs, aiAssisted: aiUsed });
      if (r?.error) { setError(r.error); setFieldErrors(r.fieldErrors ?? {}); }
    });
  }

  if (step === 1) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Tipo de perfil">
          {([["individual", "Trabajo por mi cuenta", User], ["company", "Tengo una empresa o equipo", Building2]] as const).map(([k, label, I]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={cn("flex min-h-16 items-center gap-2 rounded-2xl p-3 text-left font-semibold ring-1", kind === k ? "bg-fixy-50 ring-2 ring-fixy-600" : "bg-white ring-line")}>
              <I className="h-5 w-5 shrink-0 text-fixy-700" aria-hidden />{label}
            </button>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={kind === "company" ? "Nombre de la empresa" : "Tu nombre o el de tu negocio"} htmlFor="qs-name" required>
            <Input id="qs-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="organization" />
          </Field>
          <Field label="Celular" htmlFor="qs-phone" required hint="Para avisarte de pedidos. No se publica.">
            <Input id="qs-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="tel" />
          </Field>
        </div>
        <Field label="Contanos qué hacés, como se lo dirías a un cliente" htmlFor="qs-text" hint="Rubros, zonas, días, años de experiencia, si cobrás la visita y algún precio de referencia. Con eso armamos tu perfil.">
          <Textarea id="qs-text" rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={3000} placeholder={EXAMPLE} />
        </Field>
        {error && <Alert tone="warn">{error}</Alert>}
        <div className="flex flex-wrap gap-3">
          {aiAvailable && (
            <Button type="button" size="lg" onClick={withAi} disabled={drafting || text.trim().length < 20 || name.trim().length < 2}>
              {drafting ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <Sparkles className="h-5 w-5" aria-hidden />}
              {drafting ? "Armando tu perfil…" : "Armar mi perfil con IA"}
            </Button>
          )}
          <Button type="button" size="lg" variant={aiAvailable ? "secondary" : "primary"} onClick={manual} disabled={drafting || name.trim().length < 2}>
            {aiAvailable ? "Prefiero completarlo yo" : "Seguir"}
          </Button>
        </div>
        {aiAvailable && <p className="text-xs text-muted">La IA arma un borrador con lo que escribiste. Antes de guardar revisás y corregís todo. No inventa precios.</p>}
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-6">
        <div className="rounded-2xl bg-white p-4 ring-1 ring-line lg:hidden"><StrengthMeter {...strength} compact /></div>
        <button type="button" onClick={() => setStep(1)} className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800"><ArrowLeft className="h-4 w-4" aria-hidden />Volver</button>
        {aiUsed && <Alert tone="ok" title="Armamos un borrador con lo que contaste">Revisalo: podés cambiar cualquier cosa antes de guardar.{d.tips.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{d.tips.map((t) => <li key={t}>{t}</li>)}</ul>}</Alert>}

        <section className="space-y-4">
          <h2 className="text-lg font-bold">Tu perfil público</h2>
          <Field label="Nombre que ven los clientes" htmlFor="qs-dn" required error={fieldErrors.displayName}>
            <Input id="qs-dn" value={d.displayName} onChange={(e) => setD({ ...d, displayName: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Descripción" htmlFor="qs-desc" required error={fieldErrors.description} hint={`${d.description.trim().length} caracteres · con 120 o más suma a tu perfil.`}>
            <Textarea id="qs-desc" rows={5} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} maxLength={2000} />
          </Field>
          <Field label="Años de experiencia" htmlFor="qs-years" className="max-w-64">
            <Input id="qs-years" type="number" inputMode="numeric" min={0} max={80} value={d.yearsExperience} onChange={(e) => setD({ ...d, yearsExperience: e.target.value })} />
          </Field>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold">¿Qué hacés?</h2>
          {fieldErrors.categoryIds && <p className="text-sm text-danger">{fieldErrors.categoryIds[0]}</p>}
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <button key={c.id} type="button" aria-pressed={d.categoryIds.includes(c.id)} onClick={() => toggle("categoryIds", c.id)} className={chip(d.categoryIds.includes(c.id))}>
                <CategoryIcon icon={c.icon} className="h-4 w-4" />{c.name}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold">¿Dónde trabajás?</h2>
          {fieldErrors.zoneIds && <p className="text-sm text-danger">{fieldErrors.zoneIds[0]}</p>}
          {Object.entries(REGION).map(([r, label]) => {
            const list = zones.filter((z) => z.region === r);
            if (!list.length) return null;
            const all = list.every((z) => d.zoneIds.includes(z.id));
            return (
              <div key={r} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold text-ink-2">{label}</h3>
                  <button type="button" onClick={() => toggleRegion(r)} className="text-sm font-semibold text-fixy-800 underline-offset-2 hover:underline">{all ? "Quitar todas" : "Elegir todas"}</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {list.map((z) => <button key={z.id} type="button" aria-pressed={d.zoneIds.includes(z.id)} onClick={() => toggle("zoneIds", z.id)} className={chip(d.zoneIds.includes(z.id))}>{z.name}</button>)}
                </div>
              </div>
            );
          })}
          {d.zoneIds.length > 0 && (
            <Field label="Zona base (donde estás)" htmlFor="qs-base" className="max-w-sm" hint="Te priorizamos en pedidos cerca.">
              <Select id="qs-base" value={d.baseZoneId} onChange={(e) => setD({ ...d, baseZoneId: e.target.value })}>
                <option value="">Sin zona base</option>
                {zones.filter((z) => d.zoneIds.includes(z.id)).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </Select>
            </Field>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold">¿Cuándo trabajás?</h2>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => <button key={p.key || "later"} type="button" aria-pressed={d.availability === p.key} onClick={() => setD({ ...d, availability: p.key })} className={chip(d.availability === p.key)}>{p.label}</button>)}
          </div>
          <p className="text-sm text-muted">Después lo ajustás día por día.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold">Precios de referencia <span className="text-base font-semibold text-muted">(opcional)</span></h2>
          <p className="text-sm text-muted">El cliente ve “desde $…” antes de elegirte. El precio final lo definís en la visita.</p>
          {d.priceRefs.map((p, i) => (
            <div key={i} className="grid gap-2 rounded-2xl p-3 ring-1 ring-line sm:grid-cols-[160px_1fr_130px_auto] sm:items-end">
              <Field label="Rubro" htmlFor={`pr-c-${i}`}>
                <Select id={`pr-c-${i}`} value={p.categoryId} onChange={(e) => setD({ ...d, priceRefs: d.priceRefs.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)) })}>
                  <option value="">Elegí</option>
                  {categories.filter((c) => d.categoryIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Servicio" htmlFor={`pr-t-${i}`}>
                <Input id={`pr-t-${i}`} value={p.title} maxLength={120} placeholder="Ej.: Cambio de flexible" onChange={(e) => setD({ ...d, priceRefs: d.priceRefs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              </Field>
              <Field label="Desde ($)" htmlFor={`pr-p-${i}`}>
                <Input id={`pr-p-${i}`} type="number" inputMode="numeric" min={1} value={p.fromPesos} onChange={(e) => setD({ ...d, priceRefs: d.priceRefs.map((x, j) => (j === i ? { ...x, fromPesos: e.target.value } : x)) })} />
              </Field>
              <button type="button" aria-label="Quitar precio" onClick={() => setD({ ...d, priceRefs: d.priceRefs.filter((_, j) => j !== i) })} className="grid h-12 w-12 place-items-center rounded-xl text-muted hover:bg-cream"><Trash2 className="h-5 w-5" aria-hidden /></button>
            </div>
          ))}
          {d.priceRefs.length < 10 && (
            <Button type="button" variant="soft" size="sm" disabled={!d.categoryIds.length} onClick={() => setD({ ...d, priceRefs: [...d.priceRefs, { categoryId: d.categoryIds.length === 1 ? d.categoryIds[0] : "", title: "", fromPesos: "" }] })}>
              <Plus className="h-4 w-4" aria-hidden />Agregar precio
            </Button>
          )}
        </section>

        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" size="lg" onClick={save} disabled={saving}>{saving && <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />}{saving ? "Creando tu perfil…" : "Crear mi perfil"}</Button>
          <p className="text-sm text-muted">Después sumás fotos, documentación y cobros para empezar a recibir pedidos.</p>
        </div>
      </div>
      <aside className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
        <div className="rounded-3xl bg-white p-5 ring-1 ring-line">
          <StrengthMeter {...strength} max={4} links={false} />
        </div>
      </aside>
    </div>
  );
}
