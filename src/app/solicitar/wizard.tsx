"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowLeft, ArrowRight, Camera, Pencil, TriangleAlert, Info, LoaderCircle } from "lucide-react";
import type { TriageResult } from "@/server/assistant/rules";
import { bookableProvidersAction, submitRequestAction, triageAction, type RequestPayload } from "./actions";
import { ChooseProvider, type BookableProviderCard } from "./choose-provider";
import { Mascot } from "@/components/brand/mascot";
import { AddressFields } from "@/components/location/address-fields";
import { GatedToggle } from "@/components/location/gated-toggle";
import { CategoryIcon } from "@/components/category-icon";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";

type Category = { id: string; slug: string; name: string; description: string; icon: string; requires_review: boolean; safety_note: string | null };
type Question = { category_id: string; key: string; label: string; kind: "text" | "select" | "boolean"; options: string[]; required: boolean };
type Zone = { id: string; code: string; name: string; region: string; match_names: string[] };
type Service = { id: string; category_id: string; name: string; pricing_mode: string; fixed_price_minor: number | null; diagnostic_price_minor: number | null; scope: string; exclusions: string };
type Property = { id: string; label: string; kind: string; zone_id: string; zone_name: string; organization_id: string | null; org_name: string | null };

const URGENCIES = [
  { v: "flexible", l: "Sin apuro" },
  { v: "normal", l: "En los próximos días" },
  { v: "soon", l: "Lo antes posible" },
  { v: "urgent", l: "Urgente" },
] as const;
const WINDOWS = [
  { v: "morning", l: "Mañana (8 a 12 h)" },
  { v: "afternoon", l: "Tarde (12 a 17 h)" },
  { v: "evening", l: "Última hora (17 a 20 h)" },
  { v: "weekend", l: "Fin de semana" },
] as const;
const STEPS = ["Contanos qué pasa", "Algunos detalles", "Dónde y cuándo", "Elegí tu profesional", "Revisá y enviá"];

