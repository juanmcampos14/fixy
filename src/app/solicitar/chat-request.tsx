"use client";

/**
 * Pedido conversacional. Cada paso es un mensaje, igual que el guion de WhatsApp (docs/flujo-pedido.md):
 *  1. Contás el problema  →  la IA detecta el oficio.
 *  2. Compartís la ubicación con un toque (o la escribís, o elegís un lugar guardado).
 *  3. Te mostramos profesionales; elegís uno (o pedís varios presupuestos).
 *  4. Enviás. Los detalles (fotos, horarios, preguntas del oficio) son opcionales.
 */
import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowUp, BadgeCheck, Camera, ChevronDown, LoaderCircle, LocateFixed, MapPin, Pencil, Star, TriangleAlert } from "lucide-react";
import type { TriageResult } from "@/server/assistant/rules";
import { bookableProvidersAction, submitRequestAction, triageAction, type RequestPayload } from "./actions";
import type { BookableProviderCard } from "./choose-provider";
import { Mascot } from "@/components/brand/mascot";
import { AddressFields } from "@/components/location/address-fields";
import { GatedToggle } from "@/components/location/gated-toggle";
import { canLocate, LOCATE_ERROR, locateMe, type ZoneOption } from "@/components/location/locate";
import { CategoryIcon } from "@/components/category-icon";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";

type Category = { id: string; slug: string; name: string; icon: string; requires_review: boolean; safety_note: string | null };
type Question = { category_id: string; key: string; label: string; kind: "text" | "select" | "boolean"; options: string[]; required: boolean };
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

const chip = (on: boolean) => cn(
  "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full px-4 py-1.5 text-left text-[15px] font-medium ring-1 transition-colors",
  on ? "bg-fixy-700 text-white ring-fixy-700" : "bg-white text-ink ring-[#d3dfdc] hover:ring-fixy-500",
);

