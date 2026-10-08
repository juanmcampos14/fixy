/**
 * Asistente guiado por reglas (funciona sin servicios externos).
 * Sugiere categoría, detecta situaciones de riesgo y deriva casos ambiguos a revisión humana.
 * No emite diagnósticos, no inventa precios ni confirma disponibilidad.
 */

export type SafetyLevel = "none" | "caution" | "emergency";

export type TriageResult = {
  categorySlug: string | null;
  confidence: "high" | "medium" | "low";
  alternatives: string[];
  matched: string[];
  safety: { level: SafetyLevel; title: string; guidance: string[] } | null;
  suggestedTitle: string;
  suggestedUrgency: "flexible" | "normal" | "soon" | "urgent";
  needsReview: boolean;
  reviewReason: string | null;
  source: "rules" | "ai";
};

export const normalize = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Palabras clave por categoría con peso. Se comparan sobre texto normalizado (sin tildes). */
const KEYWORDS: Record<string, [string, number][]> = {
  electricidad: [
    ["enchufe", 3], ["tomacorriente", 3], ["toma corriente", 3], ["termica", 4], ["disyuntor", 4], ["corte de luz", 3],
    ["se corta la luz", 4], ["salta la", 3], ["cortocircuito", 4], ["cable", 2], ["luminaria", 3], ["lampara", 2],
    ["tablero electrico", 4], ["tablero", 2], ["electric", 3], ["llave de luz", 3], ["interruptor", 3], ["no hay luz", 3],
    ["ventilador de techo", 3], ["chispa", 2],
  ],
  plomeria: [
    ["canilla", 4], ["perdida de agua", 4], ["pierde agua", 4], ["gotea", 3], ["inodoro", 4], ["mochila", 3],
    ["deposito", 1], ["desague", 4], ["se tapo", 4], ["tapad", 3], ["desagot", 3], ["cañeria", 3], ["caneria", 3], ["sifon", 3],
    ["pileta", 2], ["bacha", 3], ["ducha", 2], ["griferia", 4], ["humedad", 1], ["tanque de agua", 4], ["bomba de agua", 4],
    ["agua", 1], ["filtracion", 2], ["cloaca", 4],
  ],
  gas: [
    ["gas", 4], ["calefon", 4], ["termotanque", 3], ["estufa", 3], ["hornalla", 3], ["cocina a gas", 4],
    ["piloto", 2], ["caldera", 3], ["matafuego", 1], ["artefacto a gas", 4],
  ],
  climatizacion: [
    ["aire acondicionado", 5], ["split", 4], ["no enfria", 4], ["no calienta", 2], ["climatizacion", 4],
    ["equipo de aire", 4], ["carga de gas del aire", 5], ["aire", 1], ["calefaccion", 2], ["frigorias", 4],
  ],
  electrodomesticos: [
    ["heladera", 4], ["lavarropas", 5], ["secarropas", 5], ["lavavajillas", 5], ["microondas", 4], ["horno electrico", 4],
    ["freezer", 4], ["electrodomestico", 4], ["no centrifuga", 4], ["no enfria la heladera", 5],
  ],
  cerrajeria: [
    ["cerradura", 5], ["llave", 2], ["me quede afuera", 5], ["cerrajero", 5], ["candado", 3], ["puerta trabada", 4],
    ["cambio de combinacion", 4], ["no abre la puerta", 4], ["perdi las llaves", 5],
  ],
  pintura: [["pintar", 5], ["pintura", 5], ["pintor", 5], ["mano de pintura", 5], ["empapelar", 3], ["descascarado", 3]],
  albanileria: [
    ["albanil", 5], ["revoque", 4], ["grieta", 3], ["rajadura", 3], ["azulejo", 3], ["ceramica", 3], ["contrapiso", 4],
    ["pared", 1], ["humedad en la pared", 4], ["mamposteria", 4], ["techo", 1], ["membrana", 3], ["goteras", 3],
  ],
  carpinteria: [
    ["carpintero", 5], ["mueble", 3], ["placard", 4], ["bisagra", 3], ["cajon", 3], ["puerta de madera", 4],
    ["madera", 2], ["armar mueble", 5], ["estante", 3], ["alacena", 3],
  ],
  limpieza: [["limpieza", 5], ["limpiar", 4], ["final de obra", 4], ["vidrios", 2], ["desinfeccion", 3], ["alfombra", 2]],
  informatica: [
    ["wifi", 5], ["internet", 4], ["router", 5], ["red", 2], ["computadora", 4], ["notebook", 4], ["impresora", 4],
    ["virus", 3], ["cableado de red", 5], ["servidor", 3], ["pc", 3], ["camaras de seguridad", 3],
  ],
  mantenimiento: [
    ["mantenimiento", 4], ["colgar", 3], ["cuadro", 2], ["cortina", 3], ["barral", 3], ["arreglos varios", 4],
    ["changas", 3], ["mosquitero", 3], ["perforar", 2], ["instalar estante", 3],
  ],
};

type SafetyRule = { pattern: RegExp; level: SafetyLevel; title: string; guidance: string[] };

