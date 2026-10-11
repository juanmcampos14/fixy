"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, LocateFixed, MapPin, TriangleAlert } from "lucide-react";
import type { AddressComponent } from "@/lib/zone-match";
import { loadGoogleMaps, MAPS_KEY } from "./google-maps";
import { cn } from "@/lib/cn";
import { AddressPrivacyNote } from "./privacy-note";

import { componentsToAddress, FEW_PROS_MESSAGE, LOCATE_ERROR, locateMe, type AddressValue, type ZoneOption } from "./locate";
export type { AddressValue, ZoneOption } from "./locate";

const REGION: Record<string, string> = { CABA: "Ciudad de Buenos Aires", GBA_NORTE: "GBA Norte", GBA_OESTE: "GBA Oeste", GBA_SUR: "GBA Sur", OTRA: "Fuera de CABA y GBA" };
const BA_CENTER = { lat: -34.6037, lng: -58.3816 };
const control = "block w-full rounded-xl border border-control bg-surface px-3.5 text-[16px] text-ink focus:border-fixy-600 focus:outline-none focus:ring-3 focus:ring-fixy-500/25";

/**
 * Dirección + zona. Con clave de Google Maps: autocompletado (Places API New, solo Argentina, sesgado a AMBA),
 * "Usar mi ubicación" (geolocalización del navegador + Geocoding) y zona asignada automáticamente.
 * Sin clave: carga manual. Siempre renderiza inputs con nombre para usarse dentro de formularios.
 */