export function ChatRequest(props: {
  loggedIn: boolean;
  categories: Category[];
  questions: Question[];
  zones: ZoneOption[];
  properties: Property[];
  orgMembers: { organization_id: string; user_id: string; full_name: string }[];
  initialText: string;
  initialCategory: string | null;
  draft: RequestPayload | null;
  target: { slug: string; display_name: string } | null;
  previous: { id: string; code: string; title: string; property_id: string } | null;
}) {
  const d = props.draft;
  // 1. Problema
  const [text, setText] = useState(d?.description ?? props.initialText);
  const [sent, setSent] = useState(!!d);
  const [triage, setTriage] = useState<TriageResult | null>(null);
  const [triaging, startTriage] = useTransition();
  const [categorySlug, setCategorySlug] = useState<string | null>(d?.categorySlug ?? props.initialCategory);
  const [pickCategory, setPickCategory] = useState(false);
  const [title, setTitle] = useState(d?.title ?? (props.previous ? `Nuevo pedido: ${props.previous.title}` : ""));
  // 2. Ubicación
  const [propertyId, setPropertyId] = useState<string | null>(d?.propertyId ?? props.previous?.property_id ?? null);
  const [newProp, setNewProp] = useState<Record<string, string>>(d?.newProperty ?? { kind: "home", label: "Casa", addressLine: "", addressExtra: "", zoneId: "", contactPhone: "" });
  const [locationDone, setLocationDone] = useState(!!d || !!props.previous);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  // 3. Profesional
  const [prosState, setProsState] = useState<{ key: string | null; list: BookableProviderCard[] }>({ key: null, list: [] });
  const [chosen, setChosen] = useState<string | null>(d ? d.targetProviderSlug ?? "quotes" : null);
  // 4. Detalles opcionales
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>(d?.answers ?? {});
  const [urgency, setUrgency] = useState<RequestPayload["urgency"]>(d?.urgency ?? "normal");
  const [windows, setWindows] = useState<RequestPayload["windows"]>(d?.windows ?? []);
  const [accessInfo, setAccessInfo] = useState(d?.accessInfo ?? "");
  const [responsible, setResponsible] = useState<string | null>(d?.responsibleUserId ?? null);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [state, formAction] = useActionState(submitRequestAction, {});
  const endRef = useRef<HTMLDivElement>(null);

  const category = props.categories.find((c) => c.slug === categorySlug) ?? null;
  const questions = useMemo(() => props.questions.filter((q) => q.category_id === category?.id), [props.questions, category]);
  const property = props.properties.find((p) => p.id === propertyId) ?? null;
  const zoneId = property?.zone_id ?? (locationDone ? newProp.zoneId : "");
  const zoneName = property?.zone_name ?? props.zones.find((z) => z.id === newProp.zoneId)?.name ?? "";
  const reviewOnly = !!category?.requires_review;

  // Si llega con texto (desde la landing o WhatsApp), lo enviamos directo.
  useEffect(() => {
    if (!d && props.initialText.trim().length >= 10) send(props.initialText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Candidatos apenas hay oficio y zona.
  const prosKey = categorySlug && zoneId && !reviewOnly ? `${categorySlug}|${zoneId}` : null;
  useEffect(() => {
    if (!prosKey) return;
    let cancelled = false;
    const [slug, zone] = prosKey.split("|");
    bookableProvidersAction(slug, zone, []).then((list) => {
      if (cancelled) return;
      setProsState({ key: prosKey, list });
      if (props.target && list.some((p) => p.slug === props.target!.slug)) setChosen((c) => c ?? props.target!.slug);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prosKey]);
  const pros = prosKey && prosState.key === prosKey ? prosState.list : [];
  const loadingPros = !!prosKey && prosState.key !== prosKey;

  // Lleva la vista al último mensaje (sin animación si la persona prefiere menos movimiento).
  const pick = reviewOnly ? "quotes" : chosen; // los pedidos que revisa el equipo no eligen profesional
  const stage = !sent ? 0 : triaging || !category ? 1 : !locationDone ? 2 : !pick ? 3 : 4;
  useEffect(() => {
    if (stage === 0) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [stage, loadingPros, detailsOpen]);

  function send(value = text) {
    const t = value.trim();
    if (t.length < 10) return;
    setText(t);
    setSent(true);
    if (!title) setTitle(t.split(/[.\n]/)[0].slice(0, 80));
    startTriage(async () => {
      const r = await triageAction(t, null);
      setTriage(r);
      if (!props.initialCategory) {
        if (r?.categorySlug) setCategorySlug(r.categorySlug);
        else setPickCategory(true);
      }
      if (r?.suggestedTitle) setTitle((x) => (x && !x.startsWith(t.slice(0, 20)) ? x : r.suggestedTitle));
      if (r?.suggestedUrgency && r.suggestedUrgency !== "normal") setUrgency(r.suggestedUrgency);
    });
  }

  function editProblem() {
    setSent(false);
    setTriage(null);
    setChosen(null);
    if (!props.initialCategory) setCategorySlug(null);
  }

  async function shareLocation() {
    setLocError(null);
    setLocating(true);
    const r = await locateMe(props.zones);
    setLocating(false);
    if (!r.ok) {
      setLocError(LOCATE_ERROR[r.error]);
      setTyping(true);
      return;
    }
    setPropertyId(null);
    setNewProp((p) => ({ ...p, ...r.located.value }));
    setLocationDone(true);
    setChosen(null);
  }

  function chooseProperty(id: string) {
    setPropertyId(id);
    setLocationDone(true);
    setChosen(null);
  }

  function confirmTypedAddress() {
    if ((newProp.addressLine ?? "").trim().length < 5) return setLocError("Escribí la calle y la altura.");
    if (!newProp.zoneId) return setLocError("Elegí la zona.");
    setLocError(null);
    setPropertyId(null);
    setLocationDone(true);
    setTyping(false);
    setChosen(null);
  }

  function changeLocation() {
    setLocationDone(false);
    setChosen(null);
    setPropertyId(null);
  }

  const chosenPro = pick && pick !== "quotes" ? pros.find((p) => p.slug === pick) ?? null : null;
  const payload: RequestPayload = {
    description: text, title: title || text.slice(0, 80), categorySlug: categorySlug ?? "otro", serviceId: null, answers, urgency, windows,
    propertyId, newProperty: propertyId ? null : newProp, organizationId: null,
    responsibleUserId: property?.organization_id ? responsible : null, accessInfo, targetProviderSlug: chosenPro?.slug ?? null, previousJobId: props.previous?.id ?? null,
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="sr-only">Pedí un profesional</h1>
      <ol className="space-y-4" aria-live="polite">
        <Bot>
          {props.target
            ? <>Hola, soy Fixy. Contame qué problema tenés y se lo paso a <strong>{props.target.display_name}</strong>.</>
            : props.previous
              ? <>Hola de nuevo. Contame qué necesitás ahora (es un pedido nuevo, vinculado al trabajo {props.previous.code}).</>
              : <>Hola, soy Fixy. <strong>Contame qué problema tenés</strong> y te muestro profesionales que pueden ir.</>}
        </Bot>

        {/* 1. Problema */}
        {!sent ? (
          <li className="list-none">
            <form onSubmit={(e) => { e.preventDefault(); send(); }} className="rounded-3xl bg-white p-3 shadow-[var(--shadow-card)] ring-1 ring-line focus-within:ring-2 focus-within:ring-fixy-600">
              <label htmlFor="problem" className="sr-only">Contá el problema</label>
              <Textarea id="problem" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} autoFocus
                placeholder="Ej.: Gotea la canilla de la cocina y pierde agua abajo de la mesada."
                className="border-0 bg-transparent px-2 shadow-none focus:ring-0"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <span className="text-xs text-muted">{text.trim().length < 10 ? "Con una o dos oraciones alcanza." : "Enter para enviar"}</span>
                <button type="submit" disabled={text.trim().length < 10} aria-label="Enviar"
                  className="grid h-11 w-11 place-items-center rounded-full bg-fixy-700 text-white transition disabled:opacity-40">
                  <ArrowUp className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </form>
          </li>
        ) : (
          <Me onEdit={editProblem}>{text}</Me>
        )}

        {sent && triaging && <Typing label="Entendiendo tu problema…" />}
        {sent && triage?.safety && (
          <Bot tone={triage.safety.level === "emergency" ? "danger" : "warn"}>
            <strong>{triage.safety.title}</strong>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{triage.safety.guidance.map((g) => <li key={g}>{g}</li>)}</ul>
          </Bot>
        )}

        {/* Oficio */}
        {sent && !triaging && (category && !pickCategory ? (
          <Bot>
            {reviewOnly
              ? <>No me queda claro qué oficio necesitás: <strong>una persona del equipo</strong> lee tu pedido y te propone profesionales.</>
              : <>Parece trabajo de <strong className="inline-flex items-center gap-1"><CategoryIcon icon={category.icon} className="h-4 w-4" />{category.name}</strong>.</>}{" "}
            <button type="button" onClick={() => setPickCategory(true)} className="font-semibold text-fixy-800 underline">¿No es eso?</button>
          </Bot>
        ) : sent && !triaging && (
          <Bot>
            ¿Qué tipo de profesional necesitás?
            <div className="mt-3 flex flex-wrap gap-2">
              {props.categories.map((c) => (
                <button key={c.id} type="button" aria-pressed={categorySlug === c.slug} className={chip(categorySlug === c.slug)}
                  onClick={() => { setCategorySlug(c.slug); setPickCategory(false); setChosen(null); }}>
                  <CategoryIcon icon={c.icon} className="h-4 w-4" />{c.name}
                </button>
              ))}
            </div>
          </Bot>
        ))}

        {/* 2. Ubicación */}
        {stage >= 2 && !pickCategory && (
          !locationDone ? (
            <Bot>
              <strong>¿Dónde es?</strong> Tu dirección la ve y la protege solo Fixy: el profesional la recibe recién cuando se confirma la visita.
              <div className="mt-3 flex flex-wrap gap-2">
                {props.properties.map((p) => (
                  <button key={p.id} type="button" className={chip(false)} onClick={() => chooseProperty(p.id)}>
                    <MapPin className="h-4 w-4" aria-hidden />{p.label}<span className="text-muted">· {p.zone_name}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                {canLocate() && (
                  <button type="button" onClick={shareLocation} disabled={locating}
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-fixy-700 px-5 font-semibold text-white disabled:opacity-60">
                    {locating ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <LocateFixed className="h-5 w-5" aria-hidden />}
                    {locating ? "Buscando tu ubicación…" : "Compartir mi ubicación"}
                  </button>
                )}
                <button type="button" onClick={() => setTyping(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-5 font-semibold text-fixy-800 ring-1 ring-[#d3dfdc]">
                  <Pencil className="h-4 w-4" aria-hidden />Escribir la dirección
                </button>
              </div>
              {locError && <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-warn"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{locError}</p>}
              {typing && (
                <div className="mt-4 grid gap-4 rounded-2xl bg-cream/60 p-3 ring-1 ring-line sm:grid-cols-2">
                  <AddressFields zones={props.zones} defaultValue={{ addressLine: newProp.addressLine ?? "", zoneId: newProp.zoneId ?? "" }} onChange={(a) => setNewProp((p) => ({ ...p, ...a }))} />
                  <div className="sm:col-span-2">
                    <button type="button" onClick={confirmTypedAddress} className="inline-flex min-h-11 items-center rounded-full bg-fixy-700 px-5 font-semibold text-white">Listo</button>
                  </div>
                </div>
              )}
            </Bot>
          ) : (
            <Me onEdit={changeLocation}>
              <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden />{property ? `${property.label} · ${property.zone_name}` : `${newProp.addressLine} · ${zoneName}`}</span>
            </Me>
          )
        )}

        {/* 3. Profesionales */}
        {stage >= 3 && !pickCategory && !reviewOnly && (loadingPros ? (
          <Typing label={`Buscando profesionales de ${category?.name.toLowerCase()} cerca…`} />
        ) : !chosen ? (
          <Bot wide>
            {pros.length ? (
              <>Estos profesionales pueden ir{zoneName && zoneName !== "Otra zona" ? ` a ${zoneName}` : ""}. <strong>Elegí uno</strong>: coordinan la visita por Fixy y te presupuesta el arreglo en el lugar.</>
            ) : (
              <>Enviá tu pedido y te conectamos con un profesional de {category?.name.toLowerCase() ?? "este rubro"}{zoneName && zoneName !== "Otra zona" ? ` en ${zoneName}` : " de tu zona"}. Te avisamos apenas lo tome.</>
            )}
            <ul className="mt-3 space-y-3">
              {pros.map((p) => <li key={p.slug}><ProCard p={p} onChoose={() => setChosen(p.slug)} /></li>)}
            </ul>
            <button type="button" onClick={() => setChosen("quotes")}
              className={cn("mt-3 w-full rounded-2xl px-4 py-3 text-left font-semibold", pros.length ? "border border-dashed border-[#c6d4d1] text-fixy-800" : "bg-fixy-700 text-center text-white")}>
              {pros.length ? "Prefiero que me manden presupuestos varios" : "Hacer el pedido igual"}
            </button>
          </Bot>
        ) : (
          <Me onEdit={() => setChosen(null)}>{chosenPro ? `Elijo a ${chosenPro.displayName}` : pros.length ? "Quiero recibir presupuestos de varios" : "Hago el pedido igual"}</Me>
        ))}

        {/* 4. Confirmar (detalles opcionales) */}
        {stage >= 4 && !pickCategory && (
          <Bot wide>
            {chosenPro
              ? <>Listo. Le mando tu pedido a <strong>{chosenPro.displayName}</strong>: {chosenPro.verified ? "tiene unas horas para aceptar y proponerte día y horario." : "todavía no verificó su identidad, así que le pedimos que se verifique antes de aceptar (le damos hasta 48 h). Si preferís no esperar, podés elegir a otro."} <strong>No pagás nada hasta confirmar la visita</strong>{chosenPro.visitFeeMinor > 0 ? ` (${formatMoney(chosenPro.visitFeeMinor)}${chosenPro.visitFeeCredited ? ", se descuenta si contratás el arreglo" : ""})` : " (sin cargo)"}.</>
              : <>Listo. {pros.length ? "Invitamos a un grupo de profesionales de tu zona y te llegan sus presupuestos para comparar." : "Nuestro equipo busca un profesional para vos y te avisa."} Pedir es gratis.</>}
            <form action={formAction} className="mt-4 space-y-4">
              <input type="hidden" name="payload" value={JSON.stringify(payload)} />
              {state.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}

              <div className="rounded-2xl ring-1 ring-line">
                <button type="button" aria-expanded={detailsOpen} aria-controls="details" onClick={() => setDetailsOpen((o) => !o)}
                  className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left">
                  <span><span className="font-semibold">Sumar detalles</span> <span className="text-sm text-muted">(opcional: fotos, horarios, piso, acceso)</span></span>
                  <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", detailsOpen && "rotate-180")} aria-hidden />
                </button>
                <div id="details" hidden={!detailsOpen} className="space-y-5 border-t border-line p-4">
                  {props.loggedIn && (
                    <div>
                      <label htmlFor="photos" className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-[#c6d4d1] p-3 hover:border-fixy-500">
                        <Camera className="h-6 w-6 text-fixy-700" aria-hidden />
                        <span><span className="block font-semibold">Fotos del problema</span><span className="block text-sm text-muted">{photoNames.length ? photoNames.join(", ") : "Hasta 6 fotos. Ayudan a que llegue preparado."}</span></span>
                      </label>
                      <input id="photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => setPhotoNames(Array.from(e.target.files ?? []).map((f) => f.name).slice(0, 6))} />
                    </div>
                  )}
                  <fieldset>
                    <legend className="text-[15px] font-semibold">¿Para cuándo?</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {URGENCIES.map((u) => <button key={u.v} type="button" aria-pressed={urgency === u.v} className={chip(urgency === u.v)} onClick={() => setUrgency(u.v)}>{u.l}</button>)}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="text-[15px] font-semibold">Horarios que te quedan bien</legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {WINDOWS.map((w) => {
                        const on = windows.includes(w.v);
                        return <button key={w.v} type="button" aria-pressed={on} className={chip(on)} onClick={() => setWindows(on ? windows.filter((x) => x !== w.v) : [...windows, w.v])}>{w.l}</button>;
                      })}
                    </div>
                  </fieldset>
                  {questions.map((q) => (
                    <fieldset key={q.key}>
                      <legend className="text-[15px] font-semibold">{q.label}</legend>
                      {q.kind === "text" ? (
                        <Input aria-label={q.label} className="mt-2" value={String(answers[q.key] ?? "")} maxLength={500} onChange={(e) => setAnswers({ ...answers, [q.key]: e.target.value })} />
                      ) : (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(q.kind === "boolean" ? [["Sí", true], ["No", false]] as const : q.options.map((o) => [o, o] as const)).map(([l, v]) => (
                            <button key={String(l)} type="button" aria-pressed={answers[q.key] === v} className={chip(answers[q.key] === v)} onClick={() => setAnswers({ ...answers, [q.key]: v })}>{l}</button>
                          ))}
                        </div>
                      )}
                    </fieldset>
                  ))}
                  {!property && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Piso / depto." htmlFor="np-extra"><Input id="np-extra" value={newProp.addressExtra ?? ""} maxLength={120} onChange={(e) => setNewProp({ ...newProp, addressExtra: e.target.value })} /></Field>
                      <Field label="Nombre del lugar" htmlFor="np-label" hint="Solo lo ves vos."><Input id="np-label" value={newProp.label ?? ""} maxLength={120} onChange={(e) => setNewProp({ ...newProp, label: e.target.value || "Casa" })} /></Field>
                      <GatedToggle defaultChecked={!!newProp.gatedCommunity} defaultName={newProp.gatedName ?? ""} onChange={(g) => setNewProp((p) => ({ ...p, ...g }))} />
                    </div>
                  )}
                  {property?.organization_id && (
                    <Field label="Responsable del pedido" htmlFor="responsible" hint="Recibe avisos y puede aprobar adicionales.">
                      <Select id="responsible" value={responsible ?? ""} onChange={(e) => setResponsible(e.target.value || null)}>
                        <option value="">Yo</option>
                        {props.orgMembers.filter((m) => m.organization_id === property.organization_id).map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name}</option>)}
                      </Select>
                    </Field>
                  )}
                  <Field label="Indicaciones de acceso" htmlFor="access" hint="Timbre, portería, mascotas. Solo las ve el profesional confirmado.">
                    <Textarea id="access" value={accessInfo} rows={2} maxLength={1000} onChange={(e) => setAccessInfo(e.target.value)} />
                  </Field>
                </div>
              </div>

              <SubmitButton size="lg" className="w-full" pendingText="Enviando…">
                {!props.loggedIn ? "Crear cuenta y enviar" : chosenPro ? `Enviar a ${chosenPro.displayName}` : "Enviar pedido"}
              </SubmitButton>
              {!props.loggedIn && <p className="text-center text-sm text-muted">Guardamos tu pedido mientras creás la cuenta (un minuto).</p>}
            </form>
          </Bot>
        )}
        <div ref={endRef} />
      </ol>
      <p className="mt-6 flex items-start gap-2 text-sm text-muted">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Fixy no reemplaza a los servicios de emergencia. Ante riesgo inmediato, llamá al 911.
      </p>
    </div>
  );
}

function Bot({ children, tone, wide }: { children: React.ReactNode; tone?: "warn" | "danger"; wide?: boolean }) {
  return (
    <li className="flex list-none items-start gap-2.5 motion-safe:animate-pop-in">
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-fixy-50 ring-1 ring-fixy-500/20">
        <Mascot pose="listen" animate={false} className="h-9 w-auto translate-y-1" />
      </span>
      <div className={cn("min-w-0 rounded-3xl rounded-tl-md px-4 py-3 text-[16px] leading-relaxed shadow-[var(--shadow-card)] ring-1",
        wide ? "flex-1" : "max-w-[85%]",
        tone === "danger" ? "bg-danger-bg ring-danger/20" : tone === "warn" ? "bg-warn-bg ring-warn/20" : "bg-white ring-line")}>
        {children}
      </div>
    </li>
  );
}

function Me({ children, onEdit }: { children: React.ReactNode; onEdit?: () => void }) {
  return (
    <li className="flex list-none flex-col items-end gap-1 motion-safe:animate-pop-in">
      <div className="max-w-[85%] whitespace-pre-line rounded-3xl rounded-tr-md bg-fixy-700 px-4 py-3 text-[16px] leading-relaxed text-white">{children}</div>
      {onEdit && <button type="button" onClick={onEdit} className="min-h-8 px-2 text-sm font-semibold text-fixy-800 underline">Cambiar</button>}
    </li>
  );
}

function Typing({ label }: { label: string }) {
  return (
    <li className="flex list-none items-center gap-2.5" role="status">
      <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-fixy-50 ring-1 ring-fixy-500/20">
        <Mascot pose="think" animate={false} className="h-9 w-auto translate-y-1" />
      </span>
      <span className="inline-flex items-center gap-2 rounded-3xl bg-white px-4 py-3 text-muted ring-1 ring-line">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />{label}
      </span>
    </li>
  );
}

function ProCard({ p, onChoose }: { p: BookableProviderCard; onChoose: () => void }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-[#d3dfdc]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{p.displayName}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {p.reviews ? <span className="inline-flex items-center gap-1 font-semibold"><Star className="h-4 w-4 fill-spark text-spark" aria-hidden />{p.rating} <span className="font-normal text-muted">({p.reviews} reseñas)</span></span> : <span className="text-muted">Nuevo en Fixy</span>}
            {p.verified ? <span className="inline-flex items-center gap-1 text-ok"><BadgeCheck className="h-4 w-4" aria-hidden />Verificado</span> : <span className="rounded-full bg-warn-bg px-2 py-0.5 text-xs font-semibold text-warn">Todavía sin verificar</span>}
            {p.isDemo && <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-muted">Demostración</span>}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted">Visita</p>
          <p className="tabular font-display text-lg font-extrabold">{p.visitFeeMinor > 0 ? formatMoney(p.visitFeeMinor) : "Sin cargo"}</p>
        </div>
      </div>
      {p.priceRefs[0] && <p className="mt-2 text-sm text-ink-2">{p.priceRefs[0].title}: <span className="tabular font-semibold">desde {formatMoney(p.priceRefs[0].fromMinor)}</span></p>}
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={onChoose} aria-label={`Elegir a ${p.displayName}`} className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full bg-fixy-50 px-5 font-semibold text-fixy-800 ring-1 ring-fixy-600 transition-colors hover:bg-fixy-100">Elegir</button>
        <a href={`/profesionales/${p.slug}`} target="_blank" rel="noreferrer" className="min-h-11 px-2 py-2.5 text-sm font-semibold text-fixy-800 underline">Ver perfil</a>
      </div>
    </div>
  );
}