/** Orientación breve ante riesgos. Sin instrucciones de reparación. */
const SAFETY_RULES: SafetyRule[] = [
  {
    pattern: /(olor|olorcito|huele|sale|perdida|escape|fuga)[a-z ]{0,20}gas|gas[a-z ]{0,20}(olor|huele|perdida|escape|fuga)/,
    level: "emergency",
    title: "Si sentís olor a gas, primero tu seguridad",
    guidance: [
      "No enciendas ni apagues luces ni aparatos eléctricos, y no uses fuego.",
      "Ventilá abriendo puertas y ventanas, y salí del lugar.",
      "Desde afuera, llamá al servicio de emergencias de tu distribuidora de gas o al 911.",
      "Cuando la situación esté controlada, podés pedir aquí un gasista matriculado.",
    ],
  },
  {
    pattern: /monoxido|me mareo|nos mareamos|dolor de cabeza[a-z ]{0,30}(estufa|calefon|brasero)|llama amarilla/,
    level: "emergency",
    title: "Posible riesgo de monóxido de carbono",
    guidance: [
      "Apagá el artefacto si podés hacerlo sin riesgo, ventilá y salí al aire libre.",
      "Si alguien tiene síntomas, llamá al 911 o al servicio de emergencias médicas.",
      "No vuelvas a usar el artefacto hasta que lo revise un gasista matriculado.",
    ],
  },
  {
    pattern: /(humo|olor a quemado|se prendio fuego|fuego|incendio)/,
    level: "emergency",
    title: "Si hay humo o fuego",
    guidance: [
      "Alejate del lugar y llamá a bomberos (100) o al 911.",
      "No intentes reparar la instalación.",
    ],
  },
  {
    pattern: /(chispa|chispazo|electrocut|patea|me dio corriente|da corriente|cable pelado)/,
    level: "caution",
    title: "Cuidado con la instalación eléctrica",
    guidance: [
      "No toques cables, enchufes ni artefactos afectados.",
      "Si podés hacerlo sin riesgo, bajá la llave térmica general.",
      "Si alguien recibió una descarga, llamá al 911.",
    ],
  },
  {
    pattern: /(inund|se llena de agua|(agua|gotea|goteo|filtra|moja)[a-z ]{0,40}(enchufe|tablero|cable|lampara|luz|luces|toma)|(enchufe|tablero|lampara|luz|toma)[a-z ]{0,30}(agua|gotea|mojad))/,
    level: "caution",
    title: "Agua y electricidad no se mezclan",
    guidance: [
      "Si el agua alcanza enchufes, cables o el tablero, no los toques.",
      "Si podés hacerlo sin riesgo, cerrá la llave de paso de agua y cortá la luz desde la térmica general.",
    ],
  },
];

const URGENT_WORDS = ["urgente", "ya mismo", "ahora", "emergencia", "lo antes posible", "inunda", "me quede afuera", "no tengo luz", "no hay luz"];
const SOON_WORDS = ["hoy", "manana", "esta semana", "pronto", "rapido"];

export function triageByRules(text: string, explicitCategory?: string | null): TriageResult {
  const t = ` ${normalize(text)} `;
  const scores: Record<string, number> = {};
  const matched: string[] = [];
  for (const [cat, words] of Object.entries(KEYWORDS)) {
    for (const [w, weight] of words) {
      if (t.includes(` ${w}`)) {
        scores[cat] = (scores[cat] ?? 0) + weight;
        matched.push(w);
      }
    }
  }
  // "carga de gas del aire" no es gas domiciliario
  if (scores.climatizacion && scores.gas && /aire|split/.test(t)) scores.gas = Math.max(0, scores.gas - 4);

  const ranked = Object.entries(scores).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
  let categorySlug: string | null = explicitCategory ?? ranked[0]?.[0] ?? null;
  let confidence: TriageResult["confidence"] = "low";
  if (explicitCategory) confidence = "high";
  else if (ranked.length) {
    const [top, second] = ranked;
    const margin = top[1] - (second?.[1] ?? 0);
    confidence = top[1] >= 4 && margin >= 3 ? "high" : top[1] >= 3 ? "medium" : "low";
  }
  if (confidence === "low" && !explicitCategory) categorySlug = null;

  let safety: TriageResult["safety"] = null;
  for (const r of SAFETY_RULES) {
    if (r.pattern.test(t)) {
      safety = { level: r.level, title: r.title, guidance: r.guidance };
      break;
    }
  }

  const suggestedUrgency = safety?.level === "emergency" || URGENT_WORDS.some((w) => t.includes(w))
    ? "urgent"
    : SOON_WORDS.some((w) => t.includes(` ${w}`))
      ? "soon"
      : "normal";

  const needsReview = !categorySlug || categorySlug === "otro" || (confidence === "low");
  const reviewReason = !categorySlug
    ? "No pudimos identificar el tipo de profesional. Lo revisa una persona del equipo."
    : categorySlug === "otro"
      ? "Pedido fuera del catálogo: lo revisa una persona del equipo."
      : null;

  return {
    categorySlug,
    confidence,
    alternatives: ranked.slice(categorySlug ? 1 : 0, 3).map(([c]) => c).filter((c) => c !== categorySlug),
    matched: [...new Set(matched)].slice(0, 8),
    safety,
    suggestedTitle: suggestTitle(text),
    suggestedUrgency,
    needsReview,
    reviewReason,
    source: "rules",
  };
}

export function suggestTitle(text: string): string {
  const firstSentence = text.trim().split(/[.\n!?]/)[0]?.trim() ?? "";
  const base = firstSentence.length >= 3 ? firstSentence : text.trim();
  const clipped = base.length > 80 ? `${base.slice(0, 77).trimEnd()}…` : base;
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}
