/** Variantes de la landing de captación de profesionales (/sumate/[oficio]). */
export type Oficio = { slug: string; category: string | null; singular: string; plural: string; ejemplos: string };

export const OFICIOS: Oficio[] = [
  { slug: "electricistas", category: "electricidad", singular: "electricista", plural: "electricistas", ejemplos: "térmicas que saltan, enchufes, luminarias y tableros" },
  { slug: "plomeros", category: "plomeria", singular: "plomero/a", plural: "plomeros", ejemplos: "pérdidas, griferías, inodoros y destapaciones" },
  { slug: "gasistas", category: "gas", singular: "gasista matriculado/a", plural: "gasistas matriculados", ejemplos: "calefones, termotanques, estufas y cocinas" },
  { slug: "tecnicos-de-aire", category: "climatizacion", singular: "técnico/a de aire acondicionado", plural: "técnicos de aire acondicionado", ejemplos: "instalaciones, cargas de gas y mantenimiento de splits" },
  { slug: "tecnicos-de-electrodomesticos", category: "electrodomesticos", singular: "técnico/a de electrodomésticos", plural: "técnicos de electrodomésticos", ejemplos: "heladeras, lavarropas y hornos" },
  { slug: "cerrajeros", category: "cerrajeria", singular: "cerrajero/a", plural: "cerrajeros", ejemplos: "aperturas, cambios de cerradura y combinaciones" },
  { slug: "pintores", category: "pintura", singular: "pintor/a", plural: "pintores", ejemplos: "ambientes, frentes y retoques" },
  { slug: "albaniles", category: "albanileria", singular: "albañil", plural: "albañiles", ejemplos: "revoques, humedad, cerámicos y pequeñas obras" },
  { slug: "carpinteros", category: "carpinteria", singular: "carpintero/a", plural: "carpinteros", ejemplos: "muebles, placares y puertas" },
  { slug: "limpieza", category: "limpieza", singular: "profesional de limpieza", plural: "profesionales de limpieza", ejemplos: "limpiezas profundas, final de obra y oficinas" },
  { slug: "tecnicos-informaticos", category: "informatica", singular: "técnico/a informático/a", plural: "técnicos informáticos", ejemplos: "redes Wi-Fi, computadoras e impresoras" },
  { slug: "jardineros", category: "jardineria", singular: "jardinero/a o paisajista", plural: "jardineros y paisajistas", ejemplos: "corte de césped, podas, diseño de jardines y riego" },
  { slug: "pileteros", category: "piletas", singular: "piletero/a", plural: "pileteros", ejemplos: "mantenimiento, puesta a punto, bombas y filtros" },
  { slug: "fumigadores", category: "fumigacion", singular: "fumigador/a", plural: "fumigadores y empresas de control de plagas", ejemplos: "cucarachas, roedores, mosquitos y limpieza de tanques" },
  { slug: "volquetes", category: "volquetes", singular: "empresa de volquetes", plural: "empresas de volquetes", ejemplos: "volquetes, retiro de escombros y de muebles" },
  { slug: "fletes-y-mudanzas", category: "mudanzas", singular: "fletero/a", plural: "fleteros y empresas de mudanzas", ejemplos: "mudanzas, fletes y embalaje" },
  { slug: "constructores", category: "reformas", singular: "constructor/a", plural: "constructores y empresas de reformas", ejemplos: "reformas de baño y cocina, ampliaciones y obras completas" },
  { slug: "arquitectos", category: "arquitectura", singular: "arquitecto/a o ingeniero/a", plural: "arquitectos e ingenieros", ejemplos: "proyectos, planos, dirección de obra y habilitaciones" },
  { slug: "decoradores", category: "decoracion", singular: "decorador/a o interiorista", plural: "decoradores e interioristas", ejemplos: "asesoramientos, proyectos de ambientes y ambientaciones" },
  { slug: "techistas", category: "techos", singular: "techista", plural: "techistas", ejemplos: "goteras, membranas, zinguería y canaletas" },
  { slug: "colocadores", category: "pisos", singular: "colocador/a de pisos", plural: "colocadores de pisos", ejemplos: "porcelanato, pisos flotantes, pulido y plastificado" },
  { slug: "durlockeros", category: "durlock", singular: "instalador/a de durlock", plural: "instaladores de durlock", ejemplos: "tabiques, cielorrasos y revestimientos" },
  { slug: "herreros", category: "herreria", singular: "herrero/a", plural: "herreros", ejemplos: "rejas, portones, escaleras y automatizaciones" },
  { slug: "vidrieros", category: "vidrieria", singular: "vidriero/a", plural: "vidrieros y fabricantes de aberturas", ejemplos: "vidrios, espejos, mamparas y ventanas" },
  { slug: "marmoleros", category: "marmoleria", singular: "marmolero/a", plural: "marmoleros", ejemplos: "mesadas de cocina y baño en granito, mármol y cuarzo" },
  { slug: "instaladores-de-alarmas", category: "seguridad", singular: "instalador/a de alarmas y cámaras", plural: "instaladores de alarmas y cámaras", ejemplos: "cámaras, alarmas, porteros y cercos eléctricos" },
  { slug: "energia-solar", category: "energia-solar", singular: "instalador/a de energía solar", plural: "instaladores de energía solar", ejemplos: "paneles y termotanques solares" },
  { slug: "cortineros", category: "cortinas", singular: "cortinero/a", plural: "cortineros y persianistas", ejemplos: "cortinas a medida, persianas y toldos" },
  { slug: "tapiceros", category: "tapiceria", singular: "tapicero/a", plural: "tapiceros y restauradores", ejemplos: "retapizados, restauraciones y laqueados" },
  { slug: "calefaccionistas", category: "calefaccion", singular: "calefaccionista", plural: "calefaccionistas", ejemplos: "calderas, radiadores y losa radiante" },
  { slug: "mantenimiento", category: "mantenimiento", singular: "profesional de mantenimiento", plural: "profesionales de mantenimiento", ejemplos: "arreglos varios, instalaciones y ajustes" },
  { slug: "empresas", category: null, singular: "empresa de servicios", plural: "empresas de servicios", ejemplos: "mantenimiento para hogares y oficinas con tu equipo de técnicos" },
];

export const findOficio = (slug: string) => OFICIOS.find((o) => o.slug === slug) ?? null;
