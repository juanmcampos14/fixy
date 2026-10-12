/**
 * Zonas fuera de las originales de CABA y GBA: partidos del conurbano que faltaban, principales ciudades del país
 * y una zona "Resto de …" por provincia (comodín: recibe lo que no cae en una ciudad listada).
 * `names`: localidades y departamentos tal como los devuelve Google (se comparan sin tildes ni mayúsculas, dentro de la provincia).
 * `at`: centro aproximado, para ubicar por coordenadas cuando no hay geocodificación (ubicación de WhatsApp).
 */
export type NationalZone = { code: string; name: string; region: string; province: string; names: string[]; catchAll?: boolean; at?: [number, number] };

const BA = "Buenos Aires";
const city = (code: string, name: string, region: string, province: string, names: string[], at?: [number, number]): NationalZone => ({ code, name, region, province, names, at });
const rest = (code: string, province: string, region: string): NationalZone => ({ code, name: `Resto de ${province}`, region, province, names: [], catchAll: true });

export const NATIONAL_ZONES: NationalZone[] = [
  // ── Conurbano que faltaba ──
  city("gba-san-martin", "San Martín", "GBA_NORTE", BA, ["general san martin", "san martin", "villa ballester", "jose leon suarez", "san andres", "villa maipu", "villa lynch"], [-34.575, -58.537]),
  city("gba-tres-de-febrero", "Tres de Febrero", "GBA_NORTE", BA, ["tres de febrero", "caseros", "ciudadela", "santos lugares", "saenz pena", "martin coronado", "villa bosch", "el palomar norte", "loma hermosa"], [-34.605, -58.563]),
  city("gba-san-miguel", "San Miguel / José C. Paz", "GBA_NORTE", BA, ["san miguel", "bella vista", "muniz", "jose c paz", "jose clemente paz"], [-34.543, -58.712]),
  city("gba-malvinas", "Malvinas Argentinas", "GBA_NORTE", BA, ["malvinas argentinas", "los polvorines", "grand bourg", "tortuguitas", "pablo nogues", "villa de mayo"], [-34.49, -58.7]),
  city("gba-hurlingham", "Hurlingham / Ituzaingó", "GBA_OESTE", BA, ["hurlingham", "villa tesei", "william morris", "ituzaingo", "villa udaondo"], [-34.62, -58.66]),
  city("gba-merlo", "Merlo", "GBA_OESTE", BA, ["merlo", "san antonio de padua", "libertad", "parque san martin", "mariano acosta", "pontevedra"], [-34.665, -58.728]),
  city("gba-moreno", "Moreno / General Rodríguez", "GBA_OESTE", BA, ["moreno", "paso del rey", "francisco alvarez", "la reja", "trujui", "general rodriguez"], [-34.634, -58.79]),
  city("gba-almirante-brown", "Almirante Brown", "GBA_SUR", BA, ["almirante brown", "adrogue", "burzaco", "longchamps", "rafael calzada", "claypole", "glew", "jose marmol", "san jose"], [-34.8, -58.39]),
  city("gba-esteban-echeverria", "Esteban Echeverría / Ezeiza", "GBA_SUR", BA, ["esteban echeverria", "monte grande", "luis guillon", "el jaguel", "canning", "9 de abril", "ezeiza", "tristan suarez", "la union"], [-34.82, -58.47]),
  city("gba-berazategui", "Berazategui / Florencio Varela", "GBA_SUR", BA, ["berazategui", "hudson", "ranelagh", "platanos", "villa espana", "florencio varela", "bosques", "zeballos"], [-34.765, -58.21]),

  // ── Provincia de Buenos Aires ──
  city("pba-la-plata", "La Plata, Berisso y Ensenada", "PBA", BA, ["la plata", "berisso", "ensenada", "city bell", "gonnet", "manuel b gonnet", "villa elisa", "tolosa", "los hornos"], [-34.921, -57.954]),
  city("pba-mar-del-plata", "Mar del Plata", "PBA", BA, ["mar del plata", "general pueyrredon", "batan", "sierra de los padres"], [-38.005, -57.556]),
  city("pba-bahia-blanca", "Bahía Blanca", "PBA", BA, ["bahia blanca", "ingeniero white", "punta alta", "coronel de marina leonardo rosales"], [-38.718, -62.266]),
  city("pba-zarate-campana", "Zárate y Campana", "PBA", BA, ["zarate", "campana", "lima", "exaltacion de la cruz", "capilla del senor", "los cardales"], [-34.13, -59.0]),
  city("pba-lujan", "Luján", "PBA", BA, ["lujan", "open door", "jauregui"], [-34.57, -59.105]),
  city("pba-tandil", "Tandil", "PBA", BA, ["tandil"], [-37.328, -59.137]),
  city("pba-olavarria", "Olavarría y Azul", "PBA", BA, ["olavarria", "azul"], [-36.893, -60.323]),
  city("pba-san-nicolas", "San Nicolás y Pergamino", "PBA", BA, ["san nicolas de los arroyos", "san nicolas", "pergamino", "ramallo", "san pedro"], [-33.335, -60.21]),
  city("pba-junin", "Junín", "PBA", BA, ["junin", "chacabuco", "chivilcoy"], [-34.585, -60.95]),
  city("pba-costa", "Costa Atlántica", "PBA", BA, ["pinamar", "villa gesell", "la costa", "san clemente del tuyu", "santa teresita", "mar de ajo", "san bernardo", "carilo", "mar de las pampas", "necochea", "miramar", "general alvarado"]),
  rest("pba-resto", BA, "PBA"),

  // ── Centro ──
  city("cba-capital", "Córdoba capital", "CENTRO", "Córdoba", ["cordoba", "capital"], [-31.417, -64.183]),
  city("cba-sierras", "Carlos Paz y Sierras Chicas", "CENTRO", "Córdoba", ["villa carlos paz", "punilla", "colon", "villa allende", "rio ceballos", "unquillo", "mendiolaza", "la calera", "cosquin", "la falda", "alta gracia", "santa maria"], [-31.42, -64.497]),
  city("cba-rio-cuarto", "Río Cuarto", "CENTRO", "Córdoba", ["rio cuarto", "las higueras"], [-33.124, -64.349]),
  city("cba-villa-maria", "Villa María y San Francisco", "CENTRO", "Córdoba", ["villa maria", "general san martin", "villa nueva", "san francisco", "san justo"], [-32.407, -63.24]),
  rest("cba-resto", "Córdoba", "CENTRO"),
  city("sfe-rosario", "Rosario y alrededores", "CENTRO", "Santa Fe", ["rosario", "funes", "roldan", "villa gobernador galvez", "granadero baigorria", "perez", "san lorenzo", "capitan bermudez", "fray luis beltran"], [-32.947, -60.64]),
  city("sfe-capital", "Santa Fe capital", "CENTRO", "Santa Fe", ["santa fe", "la capital", "santo tome", "recreo", "sauce viejo", "san jose del rincon"], [-31.633, -60.7]),
  city("sfe-rafaela", "Rafaela y Venado Tuerto", "CENTRO", "Santa Fe", ["rafaela", "castellanos", "venado tuerto", "general lopez", "reconquista"], [-31.25, -61.49]),
  rest("sfe-resto", "Santa Fe", "CENTRO"),
  city("er-parana", "Paraná", "CENTRO", "Entre Ríos", ["parana", "oro verde", "san benito", "colonia avellaneda"], [-31.732, -60.529]),
  city("er-costa-uruguay", "Concordia y Gualeguaychú", "CENTRO", "Entre Ríos", ["concordia", "gualeguaychu", "concepcion del uruguay", "uruguay", "colon"], [-31.392, -58.017]),
  rest("er-resto", "Entre Ríos", "CENTRO"),
  city("lp-santa-rosa", "Santa Rosa y General Pico", "CENTRO", "La Pampa", ["santa rosa", "capital", "toay", "general pico", "maraco"], [-36.62, -64.29]),
  rest("lp-resto", "La Pampa", "CENTRO"),

  // ── Cuyo ──
  city("mza-gran-mendoza", "Gran Mendoza", "CUYO", "Mendoza", ["mendoza", "capital", "godoy cruz", "guaymallen", "las heras", "lujan de cuyo", "maipu", "chacras de coria", "dorrego", "villa nueva"], [-32.889, -68.845]),
  city("mza-san-rafael", "San Rafael", "CUYO", "Mendoza", ["san rafael", "general alvear", "malargue"], [-34.617, -68.33]),
  rest("mza-resto", "Mendoza", "CUYO"),
  city("sj-gran-san-juan", "Gran San Juan", "CUYO", "San Juan", ["san juan", "capital", "rawson", "rivadavia", "chimbas", "santa lucia", "pocito"], [-31.537, -68.536]),
  rest("sj-resto", "San Juan", "CUYO"),
  city("sl-san-luis", "San Luis y Villa Mercedes", "CUYO", "San Luis", ["san luis", "juan martin de pueyrredon", "la punta", "juana koslay", "villa mercedes", "general pedernera", "merlo", "junin"], [-33.302, -66.337]),
  rest("sl-resto", "San Luis", "CUYO"),

  // ── Noroeste ──
  city("tuc-gran-tucuman", "Gran San Miguel de Tucumán", "NOA", "Tucumán", ["san miguel de tucuman", "capital", "yerba buena", "tafi viejo", "banda del rio sali", "cruz alta", "las talitas", "alderetes", "lules"], [-26.808, -65.218]),
  rest("tuc-resto", "Tucumán", "NOA"),
  city("sal-capital", "Salta capital", "NOA", "Salta", ["salta", "capital", "cerrillos", "vaqueros", "san lorenzo", "la caldera"], [-24.783, -65.412]),
  rest("sal-resto", "Salta", "NOA"),
  city("juj-capital", "San Salvador de Jujuy", "NOA", "Jujuy", ["san salvador de jujuy", "doctor manuel belgrano", "dr manuel belgrano", "palpala", "yala"], [-24.186, -65.3]),
  rest("juj-resto", "Jujuy", "NOA"),
  city("sde-capital", "Santiago del Estero y La Banda", "NOA", "Santiago del Estero", ["santiago del estero", "capital", "juan francisco borges", "la banda", "banda", "termas de rio hondo", "rio hondo"], [-27.784, -64.267]),
  rest("sde-resto", "Santiago del Estero", "NOA"),
  city("cat-capital", "Catamarca capital", "NOA", "Catamarca", ["san fernando del valle de catamarca", "catamarca", "capital", "valle viejo", "fray mamerto esquiu"], [-28.469, -65.779]),
  rest("cat-resto", "Catamarca", "NOA"),
  city("lr-capital", "La Rioja capital", "NOA", "La Rioja", ["la rioja", "capital", "chilecito"], [-29.413, -66.856]),
  rest("lr-resto", "La Rioja", "NOA"),

  // ── Noreste ──
  city("cor-capital", "Corrientes capital", "NEA", "Corrientes", ["corrientes", "capital"], [-27.469, -58.831]),
  rest("cor-resto", "Corrientes", "NEA"),
  city("cha-resistencia", "Resistencia", "NEA", "Chaco", ["resistencia", "san fernando", "barranqueras", "fontana", "puerto vilelas"], [-27.451, -58.987]),
  rest("cha-resto", "Chaco", "NEA"),
  city("mis-posadas", "Posadas", "NEA", "Misiones", ["posadas", "capital", "garupa", "candelaria"], [-27.367, -55.896]),
  rest("mis-resto", "Misiones", "NEA"),
  city("for-capital", "Formosa capital", "NEA", "Formosa", ["formosa"], [-26.185, -58.175]),
  rest("for-resto", "Formosa", "NEA"),

  // ── Patagonia ──
  city("nqn-capital", "Neuquén y Alto Valle", "PATAGONIA", "Neuquén", ["neuquen", "confluencia", "plottier", "centenario", "cutral co", "plaza huincul"], [-38.952, -68.059]),
  city("nqn-cordillera", "San Martín de los Andes y Villa La Angostura", "PATAGONIA", "Neuquén", ["san martin de los andes", "lacar", "junin de los andes", "villa la angostura", "los lagos"], [-40.157, -71.353]),
  rest("nqn-resto", "Neuquén", "PATAGONIA"),
  city("rn-bariloche", "Bariloche", "PATAGONIA", "Río Negro", ["san carlos de bariloche", "bariloche", "dina huapi", "el bolson"], [-41.134, -71.308]),
  city("rn-alto-valle", "Cipolletti, General Roca y Viedma", "PATAGONIA", "Río Negro", ["cipolletti", "general roca", "villa regina", "allen", "cinco saltos", "viedma", "adolfo alsina"], [-38.94, -67.99]),
  rest("rn-resto", "Río Negro", "PATAGONIA"),
  city("chu-comodoro", "Comodoro Rivadavia", "PATAGONIA", "Chubut", ["comodoro rivadavia", "escalante", "rada tilly"], [-45.865, -67.497]),
  city("chu-trelew-madryn", "Trelew, Rawson y Puerto Madryn", "PATAGONIA", "Chubut", ["trelew", "rawson", "puerto madryn", "biedma", "playa union", "esquel", "futaleufu"], [-43.249, -65.305]),
  rest("chu-resto", "Chubut", "PATAGONIA"),
  city("scz-rio-gallegos", "Río Gallegos y Caleta Olivia", "PATAGONIA", "Santa Cruz", ["rio gallegos", "guer aike", "caleta olivia", "deseado", "el calafate", "lago argentino"], [-51.623, -69.216]),
  rest("scz-resto", "Santa Cruz", "PATAGONIA"),
  city("tdf-ushuaia", "Ushuaia", "PATAGONIA", "Tierra del Fuego", ["ushuaia"], [-54.801, -68.303]),
  city("tdf-rio-grande", "Río Grande y Tolhuin", "PATAGONIA", "Tierra del Fuego", ["rio grande", "tolhuin"], [-53.787, -67.71]),
  rest("tdf-resto", "Tierra del Fuego", "PATAGONIA"),
];

/** Provincia de las zonas originales (para acotar la búsqueda de la dirección a su provincia). */
export const provinceOfLegacyRegion = (region: string) => (region === "CABA" ? "Ciudad de Buenos Aires" : region.startsWith("GBA") ? BA : null);