export function RequestWizard(props: {
  loggedIn: boolean;
  categories: Category[];
  questions: Question[];
  zones: Zone[];
  services: Service[];
  properties: Property[];
  orgs: { id: string; name: string }[];
  orgMembers: { organization_id: string; user_id: string; full_name: string }[];
  initialText: string;
  initialCategory: string | null;
  draft: RequestPayload | null;
  target: { slug: string; display_name: string } | null;
  previous: { id: string; code: string; title: string; property_id: string } | null;
}) {
  const d = props.draft;
  const [step, setStep] = useState(d ? 4 : 0);
  const [description, setDescription] = useState(d?.description ?? props.initialText);
  const [title, setTitle] = useState(d?.title ?? (props.previous ? `Nuevo pedido: ${props.previous.title}` : ""));
  const [categorySlug, setCategorySlug] = useState<string | null>(d?.categorySlug ?? props.initialCategory);
  const [serviceId, setServiceId] = useState<string | null>(d?.serviceId ?? null);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(d?.answers ?? {});
  const [urgency, setUrgency] = useState<RequestPayload["urgency"]>(d?.urgency ?? "normal");
  const [windows, setWindows] = useState<RequestPayload["windows"]>(d?.windows ?? []);
  const [propertyId, setPropertyId] = useState<string | null>(d?.propertyId ?? props.previous?.property_id ?? props.properties[0]?.id ?? null);
  const [newProp, setNewProp] = useState<Record<string, string>>(d?.newProperty ?? { kind: "home", label: "", addressLine: "", addressExtra: "", zoneId: "", contactName: "", contactPhone: "" });
  const [newPropOrg, setNewPropOrg] = useState<string | null>(d?.organizationId ?? null);
  const [responsible, setResponsible] = useState<string | null>(d?.responsibleUserId ?? null);
  const [accessInfo, setAccessInfo] = useState(d?.accessInfo ?? "");
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [triaging, startTriage] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [state, formAction] = useActionState(submitRequestAction, {});
  const [pros, setPros] = useState<BookableProviderCard[]>([]);
  const [loadingPros, setLoadingPros] = useState(false);
  const [chosen, setChosen] = useState<string | null>(d?.targetProviderSlug ?? null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const useNewProperty = !propertyId;

  const category = props.categories.find((c) => c.slug === categorySlug) ?? null;
  const questions = useMemo(() => props.questions.filter((q) => q.category_id === category?.id), [props.questions, category]);
  const services = props.services.filter((s) => s.category_id === category?.id && s.pricing_mode !== "quote");
  const service = props.services.find((s) => s.id === serviceId) ?? null;
  const selectedProperty = props.properties.find((p) => p.id === propertyId) ?? null;
  const orgForMembers = selectedProperty?.organization_id ?? (useNewProperty ? newPropOrg : null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  // Si había texto inicial (desde la landing), sugerimos categoría de entrada.
  useEffect(() => {
    if (props.initialText && !props.draft && !props.initialCategory) runTriage(props.initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function runTriage(text = description) {
    startTriage(async () => {
      const r = await triageAction(text, null);
      setTriage(r);
      if (r?.categorySlug && !categorySlug) setCategorySlug(r.categorySlug);
      if (r && !title) setTitle(r.suggestedTitle);
      if (r?.suggestedUrgency && r.suggestedUrgency !== "normal") setUrgency(r.suggestedUrgency);
    });
  }

  function loadProviders() {
    const zoneId = selectedProperty?.zone_id ?? newProp.zoneId;
    if (!categorySlug || !zoneId) return;
    setLoadingPros(true);
    bookableProvidersAction(categorySlug, zoneId, windows)
      .then((list) => {
        setPros(list);
        if (props.target && list.some((p) => p.slug === props.target!.slug)) setChosen(props.target.slug);
        else if (chosen && chosen !== "quotes" && !list.some((p) => p.slug === chosen)) setChosen(null);
        if (!list.length) setChosen("quotes");
      })
      .finally(() => setLoadingPros(false));
  }

  function next() {
    setLocalError(null);
    if (step === 0) {
      if (description.trim().length < 10) return setLocalError("Contanos un poco más: con 10 caracteres o más podemos orientarte mejor.");
      if (!title) setTitle(description.trim().split(/[.\n]/)[0].slice(0, 80));
      if (!triage) runTriage();
      if (!categorySlug) setCategorySlug("otro");
    }
    if (step === 1) {
      const missing = questions.filter((q) => q.required && (answers[q.key] === undefined || answers[q.key] === ""));
      if (missing.length) return setLocalError(`Respondé: ${missing.map((m) => m.label).join(" · ")}`);
    }
    if (step === 2) {
      if (useNewProperty && (!newProp.label || newProp.addressLine.length < 5 || !newProp.zoneId)) return setLocalError("Completá el nombre, la dirección y la zona del lugar.");
      if (category?.requires_review) {
        setChosen("quotes");
        return setStep(4);
      }
      loadProviders();
    }
    if (step === 3 && !chosen) return setLocalError("Elegí un profesional o la opción de recibir presupuestos de varios.");
    setStep((s) => Math.min(s + 1, 4));
  }

  const payload: RequestPayload = {
    description, title: title || description.slice(0, 80), categorySlug, serviceId, answers, urgency, windows,
    propertyId, newProperty: useNewProperty ? newProp : null, organizationId: useNewProperty ? newPropOrg : null,
    responsibleUserId: orgForMembers ? responsible : null, accessInfo, targetProviderSlug: chosen && chosen !== "quotes" ? chosen : null, previousJobId: props.previous?.id ?? null,
  };
  const chosenPro = chosen && chosen !== "quotes" ? pros.find((p) => p.slug === chosen) ?? null : null;
  const zoneName = props.zones.find((z) => z.id === newProp.zoneId)?.name;

  return (
    <div>
      {/* Encabezado y progreso */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fixy-700">Paso {step + 1} de {STEPS.length}</p>
          <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-3xl font-extrabold outline-none sm:text-4xl">
            {step === 0 ? "¿Qué necesitás resolver?" : STEPS[step]}
          </h1>
          {props.target && <p className="mt-2 text-ink-2">Pedido de presupuesto para <strong>{props.target.display_name}</strong>.</p>}
          {props.previous && <p className="mt-2 text-ink-2">Nuevo pedido vinculado al trabajo {props.previous.code}. Los precios y condiciones anteriores no se reutilizan.</p>}
        </div>
        <Mascot pose={step === 0 ? "listen" : step === 4 ? "wave" : "think"} className="hidden h-24 w-auto shrink-0 sm:block" key={step} />
      </div>
      <ol className="mt-5 grid grid-cols-5 gap-1.5" aria-label="Progreso">
        {STEPS.map((s, i) => (
          <li key={s} className={cn("h-1.5 rounded-full", i <= step ? "bg-fixy-700" : "bg-line")}>
            <span className="sr-only">{s}{i === step ? " (actual)" : i < step ? " (completo)" : ""}</span>
          </li>
        ))}
      </ol>

      <div className="mt-6 rounded-[var(--radius-card)] bg-white p-5 shadow-[var(--shadow-card)] ring-1 ring-line sm:p-7">
        {localError && <Alert tone="warn" className="mb-5">{localError}</Alert>}
        {state.error && <Alert tone="danger" className="mb-5">{state.error}</Alert>}

        {/* Paso 1 */}
        {step === 0 && (
          <div className="space-y-6">
            <Field label="Describí el problema con tus palabras" htmlFor="description" required hint="Por ejemplo: «Se corta la luz cuando prendo el horno» o «Gotea la canilla de la cocina».">
              <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => description.trim().length >= 10 && runTriage()} rows={4} maxLength={4000} required />
            </Field>
            <div aria-live="polite" className="min-h-5">
              <p className={cn("flex items-center gap-2 text-sm text-muted transition-opacity", triaging ? "opacity-100" : "opacity-0")} aria-hidden={!triaging}>
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Analizando tu descripción…
              </p>
              {triage?.safety && (
                <Alert tone={triage.safety.level === "emergency" ? "danger" : "warn"} title={triage.safety.title}>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5">{triage.safety.guidance.map((g) => <li key={g}>{g}</li>)}</ul>
                </Alert>
              )}
            </div>
            <fieldset>
              <legend className="text-[15px] font-semibold">¿Qué tipo de profesional necesitás?</legend>
              <p className="mt-0.5 text-sm text-muted">
                {triage?.categorySlug && triage.source
                  ? <>Te sugerimos <strong>{props.categories.find((c) => c.slug === triage.categorySlug)?.name}</strong>. Podés cambiarlo.</>
                  : "Si no estás seguro, elegí «No sé qué profesional necesito»."}
              </p>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {props.categories.map((c) => (
                  <label key={c.id} className="cursor-pointer">
                    <input type="radio" name="category" className="peer sr-only" checked={categorySlug === c.slug} onChange={() => { setCategorySlug(c.slug); setServiceId(null); }} />
                    <span className="flex min-h-14 items-center gap-3 rounded-2xl border border-[#d3dfdc] bg-white px-3 py-2 transition peer-checked:border-fixy-700 peer-checked:bg-fixy-50 peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40 hover:border-fixy-500">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-fixy-50 text-fixy-700"><CategoryIcon icon={c.icon} className="h-5 w-5" /></span>
                      <span className="text-[15px] font-semibold leading-snug">{c.name}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {/* Paso 2 */}
        {step === 1 && (
          <div className="space-y-6">
            {category?.requires_review && (
              <Alert tone="info" title="Lo revisa una persona del equipo">
                Como no definiste el oficio, una persona del equipo de Fixy va a leer tu pedido y derivarlo. Puede demorar más que un pedido catalogado.
              </Alert>
            )}
            {category?.safety_note && <Alert tone="warn">{category.safety_note}</Alert>}
            <Field label="Título breve" htmlFor="title" required hint="Así lo van a ver los profesionales.">
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} required />
            </Field>
            {questions.map((q) => (
              <Field key={q.key} label={q.label} htmlFor={`q-${q.key}`} required={q.required}>
                {q.kind === "select" ? (
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.label} id={`q-${q.key}`}>
                    {q.options.map((o) => (
                      <label key={o} className="cursor-pointer">
                        <input type="radio" name={`q-${q.key}`} className="peer sr-only" checked={answers[q.key] === o} onChange={() => setAnswers({ ...answers, [q.key]: o })} />
                        <span className="inline-flex min-h-11 items-center rounded-full border border-[#d3dfdc] px-4 text-[15px] font-medium peer-checked:border-fixy-700 peer-checked:bg-fixy-50 peer-checked:text-fixy-800 peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40">{o}</span>
                      </label>
                    ))}
                  </div>
                ) : q.kind === "boolean" ? (
                  <div className="flex gap-2" role="radiogroup" id={`q-${q.key}`}>
                    {[["Sí", true], ["No", false]].map(([l, v]) => (
                      <label key={String(l)} className="cursor-pointer">
                        <input type="radio" name={`q-${q.key}`} className="peer sr-only" checked={answers[q.key] === v} onChange={() => setAnswers({ ...answers, [q.key]: v as boolean })} />
                        <span className="inline-flex min-h-11 items-center rounded-full border border-[#d3dfdc] px-5 text-[15px] font-medium peer-checked:border-fixy-700 peer-checked:bg-fixy-50 peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40">{l as string}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <Input id={`q-${q.key}`} value={String(answers[q.key] ?? "")} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} maxLength={500} />
                )}
              </Field>
            ))}
            {services.length > 0 && (
              <fieldset>
                <legend className="text-[15px] font-semibold">¿Es alguno de estos servicios con alcance definido? <span className="font-normal text-muted">(opcional)</span></legend>
                <div className="mt-3 space-y-2">
                  {[{ id: "", name: "No, es otra cosa" } as Service, ...services].map((s) => (
                    <label key={s.id || "none"} className="block cursor-pointer">
                      <input type="radio" name="service" className="peer sr-only" checked={(serviceId ?? "") === s.id} onChange={() => setServiceId(s.id || null)} />
                      <span className="block rounded-2xl border border-[#d3dfdc] p-3 peer-checked:border-fixy-700 peer-checked:bg-fixy-50 peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40">
                        <span className="flex flex-wrap items-center justify-between gap-2 font-semibold">
                          {s.name}
                          {s.pricing_mode === "fixed" && s.fixed_price_minor && <span className="text-sm font-medium text-muted">Referencia: {formatMoney(s.fixed_price_minor)} mano de obra</span>}
                          {s.pricing_mode === "diagnostic" && s.diagnostic_price_minor && <span className="text-sm font-medium text-muted">Visita: {formatMoney(s.diagnostic_price_minor)}</span>}
                        </span>
                        {s.scope && <span className="mt-1 block text-sm text-muted">{s.scope} {s.exclusions && <>· {s.exclusions}</>}</span>}
                      </span>
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">Los valores de referencia son estimaciones: el precio confirmado es el del presupuesto que aceptes.</p>
              </fieldset>
            )}
          </div>
        )}

        {/* Paso 3 */}
        {step === 2 && (
          <div className="space-y-6">
            <fieldset>
              <legend className="text-[15px] font-semibold">¿Dónde es el trabajo?</legend>
              {props.properties.length > 0 && (
                <div className="mt-3 space-y-2">
                  {props.properties.map((p) => (
                    <label key={p.id} className="block cursor-pointer">
                      <input type="radio" name="property" className="peer sr-only" checked={propertyId === p.id} onChange={() => setPropertyId(p.id)} />
                      <span className="flex items-center justify-between rounded-2xl border border-[#d3dfdc] p-3 peer-checked:border-fixy-700 peer-checked:bg-fixy-50 peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40">
                        <span><span className="font-semibold">{p.label}</span> <span className="text-sm text-muted">· {p.zone_name}</span></span>
                        {p.org_name && <span className="text-xs font-semibold text-muted">{p.org_name}</span>}
                      </span>
                    </label>
                  ))}
                  <label className="block cursor-pointer">
                    <input type="radio" name="property" className="peer sr-only" checked={!propertyId} onChange={() => setPropertyId(null)} />
                    <span className="block rounded-2xl border border-dashed border-[#c6d4d1] p-3 font-semibold text-fixy-800 peer-checked:border-fixy-700 peer-checked:bg-fixy-50">+ Otro lugar</span>
                  </label>
                </div>
              )}
            </fieldset>
            {useNewProperty && (
              <div className="grid gap-4 rounded-2xl bg-cream/60 p-4 ring-1 ring-line sm:grid-cols-2">
                {props.orgs.length > 0 && (
                  <Field label="¿A quién pertenece?" htmlFor="np-owner" className="sm:col-span-2">
                    <Select id="np-owner" value={newPropOrg ?? ""} onChange={(e) => { setNewPropOrg(e.target.value || null); setNewProp({ ...newProp, kind: e.target.value ? "site" : "home" }); }}>
                      <option value="">A mí (particular)</option>
                      {props.orgs.map((o) => <option key={o.id} value={o.id}>Sede de {o.name}</option>)}
                    </Select>
                  </Field>
                )}
                <Field label="Nombre del lugar" htmlFor="np-label" required hint="Ej.: Casa, Oficina centro.">
                  <Input id="np-label" value={newProp.label} onChange={(e) => setNewProp({ ...newProp, label: e.target.value })} maxLength={120} />
                </Field>
                <AddressFields
                  zones={props.zones}
                  defaultValue={{ addressLine: newProp.addressLine ?? "", zoneId: newProp.zoneId ?? "", lat: newProp.lat ?? "", lng: newProp.lng ?? "", placeId: newProp.placeId ?? "", formattedAddress: newProp.formattedAddress ?? "" }}
                  onChange={(a) => setNewProp((p) => ({ ...p, ...a }))}
                />
                <Field label="Piso / depto." htmlFor="np-extra">
                  <Input id="np-extra" value={newProp.addressExtra} onChange={(e) => setNewProp({ ...newProp, addressExtra: e.target.value })} maxLength={120} />
                </Field>
                <Field label="Teléfono de contacto en el lugar" htmlFor="np-phone">
                  <Input id="np-phone" type="tel" value={newProp.contactPhone} onChange={(e) => setNewProp({ ...newProp, contactPhone: e.target.value })} maxLength={40} />
                </Field>
                <GatedToggle defaultChecked={!!newProp.gatedCommunity} defaultName={newProp.gatedName ?? ""} onChange={(g) => setNewProp((p) => ({ ...p, ...g }))} />
              </div>
            )}
            {orgForMembers && (
              <Field label="Responsable del pedido" htmlFor="responsible" hint="Recibe avisos y puede aprobar adicionales.">
                <Select id="responsible" value={responsible ?? ""} onChange={(e) => setResponsible(e.target.value || null)}>
                  <option value="">Yo</option>
                  {props.orgMembers.filter((m) => m.organization_id === orgForMembers).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Información de acceso" htmlFor="access" hint="Timbre, portería, horarios, mascotas. Se comparte solo con el profesional contratado.">
              <Textarea id="access" value={accessInfo} onChange={(e) => setAccessInfo(e.target.value)} rows={2} maxLength={1000} />
            </Field>
            <fieldset>
              <legend className="text-[15px] font-semibold">¿Qué tan urgente es?</legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {URGENCIES.map((u) => (
                  <label key={u.v} className="cursor-pointer">
                    <input type="radio" name="urgency" className="peer sr-only" checked={urgency === u.v} onChange={() => setUrgency(u.v)} />
                    <span className="inline-flex min-h-11 items-center rounded-full border border-[#d3dfdc] px-4 text-[15px] font-medium peer-checked:border-fixy-700 peer-checked:bg-fixy-50 peer-checked:text-fixy-800 peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40">{u.l}</span>
                  </label>
                ))}
              </div>
              {urgency === "urgent" && <p className="mt-2 text-sm text-muted">Vamos a priorizar profesionales con disponibilidad declarada, pero no podemos garantizar tiempos de llegada.</p>}
            </fieldset>
            <fieldset>
              <legend className="text-[15px] font-semibold">Franjas que te quedan bien <span className="font-normal text-muted">(opcional)</span></legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {WINDOWS.map((w) => (
                  <label key={w.v} className="cursor-pointer">
                    <input type="checkbox" className="peer sr-only" checked={windows.includes(w.v)} onChange={(e) => setWindows(e.target.checked ? [...windows, w.v] : windows.filter((x) => x !== w.v))} />
                    <span className="inline-flex min-h-11 items-center rounded-full border border-[#d3dfdc] px-4 text-[15px] font-medium peer-checked:border-fixy-700 peer-checked:bg-fixy-50 peer-checked:text-fixy-800 peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40">{w.l}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {/* Paso 4: resumen editable */}
        {step === 3 && (
          <ChooseProvider
            loading={loadingPros}
            providers={pros}
            chosen={chosen}
            onChoose={setChosen}
            categoryName={category?.name ?? ""}
          />
        )}

        {step === 4 && (
          <form action={formAction} className="space-y-5">
            <input type="hidden" name="payload" value={JSON.stringify(payload)} />
            <Summary label="Problema" onEdit={() => setStep(0)}>
              <p className="font-semibold">{payload.title}</p>
              <p className="mt-1 whitespace-pre-line text-ink-2">{description}</p>
            </Summary>
            <Summary label="Tipo de profesional" onEdit={() => setStep(0)}>
              {category?.name ?? "A definir por el equipo"}{service && <> · {service.name}</>}
              {Object.keys(answers).length > 0 && (
                <ul className="mt-1 text-sm text-muted">
                  {questions.filter((q) => answers[q.key] !== undefined && answers[q.key] !== "").map((q) => (
                    <li key={q.key}>{q.label}: <span className="text-ink">{typeof answers[q.key] === "boolean" ? (answers[q.key] ? "Sí" : "No") : String(answers[q.key])}</span></li>
                  ))}
                </ul>
              )}
            </Summary>
            {!category?.requires_review && (
              <Summary label="Profesional" onEdit={() => setStep(3)}>
                {chosenPro ? (
                  <>
                    <span className="font-semibold">{chosenPro.displayName}</span>
                    <div className="text-sm text-muted">{chosenPro.visitFeeMinor > 0 ? `Visita ${formatMoney(chosenPro.visitFeeMinor)}${chosenPro.visitFeeCredited ? " · se descuenta si contratás el arreglo" : ""}` : "Visita sin cargo"} · el arreglo se presupuesta en el lugar</div>
                  </>
                ) : "Recibir presupuestos de varios profesionales"}
              </Summary>
            )}
            <Summary label="Lugar y horarios" onEdit={() => setStep(2)}>
              {selectedProperty ? <>{selectedProperty.label} · {selectedProperty.zone_name}</> : <>{newProp.label || "Nuevo lugar"} · {zoneName ?? "Zona sin elegir"}</>}
              <div className="text-sm text-muted">
                {URGENCIES.find((u) => u.v === urgency)?.l}
                {windows.length > 0 && <> · {windows.map((w) => WINDOWS.find((x) => x.v === w)?.l).join(", ")}</>}
              </div>
            </Summary>
            {props.loggedIn ? (
              <div>
                <label htmlFor="photos" className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-[#c6d4d1] p-4 hover:border-fixy-500">
                  <Camera className="h-6 w-6 text-fixy-700" aria-hidden />
                  <span>
                    <span className="block font-semibold">Sumá fotos si podés</span>
                    <span className="block text-sm text-muted">{photoNames.length ? photoNames.join(", ") : "Hasta 6 fotos JPG, PNG o WEBP de 8 MB."}</span>
                  </span>
                </label>
                <input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => setPhotoNames(Array.from(e.target.files ?? []).map((f) => f.name).slice(0, 6))} />
              </div>
            ) : (
              <Alert tone="info" title="Último paso: creá tu cuenta">
                Guardamos tu pedido mientras te registrás. Después vas a poder sumar fotos y enviarlo.
              </Alert>
            )}
            <p className="flex items-start gap-2 text-sm text-muted">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {chosenPro
                ? `Le enviamos tu pedido a ${chosenPro.displayName}. Tiene unas horas para aceptar y proponerte día y horario; si no puede, elegís a otro. No se cobra nada hasta que confirmes la visita.`
                : "Pedir presupuestos es gratis. Vamos a invitar a un grupo acotado de profesionales de tu zona; no te prometemos disponibilidad inmediata."}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button type="button" variant="secondary" onClick={() => setStep(category?.requires_review ? 2 : 3)}><ArrowLeft className="h-4 w-4" aria-hidden /> Volver</Button>
              <SubmitButton size="lg" pendingText="Enviando…">{!props.loggedIn ? "Guardar y crear cuenta" : chosenPro ? `Pedir visita a ${chosenPro.displayName}` : "Enviar pedido"}</SubmitButton>
            </div>
          </form>
        )}

        {step < 4 && (
          <div className="mt-8 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
            {step > 0 ? <Button type="button" variant="secondary" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" aria-hidden /> Volver</Button> : <span />}
            <Button type="button" size="lg" onClick={next}>Continuar <ArrowRight className="h-4 w-4" aria-hidden /></Button>
          </div>
        )}
      </div>
      {step === 0 && (
        <p className="mt-4 flex items-start gap-2 text-sm text-muted">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Fixy no reemplaza a los servicios de emergencia. Ante riesgo inmediato, llamá al 911.
        </p>
      )}
    </div>
  );
}

function Summary({ label, children, onEdit }: { label: string; children: React.ReactNode; onEdit: () => void }) {
  return (
    <section className="flex items-start justify-between gap-4 border-b border-line pb-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-muted">{label}</h2>
        <div className="mt-1">{children}</div>
      </div>
      <button type="button" onClick={onEdit} className="inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-fixy-800 hover:bg-fixy-50">
        <Pencil className="h-4 w-4" aria-hidden /> Editar
      </button>
    </section>
  );
}
