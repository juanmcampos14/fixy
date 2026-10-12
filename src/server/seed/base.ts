/**
 * Datos base (también necesarios fuera de la demo): zonas, catálogo, preguntas, credenciales,
 * comisiones, configuración y políticas en borrador. Idempotente (upsert por código/slug).
 * Los precios de referencia son valores de demostración: deben definirse comercialmente.
 */
import type { Db } from "@/server/db/client";
import { ZONE_MATCH_NAMES } from "@/lib/zone-match";
import { NATIONAL_ZONES, provinceOfLegacyRegion } from "@/lib/zones-national";

export const ZONES: [code: string, name: string, region: string][] = [
  ["caba-palermo", "Palermo", "CABA"],
  ["caba-belgrano", "Belgrano / Núñez", "CABA"],
  ["caba-recoleta", "Recoleta / Retiro", "CABA"],
  ["caba-centro", "Microcentro / San Nicolás", "CABA"],
  ["caba-caballito", "Caballito / Almagro", "CABA"],
  ["caba-urquiza", "Villa Urquiza / Saavedra", "CABA"],
  ["caba-flores", "Flores / Floresta", "CABA"],
  ["caba-sur", "San Telmo / Barracas / La Boca", "CABA"],
  ["gba-vicente-lopez", "Vicente López", "GBA_NORTE"],
  ["gba-san-isidro", "San Isidro", "GBA_NORTE"],
  ["gba-san-fernando", "San Fernando", "GBA_NORTE"],
  ["gba-tigre", "Tigre / Nordelta", "GBA_NORTE"],
  ["gba-escobar", "Escobar", "GBA_NORTE"],
  ["gba-pilar", "Pilar", "GBA_NORTE"],
  ["gba-moron", "Morón", "GBA_OESTE"],
  ["gba-la-matanza", "La Matanza", "GBA_OESTE"],
  ["gba-avellaneda", "Avellaneda", "GBA_SUR"],
  ["gba-lanus", "Lanús", "GBA_SUR"],
  ["gba-lomas", "Lomas de Zamora", "GBA_SUR"],
  ["gba-quilmes", "Quilmes", "GBA_SUR"],
];

type Q = { key: string; label: string; kind: "text" | "select" | "boolean"; options?: string[]; required?: boolean };

