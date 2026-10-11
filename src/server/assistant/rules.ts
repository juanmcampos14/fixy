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
    ["piloto", 2], ["caldera", 2], ["matafuego", 1], ["artefacto a gas", 4],
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
    ["pared", 1], ["humedad en la pared", 4], ["mamposteria", 4], ["levantar una pared", 4], ["medianera", 3],
  ],
  carpinteria: [
    ["carpintero", 5], ["mueble", 3], ["placard", 4], ["bisagra", 3], ["cajon", 3], ["puerta de madera", 4],
    ["madera", 2], ["armar mueble", 5], ["estante", 3], ["alacena", 3],
  ],
  limpieza: [["limpieza", 5], ["limpiar", 4], ["final de obra", 4], ["limpieza de vidrios", 4], ["alfombra", 2]],
  informatica: [
    ["wifi", 5], ["internet", 4], ["router", 5], ["red", 2], ["computadora", 4], ["notebook", 4], ["impresora", 4],
    ["virus", 3], ["cableado de red", 5], ["servidor", 3], ["pc", 3],
  ],
  jardineria: [
    ["jardin", 4], ["jardinero", 5], ["paisaj", 5], ["cesped", 5], ["pasto", 4], ["poda", 4], ["podar", 4], ["cerco vivo", 4], ["ligustr", 4],
    ["plantas", 3], ["riego", 4], ["aspersor", 4], ["desmalez", 4], ["parquiz", 5], ["arbol", 3], ["cantero", 3], ["huerta", 3],
  ],
  piletas: [
    ["piletero", 5], ["piscina", 5], ["pileta de natacion", 5], ["pileta", 2], ["agua verde", 5], ["cloro", 4], ["filtro de la pileta", 5],
    ["bomba de la pileta", 5], ["pintar la pileta", 5], ["barrefondo", 5], ["climatizar la pileta", 4], ["jacuzzi", 4], ["hidromasaje", 3],
  ],
  fumigacion: [
    ["fumig", 5], ["plaga", 5], ["cucaracha", 5], ["rata", 4], ["ratas", 5], ["raton", 5], ["roedor", 5], ["mosquito", 4], ["hormiga", 4], ["chinche", 5],
    ["pulga", 4], ["termita", 5], ["alacran", 5], ["murcielago", 5], ["paloma", 3], ["desinfeccion", 4], ["desratiz", 5], ["desinsect", 5],
    ["limpieza de tanque", 5], ["limpiar el tanque", 5], ["avispa", 4], ["panal", 4],
  ],
  volquetes: [
    ["volquete", 5], ["escombro", 5], ["contenedor", 3], ["retiro de muebles", 4], ["retirar muebles", 4], ["sacar escombros", 5],
    ["retiro de residuos", 4], ["cascote", 4], ["retiro de poda", 5], ["vaciar", 2], ["vaciado", 3],
  ],
  mudanzas: [["mudanza", 5], ["mudar", 4], ["flete", 5], ["fletero", 5], ["traslado de muebles", 5], ["embalaje", 4], ["guardamuebles", 5], ["mudarme", 5]],
  reformas: [
    ["reforma", 5], ["remodel", 5], ["refaccion", 5], ["ampliacion", 5], ["ampliar la casa", 5], ["construir", 4], ["construccion", 3], ["obra completa", 5],
    ["hacer el bano", 4], ["bano nuevo", 4], ["cocina nueva", 4], ["reciclar", 3], ["llave en mano", 5], ["maestro mayor", 4], ["constructora", 5],
  ],
  arquitectura: [
    ["arquitect", 5], ["ingenier", 4], ["planos", 4], ["plano", 3], ["direccion de obra", 5], ["habilitacion", 4], ["regulariz", 4], ["calculo estructural", 5],
    ["agrimensor", 5], ["mensura", 5], ["subdivision", 4], ["informe tecnico", 4], ["proyecto de obra", 5], ["anteproyecto", 5],
  ],
  decoracion: [
    ["decorador", 5], ["decoracion", 5], ["decorar", 4], ["interiorismo", 5], ["interiorista", 5], ["diseno de interiores", 5], ["ambientacion", 4],
    ["home staging", 5], ["feng shui", 4], ["asesoramiento de colores", 4], ["elegir muebles", 3],
  ],
  techos: [
    ["techo", 3], ["techista", 5], ["gotera", 5], ["membrana", 5], ["impermeabiliz", 5], ["zingueria", 5], ["canaleta", 4], ["tejas", 4], ["teja", 3],
    ["terraza", 2], ["filtracion del techo", 5], ["se llueve", 5], ["chapa", 3], ["losa", 2],
  ],
  pisos: [
    ["porcelanato", 5], ["colocar ceramic", 5], ["colocacion de ceramic", 5], ["piso flotante", 5], ["vinilico", 4], ["pulido", 4], ["plastificado", 5],
    ["plastificar", 5], ["parquet", 5], ["microcemento", 5], ["colocador", 4], ["cambiar el piso", 5], ["baldosa", 4], ["zocalo", 3], ["pastina", 3],
  ],
  durlock: [["durlock", 5], ["cielorraso", 5], ["construccion en seco", 5], ["placa de yeso", 5], ["tabique", 4], ["yesero", 4], ["yeso", 3], ["steel frame", 5]],
  herreria: [
    ["herrero", 5], ["herreria", 5], ["reja", 5], ["porton", 5], ["soldar", 4], ["soldadura", 4], ["baranda", 4], ["motor del porton", 5],
    ["porton automatico", 5], ["escalera de hierro", 5], ["estructura metalica", 5], ["hierro", 2],
  ],
  vidrieria: [
    ["vidrio", 5], ["vidriero", 5], ["espejo", 4], ["mampara", 5], ["ventana", 3], ["ventanal", 4], ["abertura", 4], ["aluminio", 3], ["pvc", 3],
    ["dvh", 5], ["mosquitero", 3], ["cerramiento", 4], ["blindex", 5], ["se rompio el vidrio", 5],
  ],
  marmoleria: [["marmol", 5], ["mesada", 5], ["granito", 5], ["cuarzo", 4], ["silestone", 5], ["marmolero", 5], ["marmoleria", 5]],
  seguridad: [
    ["alarma", 5], ["camaras de seguridad", 5], ["camara de seguridad", 5], ["camaras", 3], ["cctv", 5], ["portero electrico", 5], ["portero", 3],
    ["visor", 3], ["cerco electrico", 5], ["control de acceso", 5], ["videoportero", 5], ["sensor de movimiento", 4],
  ],
  "energia-solar": [["panel solar", 5], ["paneles solares", 5], ["energia solar", 5], ["termotanque solar", 6], ["fotovoltaic", 5], ["inversor solar", 5], ["solar", 3]],
  cortinas: [
    ["cortina", 4], ["persiana", 5], ["roller", 5], ["blackout", 5], ["toldo", 5], ["cortina de enrollar", 5], ["cinta de la persiana", 5],
    ["correa de la persiana", 5], ["motorizar", 3],
  ],
  tapiceria: [["tapicer", 5], ["tapizar", 5], ["retapizar", 5], ["sillon", 4], ["restaurar", 3], ["restauracion de muebles", 5], ["laquear", 5], ["lustrar", 4], ["esterillado", 5]],
  "tv-audio": [
    ["televisor", 5], ["tele", 3], ["colgar el tv", 5], ["colgar la tele", 5], ["soporte de tv", 5], ["smart tv", 5], ["parlante", 4], ["equipo de audio", 5],
    ["proyector", 5], ["home theater", 5], ["antena", 4], ["barra de sonido", 5],
  ],
  domotica: [["domotica", 5], ["casa inteligente", 5], ["hogar inteligente", 5], ["smart home", 5], ["cerradura inteligente", 5], ["luces inteligentes", 5], ["alexa", 4], ["google home", 4]],
  calefaccion: [
    ["calefaccion", 4], ["caldera", 4], ["radiador", 5], ["losa radiante", 5], ["piso radiante", 5], ["calefaccion central", 5], ["purgar", 4], ["toallero", 3],
  ],
  ascensores: [["ascensor", 5], ["montacargas", 5], ["elevador", 4], ["salvaescaleras", 5]],
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
  // Palabras compartidas: gana el rubro específico.
  if (scores["energia-solar"] && scores.gas) scores.gas = Math.max(0, scores.gas - 4); // termotanque solar
  if (scores.piletas && scores.plomeria && /piscina|natacion|piletero|agua verde|cloro|barrefondo/.test(t)) scores.plomeria = Math.max(0, scores.plomeria - 3);
  if (scores.plomeria && scores.piletas && /pileta de (la )?(cocina|lavadero|bano)|bacha|se tapo/.test(t)) scores.piletas = 0;
  if (scores.fumigacion && /limpi\w+ (el |de |del )?tanque/.test(t)) {
    // La limpieza de tanques la hacen las empresas de control de plagas, no plomería ni limpieza general.
    scores.plomeria = Math.max(0, (scores.plomeria ?? 0) - 6);
    scores.limpieza = Math.max(0, (scores.limpieza ?? 0) - 5);
  }
  if (scores.calefaccion && scores.climatizacion) scores.climatizacion = Math.max(0, scores.climatizacion - 2);
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