export function AddressFields({ zones, defaultValue, onChange, required = true }: {
  zones: ZoneOption[];
  defaultValue?: Partial<AddressValue>;
  onChange?: (v: AddressValue) => void;
  required?: boolean;
}) {
  const uid = useId();
  const [v, setV] = useState<AddressValue>({ addressLine: "", zoneId: "", lat: "", lng: "", placeId: "", formattedAddress: "", ...defaultValue });
  const [suggestions, setSuggestions] = useState<{ id: string; main: string; secondary: string; prediction: any }[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState<"" | "locating" | "loading">("");
  const [msg, setMsg] = useState<{ tone: "warn" | "ok" | "info"; text: string } | null>(null);
  const [autoZone, setAutoZone] = useState(false);
  const token = useRef<any>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = !!MAPS_KEY;

  // Valor actual en una ref: avisamos al padre fuera del render (onChange no puede ir dentro del updater de setState).
  const current = useRef(v);
  const update = (patch: Partial<AddressValue>) => {
    const next = { ...current.current, ...patch };
    current.current = next;
    setV(next);
    onChange?.(next);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function applyComponents(components: AddressComponent[], formatted: string, lat: number, lng: number, placeId: string, streetLine?: string) {
    const { value, zone, outside } = componentsToAddress(components, formatted, lat, lng, placeId, zones, streetLine);
    update(zone ? value : { ...value, zoneId: current.current.zoneId });
    setAutoZone(!!zone);
    setMsg(zone && !outside ? { tone: "ok", text: `Zona detectada: ${zone.name}.` } : { tone: "info", text: FEW_PROS_MESSAGE });
  }

  async function search(input: string) {
    const g = await loadGoogleMaps()?.catch(() => null);
    if (!g || input.trim().length < 3) return setSuggestions([]);
    const { AutocompleteSessionToken, AutocompleteSuggestion } = await g.maps.importLibrary("places");
    token.current ??= new AutocompleteSessionToken();
    try {
      const { suggestions: res } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input, sessionToken: token.current, includedRegionCodes: ["ar"], language: "es",
        locationBias: { center: BA_CENTER, radius: 50000 },
      });
      setSuggestions(res.filter((s: any) => s.placePrediction).slice(0, 5).map((s: any) => ({
        id: s.placePrediction.placeId,
        main: s.placePrediction.mainText?.toString() ?? s.placePrediction.text.toString(),
        secondary: s.placePrediction.secondaryText?.toString() ?? "",
        prediction: s.placePrediction,
      })));
      setOpen(true);
      setActive(-1);
    } catch {
      setSuggestions([]);
    }
  }

  async function choose(i: number) {
    const s = suggestions[i];
    if (!s) return;
    setOpen(false);
    setBusy("loading");
    try {
      const place = s.prediction.toPlace();
      await place.fetchFields({ fields: ["formattedAddress", "location", "addressComponents"] });
      token.current = null; // la sesión de autocompletado termina al elegir
      applyComponents(place.addressComponents as AddressComponent[], place.formattedAddress, place.location.lat(), place.location.lng(), s.id, s.main);
    } catch {
      setMsg({ tone: "warn", text: "No pudimos obtener esa dirección. Escribila a mano y elegí la zona." });
    } finally {
      setBusy("");
    }
  }

  async function locate() {
    setBusy("locating");
    setMsg(null);
    const r = await locateMe(zones);
    setBusy("");
    if (!r.ok) return setMsg({ tone: "warn", text: LOCATE_ERROR[r.error] });
    const { value, zone, outside } = r.located;
    update(zone ? value : { ...value, zoneId: current.current.zoneId });
    setAutoZone(!!zone);
    setMsg(outside ? { tone: "info", text: FEW_PROS_MESSAGE } : { tone: "ok", text: `Zona detectada: ${zone!.name}. Revisá la altura y completá piso o depto.` });
  }

  const listId = `${uid}-list`;
  return (
    <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label htmlFor={`${uid}-addr`} className="block text-[15px] font-semibold text-ink">Dirección{required && <span className="text-danger" aria-hidden> *</span>}</label>
          {enabled && (
            <button type="button" onClick={locate} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-fixy-800 hover:bg-fixy-50 disabled:opacity-60">
              {busy === "locating" ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <LocateFixed className="h-4 w-4" aria-hidden />}
              Usar mi ubicación
            </button>
          )}
        </div>
        <AddressPrivacyNote compact />
        <div className="relative">
          <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" aria-hidden />
          <input
            id={`${uid}-addr`}
            name="addressLine"
            value={v.addressLine}
            required={required}
            minLength={5}
            maxLength={200}
            autoComplete={enabled ? "off" : "street-address"}
            role={enabled ? "combobox" : undefined}
            aria-autocomplete={enabled ? "list" : undefined}
            aria-expanded={enabled ? open && suggestions.length > 0 : undefined}
            aria-controls={enabled ? listId : undefined}
            aria-activedescendant={enabled && active >= 0 ? `${listId}-${active}` : undefined}
            placeholder={enabled ? "Empezá a escribir la calle y la altura" : "Calle y altura"}
            className={cn(control, "h-12 pl-11")}
            onChange={(e) => {
              update({ addressLine: e.target.value, lat: "", lng: "", placeId: "", formattedAddress: "" });
              setAutoZone(false);
              if (enabled) {
                if (timer.current) clearTimeout(timer.current);
                const val = e.target.value;
                timer.current = setTimeout(() => search(val), 250);
              }
            }}
            onKeyDown={(e) => {
              if (!open || !suggestions.length) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, suggestions.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === "Enter" && active >= 0) { e.preventDefault(); choose(active); }
              else if (e.key === "Escape") setOpen(false);
            }}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
          />
          {busy === "loading" && <LoaderCircle className="absolute right-3.5 top-1/2 h-5 w-5 -translate-y-1/2 animate-spin text-muted" aria-hidden />}
          {enabled && open && suggestions.length > 0 && (
            <ul id={listId} role="listbox" className="absolute z-20 mt-1 w-full overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow-lift)] ring-1 ring-line">
              {suggestions.map((s, i) => (
                <li key={s.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                  className={cn("cursor-pointer px-4 py-2.5", i === active ? "bg-fixy-50" : "hover:bg-cream")}>
                  <span className="block font-semibold">{s.main}</span>
                  {s.secondary && <span className="block text-sm text-muted">{s.secondary}</span>}
                </li>
              ))}
              <li className="px-4 py-1.5 text-right text-[11px] text-muted" aria-hidden>con tecnología de Google</li>
            </ul>
          )}
        </div>
        {busy === "locating" && <p role="status" className="flex items-center gap-1.5 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />Buscando tu ubicación…</p>}
        {msg && (
          <p role="status" className={cn("flex items-start gap-1.5 text-sm", msg.tone === "warn" ? "text-warn" : msg.tone === "info" ? "rounded-xl bg-info-bg px-3 py-2 text-info" : "text-ok")}>
            {msg.tone === "warn" && <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}{msg.text}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${uid}-zone`} className="block text-[15px] font-semibold text-ink">Zona{required && <span className="text-danger" aria-hidden> *</span>}</label>
        {autoZone && <p className="text-sm text-muted">Detectada desde la dirección. Podés cambiarla.</p>}
        <select id={`${uid}-zone`} name="zoneId" value={v.zoneId} required={required} onChange={(e) => { update({ zoneId: e.target.value }); setAutoZone(false); setMsg(zones.find((z) => z.id === e.target.value)?.code === "otra-zona" ? { tone: "info", text: FEW_PROS_MESSAGE } : null); }} className={cn(control, "h-12")}>
          <option value="" disabled>Elegí la zona</option>
          {Object.entries(REGION).map(([r, label]) => (
            <optgroup key={r} label={label}>
              {zones.filter((z) => z.region === r).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <input type="hidden" name="lat" value={v.lat} />
      <input type="hidden" name="lng" value={v.lng} />
      <input type="hidden" name="placeId" value={v.placeId} />
      <input type="hidden" name="formattedAddress" value={v.formattedAddress} />
    </div>
  );
}
