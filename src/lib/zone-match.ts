/**
 * Asigna una zona de cobertura a partir de los componentes de dirección de Google (Geocoding / Places).
 * CABA: por barrio (sublocality/neighborhood). GBA: por partido (administrative_area_level_2), y si no, por localidad.
 * Función pura: se usa en el navegador y en el servidor.
 */
export type AddressComponent = { long_name?: string; longText?: string; short_name?: string; shortText?: string; types: string[] };
export type MatchZone = { id: string; code: string; region: string; match_names: string[] };

export const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(partido|de|del|la ciudad|municipio)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const text = (c: AddressComponent) => c.long_name ?? c.longText ?? "";

export function isCaba(components: AddressComponent[]) {
  return components.some((c) => c.types.includes("administrative_area_level_1") && /ciudad autonoma|capital federal|caba/.test(norm(text(c)) + " " + text(c).toLowerCase()));
}

export function matchZone(components: AddressComponent[], zones: MatchZone[]): MatchZone | null {
  const caba = isCaba(components);
  const pool = zones.filter((z) => (caba ? z.region === "CABA" : z.region !== "CABA"));
  const byTypes = (types: string[]) => components.filter((c) => types.some((t) => c.types.includes(t))).map((c) => norm(text(c)));
  const order = caba
    ? [byTypes(["neighborhood", "sublocality_level_1", "sublocality"]), byTypes(["locality"])]
    : [byTypes(["administrative_area_level_2"]), byTypes(["locality"]), byTypes(["sublocality_level_1", "sublocality", "neighborhood"])];
  for (const names of order) {
    for (const n of names) {
      const z = pool.find((zz) => zz.match_names.some((m) => norm(m) === n));
      if (z) return z;
    }
  }
  return null;
}

/** Nombres (normalizados) por zona. Fuente única para el seed; la migración 0013 los replica para bases existentes. */
export const ZONE_MATCH_NAMES: Record<string, string[]> = {
  "caba-palermo": ["palermo", "colegiales", "chacarita", "villa crespo"],
  "caba-belgrano": ["belgrano", "nunez", "coghlan"],
  "caba-recoleta": ["recoleta", "retiro"],
  "caba-centro": ["san nicolas", "monserrat", "montserrat", "balvanera", "puerto madero", "san cristobal"],
  "caba-caballito": ["caballito", "almagro", "boedo", "parque chacabuco"],
  "caba-urquiza": ["villa urquiza", "saavedra", "villa pueyrredon", "villa ortuzar", "parque chas", "agronomia", "villa devoto", "villa del parque", "villa general mitre", "villa santa rita", "la paternal", "paternal"],
  "caba-flores": ["flores", "floresta", "velez sarsfield", "villa luro", "liniers", "mataderos", "parque avellaneda", "villa real", "monte castro", "versalles", "villa lugano", "villa riachuelo", "villa soldati"],
  "caba-sur": ["san telmo", "barracas", "la boca", "boca", "constitucion", "parque patricios", "nueva pompeya"],
  "gba-vicente-lopez": ["vicente lopez", "olivos", "florida", "florida oeste", "munro", "la lucila", "villa martelli", "carapachay", "villa adelina"],
  "gba-san-isidro": ["san isidro", "martinez", "acassuso", "beccar", "boulogne", "boulogne sur mer", "villa adelina"],
  "gba-san-fernando": ["san fernando", "victoria", "virreyes", "islas san fernando"],
  "gba-tigre": ["tigre", "don torcuato", "general pacheco", "benavidez", "nordelta", "el talar", "rincon de milberg", "troncos del talar", "ricardo rojas", "dique lujan", "villa la nueva"],
  "gba-escobar": ["escobar", "belen escobar", "ingeniero maschwitz", "maschwitz", "garin", "matheu", "maquinista savio", "loma verde", "puertos"],
  "gba-pilar": ["pilar", "del viso", "presidente derqui", "villa rosa", "manzanares", "fatima", "la lonja", "manuel alberti", "villa astolfi", "lagomarsino", "zelaya", "pilar centro"],
  "gba-moron": ["moron", "castelar", "haedo", "el palomar", "villa sarmiento"],
  "gba-la-matanza": ["la matanza", "san justo", "ramos mejia", "isidro casanova", "gonzalez catan", "lomas del mirador", "villa luzuriaga", "tapiales", "la tablada", "gregorio de laferrere", "ciudad evita", "rafael castillo"],
  "gba-avellaneda": ["avellaneda", "wilde", "sarandi", "dock sud", "villa dominico", "gerli", "pineyro"],
  "gba-lanus": ["lanus", "remedios de escalada", "monte chingolo", "valentin alsina", "gerli"],
  "gba-lomas": ["lomas de zamora", "banfield", "temperley", "turdera", "llavallol", "villa fiorito", "ingeniero budge"],
  "gba-quilmes": ["quilmes", "bernal", "ezpeleta", "don bosco", "san francisco solano"],
};
