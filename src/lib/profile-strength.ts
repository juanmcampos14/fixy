/**
 * "Fuerza del perfil" de un profesional (0–100). Una sola definición para el panel y para el ranking:
 * en la búsqueda suma hasta 15 puntos sobre ~115, así que completar el perfil mejora la posición de verdad
 * (sin superar a la reputación ni a la disponibilidad).
 */
export type ProfileFacts = {
  descriptionLength: number;
  hasPhone: boolean;
  hasYears: boolean;
  categories: number;
  zones: number;
  hasBaseZone: boolean;
  availabilitySlots: number;
  photos: number;
  identity: "none" | "uploaded" | "verified";
  credentialsComplete: boolean;
  priceRefs: number;
  visitConfigured: boolean;
  payoutsEnabled: boolean;
};

export type StrengthItem = { key: string; label: string; hint: string; points: number; earned: number; href: string };

export function profileStrength(f: ProfileFacts): { score: number; level: string; items: StrengthItem[] } {
  const items: StrengthItem[] = [
    { key: "description", label: "Descripción de tu servicio", hint: "Contá qué hacés, cómo trabajás y qué te diferencia (al menos 120 caracteres).", points: 10, earned: f.descriptionLength >= 120 ? 10 : f.descriptionLength >= 30 ? 5 : 0, href: "/proveedor/alta#perfil" },
    { key: "phone", label: "Teléfono de contacto", hint: "Solo lo usa Fixy para avisarte de pedidos: no se publica.", points: 5, earned: f.hasPhone ? 5 : 0, href: "/proveedor/alta#perfil" },
    { key: "years", label: "Años de experiencia", hint: "Los clientes lo miran al elegir.", points: 5, earned: f.hasYears ? 5 : 0, href: "/proveedor/alta#perfil" },
    { key: "coverage", label: "Rubros y zonas", hint: "Sin rubros y zonas no aparecés en ninguna búsqueda.", points: 10, earned: f.categories > 0 && f.zones > 0 ? 10 : 0, href: "/proveedor/alta#servicios" },
    { key: "base", label: "Zona base", hint: "Te priorizamos en pedidos cerca de tu base.", points: 5, earned: f.hasBaseZone ? 5 : 0, href: "/proveedor/alta#servicios" },
    { key: "availability", label: "Días y horarios", hint: "Te mostramos cuando tu disponibilidad coincide con la del cliente.", points: 10, earned: f.availabilitySlots > 0 ? 10 : 0, href: "/proveedor/alta#servicios" },
    { key: "photos", label: "Fotos de trabajos (3 o más)", hint: "Los perfiles con fotos reciben más elecciones.", points: 15, earned: f.photos >= 3 ? 15 : f.photos > 0 ? 8 : 0, href: "/proveedor/alta#portfolio" },
    { key: "identity", label: "Identidad verificada", hint: "Muestra el sello de verificación en tu perfil.", points: 15, earned: f.identity === "verified" ? 15 : f.identity === "uploaded" ? 8 : 0, href: "/proveedor/alta#documentacion" },
    { key: "credentials", label: "Matrículas de tus rubros", hint: "Obligatorias en gas y electricidad.", points: 5, earned: f.credentialsComplete ? 5 : 0, href: "/proveedor/alta#documentacion" },
    { key: "prices", label: "Precios de referencia \"desde\" (2 o más)", hint: "El cliente ve cuánto sale antes de elegirte.", points: 10, earned: f.priceRefs >= 2 ? 10 : f.priceRefs === 1 ? 5 : 0, href: "/proveedor/perfil#visita" },
    { key: "visit", label: "Precio de la visita", hint: "Definí si cobrás la visita (puede ser sin cargo).", points: 5, earned: f.visitConfigured ? 5 : 0, href: "/proveedor/perfil#visita" },
    { key: "payouts", label: "Datos bancarios", hint: "Los pedimos al retirar: si los cargás antes, retirás en un paso.", points: 5, earned: f.payoutsEnabled ? 5 : 0, href: "/proveedor/cobros#banco" },
  ];
  const score = items.reduce((s, i) => s + i.earned, 0);
  const level = score >= 90 ? "Excelente" : score >= 70 ? "Muy bueno" : score >= 40 ? "Bueno" : "Inicial";
  return { score, level, items };
}

/** Puntos que suma la fuerza del perfil en el ranking de profesionales (0–15). */
export const rankingBoost = (score: number) => Math.round((Math.min(Math.max(score, 0), 100) / 100) * 15);
