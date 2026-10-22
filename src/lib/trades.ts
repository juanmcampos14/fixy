/**
 * Oficios tal como los dice la gente → rubros del catálogo. Lo usan el selector de rubros (web) y el alta por
 * WhatsApp, así "plomero", "gasista matriculado" o "hago aires" siempre caen en el rubro correcto.
 * Puro (sin servidor): se puede usar en el navegador.
 */
export const normalizeTrade = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export const TRADE_WORDS: [RegExp, string][] = [
  [/\bplomer|\bsanitarist|\bdestapacion|\bcanilla|\bcaneria/, "plomeria"], [/\belectricist|\belectricidad|\belectric/, "electricidad"], [/\bgasist|\bgas\b/, "gas"],
  [/\baires?\b|\bsplit|\brefrigeracion|\bclimatiza|\baire acondicionado/, "climatizacion"], [/\bheladera|\blavarropa|\belectrodomestic|\bservice\b/, "electrodomesticos"],
  [/\bcerrajer|\bllaves?\b|\bcerradura/, "cerrajeria"], [/\bpintor|\bpintura|\bpinto\b/, "pintura"], [/\balbanil|\balbanileria|\bmamposter/, "albanileria"],
  [/\bcarpinter|\bmueble/, "carpinteria"], [/\blimpieza|\blimpio\b/, "limpieza"], [/\binformatic|\bcomputadora|\bredes\b|\bwifi|\bpc\b/, "informatica"],
  [/\bjardiner|\bpaisajis|\bparquista|\bcorto (el )?pasto|\bpoda|\bjardin/, "jardineria"], [/\bpileter|\bpiscin|\bpiletas?\b/, "piletas"],
  [/\bfumig|\bplagas|\bdesinfecc|\bcucarach|\bratas?\b/, "fumigacion"], [/\bvolquete|\bescombro/, "volquetes"], [/\bflete|\bmudanza/, "mudanzas"],
  [/\bconstruc|\breforma|\bobras?\b|\bmaestro mayor/, "reformas"], [/\barquitect|\bingenier/, "arquitectura"], [/\bdecorad|\binterioris/, "decoracion"],
  [/\btechist|\btechos?\b|\bmembrana|\bzinguer|\bgoteras?\b/, "techos"], [/\bpisos?\b|\bceramic|\bporcelanato|\bcolocador|\bparquet/, "pisos"],
  [/\bdurlock|\byeser|\bcielorraso/, "durlock"], [/\bherrer|\bsoldad|\bporton|\brejas?\b/, "herreria"], [/\bvidrier|\bvidrios?\b|\baberturas?\b|\baluminio/, "vidrieria"],
  [/\bmarmol|\bmesadas?\b|\bgranito/, "marmoleria"], [/\balarma|\bcamaras?\b|\bportero/, "seguridad"], [/\bsolar|\bpaneles/, "energia-solar"],
  [/\bcortina|\bpersiana|\btoldo/, "cortinas"], [/\btapicer/, "tapiceria"], [/\btelevisor|\btv\b|\baudio\b/, "tv-audio"], [/\bdomotic|\bcasa inteligente/, "domotica"],
  [/\bcalefacc|\bcaldera|\bradiador|\bestufa/, "calefaccion"], [/\bascensor|\bmontacarga/, "ascensores"],
  [/\bmantenimiento|\bchangas|\barreglos varios|\bde todo|\bmultioficio|\bhandyman|\bmanitas/, "mantenimiento"],
];

/** Rubros que se reconocen en un texto ("soy plomero y gasista"). En el orden en que aparecen. */
export function tradeSlugsFromText(raw: string): string[] {
  const t = ` ${normalizeTrade(raw)} `;
  const hits = TRADE_WORDS.map(([re, slug]) => ({ slug, at: t.search(re) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
  return [...new Set(hits.map((h) => h.slug))];
}

/** Cómo se llama a quien hace cada oficio (para buscar y mostrar "Plomero/a · Plomería"). */
export const TRADE_PERSON: Record<string, string> = {
  plomeria: "Plomero/a", electricidad: "Electricista", gas: "Gasista", climatizacion: "Técnico/a de aires", electrodomesticos: "Técnico/a de heladeras",
  cerrajeria: "Cerrajero/a", pintura: "Pintor/a", albanileria: "Albañil", carpinteria: "Carpintero/a", limpieza: "Limpieza", informatica: "Técnico/a en informática",
  jardineria: "Jardinero/a", piletas: "Piletero/a", fumigacion: "Fumigador/a", volquetes: "Volquetes", mudanzas: "Fletes y mudanzas", reformas: "Constructor/a",
  arquitectura: "Arquitecto/a", decoracion: "Decorador/a", techos: "Techista", pisos: "Colocador/a de pisos", durlock: "Durlero/a", herreria: "Herrero/a",
  vidrieria: "Vidriero/a", marmoleria: "Marmolero/a", seguridad: "Alarmas y cámaras", "energia-solar": "Instalador/a solar", cortinas: "Cortinas y toldos",
  tapiceria: "Tapicero/a", "tv-audio": "Técnico/a de TV y audio", domotica: "Domótica", calefaccion: "Calefaccionista", ascensores: "Ascensorista", mantenimiento: "Arreglos generales",
};

/** Los oficios más pedidos: se muestran primero, sin buscar. */
export const POPULAR_TRADES = ["electricidad", "plomeria", "gas", "pintura", "albanileria", "climatizacion", "cerrajeria", "carpinteria", "herreria", "jardineria", "electrodomesticos", "mantenimiento"];

/** ¿El rubro coincide con lo que se busca? Por nombre del rubro, por cómo se llama al que lo hace o por sinónimos. */
export function tradeMatches(cat: { slug: string; name: string }, query: string): boolean {
  const q = normalizeTrade(query);
  if (!q) return true;
  if (normalizeTrade(cat.name).includes(q) || normalizeTrade(TRADE_PERSON[cat.slug] ?? "").includes(q)) return true;
  return q.length >= 3 && tradeSlugsFromText(q).includes(cat.slug);
}
