"use client";

import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { fixy } from "@/components/fixy3d/events";

/** Pistas para que Fixy reconozca el rubro mientras la persona escribe (la clasificación real la hace el servidor). */
const HINTS: { re: RegExp; name: string; safety?: string }[] = [
  { re: /olor a gas|huele a gas|perdida de gas|pérdida de gas/i, name: "Gas", safety: "¡Olor a gas! Cerrá la llave, ventilá y no prendas nada. Después lo vemos." },
  { re: /\b(gas|calef[oó]n|estufa|termotanque a gas|anafe)\b/i, name: "Gas" },
  { re: /\b(canilla|agua|p[ée]rdida|inodoro|ca[ñn]er[ií]a|gotea|desag[uü]e|tanque|destap|cloaca|ducha|mochila)\b/i, name: "Plomería" },
  { re: /\b(luz|t[ée]rmica|enchufe|tomacorriente|corto|cable|l[aá]mpara|disyuntor|electric)\w*/i, name: "Electricidad" },
  { re: /\b(aire|split|no enfr[ií]a|calefacci[oó]n|climatiz)\w*/i, name: "Aire acondicionado" },
  { re: /\b(heladera|lavarropas|horno|microondas|secarropas|lavavajillas)\b/i, name: "Electrodomésticos" },
  { re: /\b(llave|cerradura|puerta trabada|me qued[eé] afuera)\b/i, name: "Cerrajería" },
  { re: /\b(pint|humedad|mancha)\w*/i, name: "Pintura" },
  { re: /\b(pared|revoque|azulejo|cer[aá]mica|grieta|rajadura|obra|ampliaci[oó]n)\w*/i, name: "Albañilería" },
  { re: /\b(mueble|placard|madera|bisagra|puerta de madera)\b/i, name: "Carpintería" },
  { re: /\b(wifi|internet|router|red|computadora|c[aá]maras?)\b/i, name: "Informática y redes" },
];

const QUICK = ["Gotea la canilla de la cocina", "Saltó la térmica y no vuelve", "El aire no enfría", "Me quedé afuera de casa", "Hay humedad en la pared"];

export function HeroAsk() {
  const [q, setQ] = useState("");
  const last = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function react(text: string) {
    if (timer.current) clearTimeout(timer.current);
    fixy({ type: "act", action: "listen", ms: 1600 });
    timer.current = setTimeout(() => {
      const hit = HINTS.find((h) => h.re.test(text));
      if (!hit || hit.name === last.current) return;
      last.current = hit.name;
      if (hit.safety) {
        fixy({ type: "act", action: "think", ms: 3500 });
        fixy({ type: "say", text: hit.safety, ms: 5000 });
      } else {
        fixy({ type: "act", action: "celebrate", ms: 1400 });
        fixy({ type: "say", text: `¡Eso es ${hit.name}! Tengo gente para eso.`, ms: 3200 });
      }
    }, 450);
  }

  return (
    <div className="mt-7">
      <form action="/solicitar" method="get" className="rounded-[28px] bg-white p-2 shadow-[var(--shadow-lift)] ring-1 ring-line focus-within:ring-2 focus-within:ring-fixy-600">
        <label htmlFor="hero-q" className="sr-only">¿Qué necesitás resolver hoy?</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="hero-q" name="q" value={q} autoComplete="off" maxLength={300}
            onChange={(e) => { setQ(e.target.value); react(e.target.value); }}
            onFocus={() => fixy({ type: "say", text: "Te escucho. Contámelo como te salga.", ms: 2600 })}
            placeholder="¿Qué se rompió? Ej.: pierde agua la canilla"
            className="h-14 min-w-0 flex-1 rounded-[22px] px-4 text-[17px] placeholder:text-[#7d8f93] focus:outline-none"
          />
          <button className="inline-flex h-14 items-center justify-center gap-2 rounded-[22px] bg-fixy-700 px-6 font-semibold text-white transition hover:bg-fixy-800 active:scale-[0.98]">
            Resolverlo <ArrowRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </form>
      <ul className="mt-4 flex flex-wrap gap-2" aria-label="Ejemplos">
        {QUICK.map((t) => (
          <li key={t}>
            <button
              type="button"
              onClick={() => { setQ(t); react(t); document.getElementById("hero-q")?.focus(); }}
              className="rounded-full bg-white/80 px-3.5 py-1.5 text-sm font-medium text-ink-2 ring-1 ring-line transition hover:-translate-y-0.5 hover:bg-white hover:ring-fixy-300"
            >
              {t}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
