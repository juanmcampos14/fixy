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
  { re: /\b(cucaracha|rata|ratas|plaga|fumig|hormiga|mosquito)\w*/i, name: "Fumigación" },
  { re: /\b(piscina|piletero|agua verde|cloro)\b/i, name: "Piletas" },
  { re: /\b(jard[ií]n|pasto|c[eé]sped|poda|paisaj)\w*/i, name: "Jardinería" },
  { re: /\b(volquete|escombro)\w*/i, name: "Volquetes" },
  { re: /\b(mudanza|flete)\w*/i, name: "Mudanzas y fletes" },
  { re: /\b(gotera|membrana|techo)\w*/i, name: "Techos" },
  { re: /\b(arquitect|planos|reforma|remodel)\w*/i, name: "Obras y proyectos" },
  { re: /\b(decorad|decoraci|interioris)\w*/i, name: "Decoración" },
  { re: /\b(alarma|c[aá]maras? de seguridad|portero)\b/i, name: "Alarmas y cámaras" },
  { re: /\b(vidrio|espejo|mampara|reja|port[oó]n)\w*/i, name: "Vidriería y herrería" },
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
    <div className="mt-10">
      {/* Entrada en píldora con la acción principal pegada (única acción en cobalto de la página) */}
      <form action="/solicitar" method="get" className="mx-auto flex max-w-[560px] flex-col gap-3 sm:flex-row sm:gap-0">
        <label htmlFor="hero-q" className="sr-only">¿Qué necesitás resolver?</label>
        <input
          id="hero-q" name="q" value={q} autoComplete="off" maxLength={300}
          onChange={(e) => { setQ(e.target.value); react(e.target.value); }}
          onFocus={() => fixy({ type: "say", text: "Te escucho. Contámelo como te salga.", ms: 2600 })}
          placeholder="¿Qué se rompió? Ej.: pierde agua la canilla"
          className="h-[52px] w-full min-w-0 shrink-0 rounded-[32px] border border-ivory bg-transparent px-5 text-base text-ivory placeholder:text-ash/80 sm:w-auto sm:flex-1 sm:shrink sm:rounded-r-none sm:border-r-0"
        />
        <button className="m-btn m-btn-primary h-[52px] shrink-0 sm:rounded-l-none">
          Resolverlo <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </form>
      <ul className="mx-auto mt-5 flex max-w-[640px] flex-wrap justify-center gap-2" aria-label="Ejemplos">
        {QUICK.map((t) => (
          <li key={t}>
            <button
              type="button"
              onClick={() => { setQ(t); react(t); document.getElementById("hero-q")?.focus(); }}
              className="min-h-9 cursor-pointer rounded-[40px] bg-obsidian px-4 text-sm text-ash transition-colors hover:text-ivory"
            >
              {t}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
