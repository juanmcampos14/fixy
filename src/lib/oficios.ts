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
  { slug: "mantenimiento", category: "mantenimiento", singular: "profesional de mantenimiento", plural: "profesionales de mantenimiento", ejemplos: "arreglos varios, instalaciones y ajustes" },
  { slug: "empresas", category: null, singular: "empresa de servicios", plural: "empresas de servicios", ejemplos: "mantenimiento para hogares y oficinas con tu equipo de técnicos" },
];

export const findOficio = (slug: string) => OFICIOS.find((o) => o.slug === slug) ?? null;