export const CATEGORIES: { slug: string; name: string; description: string; icon: string; requiresReview?: boolean; safety?: string; questions: Q[] }[] = [
  {
    slug: "electricidad", name: "Electricidad", icon: "zap",
    description: "Enchufes, térmicas, cortes, luminarias y tableros.",
    safety: "Si ves chispas, olor a quemado o cables expuestos, no los toques y cortá la luz desde la térmica general si podés hacerlo sin riesgo.",
    questions: [
      { key: "afecta_toda_casa", label: "¿Afecta a todo el lugar o a un sector?", kind: "select", options: ["Todo el lugar", "Un ambiente o sector", "Un solo enchufe o luz", "No sé"], required: true },
      { key: "salta_termica", label: "¿Salta la térmica o el disyuntor?", kind: "select", options: ["Sí", "No", "No sé"] },
    ],
  },
  {
    slug: "plomeria", name: "Plomería", icon: "droplets",
    description: "Pérdidas, canillas, inodoros, desagües y cañerías.",
    questions: [
      { key: "hay_perdida_activa", label: "¿Hay una pérdida de agua activa ahora?", kind: "select", options: ["Sí, constante", "Gotea", "No"], required: true },
      { key: "pudo_cerrar_llave", label: "¿Pudiste cerrar la llave de paso?", kind: "select", options: ["Sí", "No", "No sé dónde está"] },
    ],
  },
  {
    slug: "gas", name: "Gas", icon: "flame",
    description: "Artefactos a gas, calefones, estufas y cocinas. Solo profesionales con matrícula.",
    safety: "Si sentís olor a gas: no prendas ni apagues luces, ventilá, salí del lugar y llamá a la emergencia de tu distribuidora o al 911.",
    questions: [
      { key: "artefacto", label: "¿Qué artefacto es?", kind: "select", options: ["Calefón", "Termotanque", "Estufa", "Cocina / horno", "Caldera", "Otro"], required: true },
      { key: "olor_gas", label: "¿Sentís olor a gas?", kind: "select", options: ["Sí", "No"], required: true },
    ],
  },
  {
    slug: "climatizacion", name: "Aire acondicionado y climatización", icon: "snowflake",
    description: "Instalación, mantenimiento y reparación de equipos.",
    questions: [
      { key: "tipo_equipo", label: "Tipo de equipo", kind: "select", options: ["Split", "Ventana", "Portátil", "Central", "No sé"], required: true },
      { key: "frigorias", label: "Frigorías aproximadas (si las sabés)", kind: "text" },
      { key: "necesita_instalacion", label: "¿Es una instalación nueva?", kind: "boolean" },
    ],
  },
  {
    slug: "electrodomesticos", name: "Electrodomésticos", icon: "washing-machine",
    description: "Heladeras, lavarropas, hornos y otros equipos.",
    questions: [
      { key: "equipo", label: "¿Qué equipo es?", kind: "text", required: true },
      { key: "marca_modelo", label: "Marca y modelo (si los tenés)", kind: "text" },
      { key: "en_garantia", label: "¿Está en garantía de fábrica?", kind: "select", options: ["Sí", "No", "No sé"] },
    ],
  },
  {
    slug: "cerrajeria", name: "Cerrajería", icon: "key-round",
    description: "Cerraduras, aperturas, cambios de combinación.",
    questions: [{ key: "situacion", label: "¿Cuál es la situación?", kind: "select", options: ["Me quedé afuera", "Cambio de cerradura", "Cambio de combinación", "Cerradura trabada", "Otro"], required: true }],
  },
  {
    slug: "pintura", name: "Pintura", icon: "paint-roller",
    description: "Interiores, exteriores, retoques y preparación de superficies.",
    questions: [
      { key: "superficie", label: "Superficie aproximada (m² o ambientes)", kind: "text", required: true },
      { key: "incluye_materiales", label: "¿Querés que el profesional provea la pintura?", kind: "boolean" },
    ],
  },
  {
    slug: "albanileria", name: "Albañilería", icon: "brick-wall",
    description: "Revoques, grietas, humedad, cerámicos y pequeñas obras.",
    questions: [{ key: "tipo_trabajo", label: "¿Qué tipo de trabajo es?", kind: "select", options: ["Reparación", "Humedad", "Revestimiento", "Pequeña obra", "Otro"], required: true }],
  },
  {
    slug: "carpinteria", name: "Carpintería", icon: "hammer",
    description: "Muebles, puertas, placares y armado.",
    questions: [{ key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Reparar", "Armar", "Fabricar a medida", "Ajustar puertas"], required: true }],
  },
  {
    slug: "limpieza", name: "Limpieza", icon: "sparkles",
    description: "Limpieza profunda, final de obra y oficinas.",
    questions: [
      { key: "tipo_limpieza", label: "Tipo de limpieza", kind: "select", options: ["General profunda", "Final de obra", "Oficina", "Vidrios"], required: true },
      { key: "superficie", label: "Superficie o ambientes", kind: "text" },
    ],
  },
  {
    slug: "informatica", name: "Informática y redes", icon: "wifi",
    description: "Wi-Fi, redes, computadoras e impresoras.",
    questions: [{ key: "equipos", label: "¿Cuántos equipos o puestos involucra?", kind: "text" }],
  },
  // ── Exterior y espacios verdes ──
  {
    slug: "jardineria", name: "Jardinería y paisajismo", icon: "trees",
    description: "Corte de césped, poda, mantenimiento, diseño de jardines y riego.",
    questions: [
      { key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Mantenimiento periódico", "Corte de césped", "Poda de árboles o cercos", "Diseño o armado de jardín", "Riego automático", "Otro"], required: true },
      { key: "superficie", label: "Tamaño aproximado del jardín o cantidad de plantas", kind: "text" },
    ],
  },
  {
    slug: "piletas", name: "Piletas", icon: "waves",
    description: "Mantenimiento, limpieza, puesta a punto, bombas, filtros y pintura de piletas.",
    questions: [
      { key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Mantenimiento periódico", "Puesta a punto de temporada", "Recuperar agua verde", "Bomba o filtro", "Pintura o reparación", "Construcción", "Otro"], required: true },
      { key: "medidas", label: "Medidas o litros aproximados (si los sabés)", kind: "text" },
    ],
  },
  {
    slug: "fumigacion", name: "Fumigación y control de plagas", icon: "bug",
    description: "Cucarachas, roedores, mosquitos, hormigas y desinfección. También limpieza de tanques de agua.",
    safety: "Antes de una fumigación avisá si hay chicos, personas embarazadas, mascotas o peceras: el profesional te indica cuánto tiempo hay que ventilar.",
    questions: [
      { key: "plaga", label: "¿Qué necesitás tratar?", kind: "select", options: ["Cucarachas", "Roedores", "Mosquitos", "Hormigas", "Chinches o pulgas", "Murciélagos o palomas", "Limpieza de tanque de agua", "No sé"], required: true },
      { key: "certificado", label: "¿Necesitás certificado (consorcio, comercio u oficina)?", kind: "boolean" },
    ],
  },
  {
    slug: "volquetes", name: "Volquetes y retiro de escombros", icon: "truck",
    description: "Alquiler de volquetes, retiro de escombros, muebles viejos, poda y residuos de obra.",
    questions: [
      { key: "que_retirar", label: "¿Qué hay que retirar?", kind: "select", options: ["Escombros de obra", "Muebles o electrodomésticos", "Restos de poda", "Tierra", "Varios"], required: true },
      { key: "espacio_volquete", label: "¿Hay lugar en la calle o en la vereda para dejar un volquete?", kind: "select", options: ["Sí", "No", "No sé"] },
    ],
  },
  {
    slug: "mudanzas", name: "Mudanzas y fletes", icon: "package",
    description: "Mudanzas, fletes, traslado de muebles y embalaje.",
    questions: [
      { key: "tipo", label: "¿Qué necesitás?", kind: "select", options: ["Mudanza completa", "Flete de pocos muebles", "Solo embalaje", "Guardamuebles"], required: true },
      { key: "destino", label: "¿A qué barrio o localidad va?", kind: "text", required: true },
      { key: "ascensor", label: "¿Hay ascensor o hay que subir por escalera?", kind: "text" },
    ],
  },
  // ── Obra y terminaciones ──
  {
    slug: "reformas", name: "Reformas y obras", icon: "hard-hat",
    description: "Reformas de baño y cocina, ampliaciones, construcción y obras completas con un solo responsable.",
    questions: [
      { key: "tipo_obra", label: "¿Qué tipo de obra es?", kind: "select", options: ["Reforma de baño", "Reforma de cocina", "Reforma integral", "Ampliación", "Construcción desde cero", "Local u oficina", "Otro"], required: true },
      { key: "tiene_planos", label: "¿Tenés planos o proyecto?", kind: "select", options: ["Sí", "No", "Necesito que me lo armen"] },
    ],
  },
  {
    slug: "arquitectura", name: "Arquitectura e ingeniería", icon: "drafting-compass",
    description: "Proyectos, planos, dirección de obra, regularizaciones, habilitaciones e informes técnicos.",
    questions: [
      { key: "necesidad", label: "¿Qué necesitás?", kind: "select", options: ["Proyecto y planos", "Dirección de obra", "Regularizar o aprobar planos", "Habilitación comercial", "Informe técnico o cálculo estructural", "Asesoramiento"], required: true },
      { key: "superficie", label: "Superficie aproximada (m²)", kind: "text" },
    ],
  },
  {
    slug: "decoracion", name: "Decoración e interiorismo", icon: "lamp",
    description: "Diseño de interiores, asesoramiento, ambientación y elección de muebles y colores.",
    questions: [
      { key: "alcance", label: "¿Qué estás buscando?", kind: "select", options: ["Asesoramiento por única vez", "Proyecto de un ambiente", "Proyecto de toda la casa", "Local u oficina", "Ambientación para vender o alquilar"], required: true },
      { key: "ambientes", label: "¿Qué ambientes?", kind: "text" },
    ],
  },
  {
    slug: "techos", name: "Techos e impermeabilización", icon: "umbrella",
    description: "Goteras, filtraciones, membranas, zinguería, canaletas y tejas.",
    questions: [
      { key: "tipo_techo", label: "¿Qué tipo de techo es?", kind: "select", options: ["Losa o terraza", "Chapa", "Tejas", "No sé"], required: true },
      { key: "hay_filtracion", label: "¿Hay goteras o filtraciones ahora?", kind: "select", options: ["Sí", "No, es preventivo"] },
    ],
  },
  {
    slug: "pisos", name: "Pisos y revestimientos", icon: "layout-grid",
    description: "Colocación de cerámicos y porcelanato, pisos flotantes y vinílicos, pulido y plastificado.",
    questions: [
      { key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Colocar cerámicos o porcelanato", "Piso flotante o vinílico", "Pulido y plastificado de madera", "Microcemento", "Reparar piezas sueltas", "Otro"], required: true },
      { key: "superficie", label: "Superficie aproximada (m²)", kind: "text" },
    ],
  },
  {
    slug: "durlock", name: "Durlock y construcción en seco", icon: "layers",
    description: "Tabiques, cielorrasos, revestimientos, muebles y aislaciones en placa de yeso.",
    questions: [{ key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Dividir un ambiente", "Cielorraso", "Revestir una pared", "Mueble o nicho", "Reparación", "Otro"], required: true }],
  },
  {
    slug: "herreria", name: "Herrería y portones", icon: "fence",
    description: "Rejas, portones, escaleras, estructuras, soldaduras y automatización de portones.",
    questions: [{ key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Rejas", "Portón nuevo", "Automatizar o reparar un portón", "Escalera o baranda", "Estructura o techo", "Soldadura o reparación"], required: true }],
  },
  {
    slug: "vidrieria", name: "Vidriería y aberturas", icon: "app-window",
    description: "Vidrios, espejos, mamparas, ventanas y puertas de aluminio o PVC, y mosquiteros.",
    questions: [
      { key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Reponer un vidrio roto", "Espejo a medida", "Mampara de baño", "Ventana o puerta nueva", "Reparar una abertura", "Mosquiteros", "Cerramiento"], required: true },
      { key: "medidas", label: "Medidas aproximadas (si las tenés)", kind: "text" },
    ],
  },
  {
    slug: "marmoleria", name: "Marmolería y mesadas", icon: "gem",
    description: "Mesadas de cocina y baño, granito, mármol, cuarzo y pulido.",
    questions: [{ key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Mesada nueva", "Cambiar o agrandar una mesada", "Pulido o reparación", "Otro"], required: true }],
  },
  // ── Equipamiento ──
  {
    slug: "seguridad", name: "Alarmas, cámaras y porteros", icon: "cctv",
    description: "Cámaras de seguridad, alarmas, porteros eléctricos, cercos eléctricos y control de acceso.",
    questions: [{ key: "sistema", label: "¿Qué sistema es?", kind: "select", options: ["Cámaras", "Alarma", "Portero eléctrico o visor", "Cerco eléctrico", "Control de acceso", "Varios"], required: true }],
  },
  {
    slug: "energia-solar", name: "Energía solar", icon: "sun",
    description: "Paneles solares, termotanques solares y climatización solar de piletas.",
    questions: [{ key: "sistema", label: "¿Qué te interesa?", kind: "select", options: ["Paneles para generar electricidad", "Termotanque solar", "Climatizar la pileta", "Reparar o mantener un equipo", "Asesoramiento"], required: true }],
  },
  {
    slug: "cortinas", name: "Cortinas, persianas y toldos", icon: "blinds",
    description: "Cortinas roller y de tela, persianas, cortinas de enrollar y toldos: colocación y reparación.",
    questions: [{ key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Cortinas nuevas a medida", "Reparar una persiana o cortina de enrollar", "Motorizar", "Toldo", "Solo colocación"], required: true }],
  },
  {
    slug: "tapiceria", name: "Tapicería y restauración de muebles", icon: "armchair",
    description: "Retapizado de sillones y sillas, restauración, laqueado y lustre de muebles.",
    questions: [{ key: "mueble", label: "¿Qué mueble es y cuántos son?", kind: "text", required: true }],
  },
  {
    slug: "tv-audio", name: "TV, audio y electrónica", icon: "tv",
    description: "Instalación de televisores y soportes, sonido, proyectores y reparación de equipos electrónicos.",
    questions: [{ key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Colgar un televisor", "Instalar sonido o proyector", "Reparar un equipo", "Antena o cableado", "Otro"], required: true }],
  },
  {
    slug: "domotica", name: "Casa inteligente", icon: "house-wifi",
    description: "Luces, enchufes, cerraduras y climatización controlados desde el celular.",
    questions: [{ key: "alcance", label: "¿Qué querés automatizar?", kind: "text", required: true }],
  },
  {
    slug: "calefaccion", name: "Calefacción y calderas", icon: "heater",
    description: "Calderas, radiadores, losa radiante y sistemas de calefacción central.",
    safety: "Si sentís olor a gas o el artefacto tiene llama amarilla: no lo uses, ventilá y llamá a la emergencia de tu distribuidora o al 911.",
    questions: [{ key: "sistema", label: "¿Qué sistema tenés?", kind: "select", options: ["Caldera con radiadores", "Losa radiante", "Calefacción central por aire", "Quiero instalar uno", "No sé"], required: true }],
  },
  {
    slug: "ascensores", name: "Ascensores y montacargas", icon: "arrow-up-down",
    description: "Mantenimiento, reparación y modernización para edificios, comercios y casas.",
    questions: [{ key: "tipo_trabajo", label: "¿Qué necesitás?", kind: "select", options: ["Mantenimiento mensual", "Reparación", "Instalación o modernización", "Inspección o libro de conservación"], required: true }],
  },
  {
    slug: "mantenimiento", name: "Mantenimiento general", icon: "wrench",
    description: "Arreglos varios: colgar, ajustar, instalar y reparar.",
    questions: [{ key: "lista", label: "Contanos la lista de tareas", kind: "text" }],
  },
  {
    slug: "otro", name: "Otro problema / no sé qué profesional necesito", icon: "circle-help", requiresReview: true,
    description: "Describilo con tus palabras: una persona del equipo lo revisa y lo deriva.",
    questions: [],
  },
];

export const CREDENTIAL_TYPES = [
  { code: "matricula_gasista", name: "Matrícula de gasista", description: "Matrícula vigente habilitante para trabajos en instalaciones de gas.", expires: true },
  { code: "matricula_electricista", name: "Matrícula de electricista", description: "Matrícula o habilitación vigente como instalador electricista.", expires: true },
  { code: "matricula_profesional", name: "Matrícula profesional", description: "Matrícula vigente de arquitecto/a, ingeniero/a o maestro mayor de obras.", expires: false },
  { code: "habilitacion_plagas", name: "Habilitación para control de plagas", description: "Inscripción vigente como empresa de control de plagas, con director técnico.", expires: true },
  { code: "seguro_ap", name: "Seguro de accidentes personales", description: "Póliza vigente de accidentes personales o ART.", expires: true },
];

/** Servicios catalogados. Precios en centavos, de referencia para la demo. */
export const SERVICES = [
  { slug: "instalacion-luminaria", cat: "electricidad", name: "Instalación de luminaria (hasta 1 punto)", mode: "fixed", fixed: 2_800_000, scope: "Instalación de una luminaria en un punto existente, con prueba de funcionamiento.", exclusions: "No incluye la luminaria ni tendido de cables nuevos." },
  { slug: "cambio-tomacorriente", cat: "electricidad", name: "Cambio de tomacorriente o llave", mode: "fixed", fixed: 1_900_000, scope: "Reemplazo de un tomacorriente o llave de luz existente.", exclusions: "No incluye materiales ni reparación de cableado." },
  { slug: "destapacion-pileta", cat: "plomeria", name: "Destapación simple de pileta o bacha", mode: "fixed", fixed: 3_500_000, scope: "Destapación manual de pileta de cocina o bacha de baño.", exclusions: "No incluye destapación de cloacas ni rotura de cañerías." },
  { slug: "cambio-cerradura", cat: "cerrajeria", name: "Cambio de cerradura (mano de obra)", mode: "fixed", fixed: 3_000_000, scope: "Reemplazo de cerradura de puerta interior o exterior estándar.", exclusions: "No incluye la cerradura nueva." },
  { slug: "diagnostico-electrodomesticos", cat: "electrodomesticos", name: "Visita de diagnóstico de electrodoméstico", mode: "diagnostic", diagnostic: 1_800_000, scope: "Revisión del equipo y presupuesto de reparación.", exclusions: "La reparación se cotiza aparte después de la visita." },
  { slug: "diagnostico-aire", cat: "climatizacion", name: "Visita de diagnóstico de aire acondicionado", mode: "diagnostic", diagnostic: 2_000_000, scope: "Revisión del equipo y presupuesto de reparación o carga.", exclusions: "La reparación se cotiza aparte después de la visita." },
  { slug: "reparacion-perdida", cat: "plomeria", name: "Reparación de pérdida", mode: "quote", scope: "", exclusions: "" },
  { slug: "pintura-ambiente", cat: "pintura", name: "Pintura de ambientes", mode: "quote", scope: "", exclusions: "" },
] as const;

export async function seedBase(db: Db) {
  for (const [i, [code, name, region]] of ZONES.entries()) {
    const names = ZONE_MATCH_NAMES[code] ?? [];
    await db`insert into zones (code, name, region, sort, match_names, province) values (${code}, ${name}, ${region}, ${i}, ${names}, ${provinceOfLegacyRegion(region)})
      on conflict (code) do update set name = excluded.name, region = excluded.region, sort = excluded.sort, match_names = excluded.match_names, province = excluded.province`;
  }
  for (const [i, z] of NATIONAL_ZONES.entries()) {
    await db`insert into zones (code, name, region, sort, match_names, province, catch_all)
      values (${z.code}, ${z.name}, ${z.region}, ${100 + i}, ${z.names}, ${z.province}, ${!!z.catchAll})
      on conflict (code) do update set name = excluded.name, region = excluded.region, sort = excluded.sort, match_names = excluded.match_names,
        province = excluded.province, catch_all = excluded.catch_all`;
  }
  for (const ct of CREDENTIAL_TYPES) {
    await db`insert into credential_types (code, name, description, expires) values (${ct.code}, ${ct.name}, ${ct.description}, ${ct.expires})
      on conflict (code) do update set name = excluded.name, description = excluded.description`;
  }
  for (const [i, c] of CATEGORIES.entries()) {
    const [row] = await db<{ id: string }[]>`
      insert into categories (slug, name, description, icon, sort, requires_review, safety_note)
      values (${c.slug}, ${c.name}, ${c.description}, ${c.icon}, ${i}, ${!!c.requiresReview}, ${c.safety ?? null})
      on conflict (slug) do update set name = excluded.name, description = excluded.description, icon = excluded.icon,
        sort = excluded.sort, requires_review = excluded.requires_review, safety_note = excluded.safety_note
      returning id`;
    for (const [j, q] of c.questions.entries()) {
      await db`insert into service_questions (category_id, key, label, kind, options, required, sort)
        values (${row.id}, ${q.key}, ${q.label}, ${q.kind}, ${db.json((q.options ?? []) as never)}, ${!!q.required}, ${j})
        on conflict (category_id, key) do update set label = excluded.label, kind = excluded.kind, options = excluded.options, required = excluded.required, sort = excluded.sort`;
    }
  }
  // Solo gas exige credencial para recibir oportunidades (configurable en category_required_credentials).
  await db`insert into category_required_credentials (category_id, credential_type_id)
    select c.id, ct.id from categories c, credential_types ct where c.slug = 'gas' and ct.code = 'matricula_gasista'
    on conflict do nothing`;
  for (const [i, s] of SERVICES.entries()) {
    await db`insert into services (category_id, slug, name, pricing_mode, fixed_price_minor, diagnostic_price_minor, scope, exclusions, sort)
      select id, ${s.slug}, ${s.name}, ${s.mode}, ${"fixed" in s ? s.fixed : null}, ${"diagnostic" in s ? s.diagnostic : null}, ${s.scope}, ${s.exclusions}, ${i}
      from categories where slug = ${s.cat}
      on conflict (slug) do update set name = excluded.name, pricing_mode = excluded.pricing_mode, fixed_price_minor = excluded.fixed_price_minor,
        diagnostic_price_minor = excluded.diagnostic_price_minor, scope = excluded.scope, exclusions = excluded.exclusions`;
  }
  const [{ n }] = await db<{ n: number }[]>`select count(*)::int as n from commission_rules where active and category_id is null`;
  if (n === 0) {
    // Por defecto: 0 % al profesional (Fixy no le cobra comisión) + 10 % de cargo de servicio al cliente. Sin impuestos configurados.
    await db`insert into commission_rules (category_id, provider_rate_bps, client_rate_bps, client_fee_tax_bps) values (null, 0, 1000, 0)`;
  }
  const settings: Record<string, unknown> = {
    "matching.invite_limit": 4,
    "coverage.regions": ["CABA", "GBA_NORTE", "GBA_OESTE", "GBA_SUR"],
    "quotes.default_valid_days": 7,
  };
  for (const [k, v] of Object.entries(settings)) {
    await db`insert into platform_settings (key, value) values (${k}, ${db.json(v as never)}) on conflict (key) do nothing`;
  }
  for (const p of [
    { kind: "terms", title: "Términos y condiciones" },
    { kind: "privacy", title: "Política de privacidad" },
    { kind: "provider_terms", title: "Condiciones para profesionales" },
  ]) {
    await db`insert into policy_documents (kind, version, title, is_draft) values (${p.kind}, '1.1', ${p.title}, false) on conflict do nothing`;
  }
}
