/**
 * Asigna una zona de cobertura a partir de los componentes de dirección de Google (Geocoding / Places).
 * CABA: por barrio (sublocality/neighborhood). GBA: por partido (administrative_area_level_2), y si no, por localidad.
 * Función pura: se usa en el navegador y en el servidor.
 */
export type AddressComponent = { long_name?: string; longText?: string; short_name?: string; shortText?: string; types: string[] };
export type MatchZone = { id: string; code: string; region: string; match_names: string[]; province?: string | null; catch_all?: boolean };

export const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\b(partido|de|del|la ciudad|municipio)\b/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

const text = (c: AddressComponent) => c.long_name ?? c.longText ?? "";

export function isCaba(components: AddressComponent[]) {
  return components.some((c) => c.types.includes("administrative_area_level_1") && /ciudad autonoma|capital federal|caba/.test(norm(text(c)) + " " + text(c).toLowerCase()));
}

const AMBA = (z: MatchZone) => z.region === "CABA" || z.region.startsWith("GBA");
const adm1 = (components: AddressComponent[]) => norm(components.filter((c) => c.types.includes("administrative_area_level_1")).map(text).join(" "));

/**
 * Zona de una dirección. CABA: por barrio. Resto del país: dentro de la provincia, por partido/departamento o localidad;
 * si no coincide con ninguna ciudad listada, la zona "Resto de …" de esa provincia. Sin provincia reconocida, null.
 */
export function matchZone(components: AddressComponent[], zones: MatchZone[]): MatchZone | null {
  const caba = isCaba(components);
  const province = adm1(components);
  // Con provincias cargadas, la búsqueda se acota a la provincia de la dirección: hay localidades homónimas en todo el país.
  const inProvince = !caba && province ? zones.filter((z) => z.province && province.includes(norm(z.province))) : [];
  const pool = caba
    ? zones.filter((z) => z.region === "CABA")
    : inProvince.length
      ? inProvince.filter((z) => !z.catch_all)
      : zones.filter((z) => z.region !== "CABA" && !z.catch_all && (!z.province || !province));
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
  return inProvince.find((z) => z.catch_all) ?? null;
}

/** Nombres demasiado comunes para reconocer una zona en un texto suelto si no viene la provincia. */
const GENERIC = new Set(["capital", "la capital", "centro", "colon", "merlo", "junin", "rawson", "rivadavia", "san martin", "san lorenzo", "san jose", "san justo", "san fernando", "santa maria", "santa lucia", "banda", "libertad", "union", "florida", "victoria"]);

/**
 * Zona a partir de un texto escrito por la persona ("Morón", "Córdoba capital", "Godoy Cruz, Mendoza").
 * Primero las zonas de CABA y GBA (comportamiento histórico); después, si nombra una provincia, sus ciudades o su "Resto de …";
 * por último, una ciudad del país con nombre inequívoco.
 */
export function guessZoneFromText<Z extends MatchZone>(raw: string, zones: Z[]): Z | null {
  const t = ` ${norm(raw)} `;
  const has = (name: string) => t.includes(` ${norm(name)} `);
  const amba = zones.find((z) => AMBA(z) && z.match_names.some((n) => !GENERIC.has(norm(n)) && t.includes(norm(n))));
  if (amba) return amba;
  const provinces = [...new Set(zones.map((z) => z.province).filter((p): p is string => !!p))].sort((a, b) => b.length - a.length);
  // "Córdoba" o "Santa Fe" son provincia y ciudad a la vez: se busca la ciudad dentro de la provincia nombrada.
  const province = provinces.find((p) => has(p));
  if (province) {
    const mine = zones.filter((z) => z.province === province);
    return mine.find((z) => !z.catch_all && z.match_names.some((n) => norm(n) !== norm(province) && has(n)))
      ?? mine.find((z) => !z.catch_all && /\b(capital|ciudad|centro)\b/.test(t) && z.match_names.some((n) => norm(n) === "capital" || norm(n) === norm(province)))
      ?? mine.find((z) => !z.catch_all && !AMBA(z) && z.match_names.some((n) => norm(n) === norm(province)))
      ?? mine.find((z) => z.catch_all) ?? null;
  }
  return zones.find((z) => !z.catch_all && !AMBA(z) && z.match_names.some((n) => !GENERIC.has(norm(n)) && norm(n).length >= 5 && has(n))) ?? null;
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
