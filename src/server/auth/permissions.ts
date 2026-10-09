/**
 * Permisos del panel de administración, por sección.
 *  - admin (dueño): todo, incluido gestionar el equipo.
 *  - operator: perfil "Operación" predefinido.
 *  - team: lo que se le asignó en admin_permissions.
 * Niveles: "view" (solo ve) y "manage" (ve y gestiona). Se valida SIEMPRE en el servidor (páginas y acciones).
 */
import type { Actor } from "./actor";

export const ADMIN_SECTIONS = [
  { key: "resumen", label: "Resumen operativo", href: "/admin", manageable: false, hint: "Pendientes y números del día a día." },
  { key: "socios", label: "Panel de socios", href: "/admin/socios", manageable: false, hint: "Evolución del negocio, embudo, oferta, calidad y dinero." },
  { key: "proveedores", label: "Profesionales", href: "/admin/proveedores", manageable: true, hint: "Aprobar altas y revisar documentación." },
  { key: "solicitudes", label: "Solicitudes", href: "/admin/solicitudes", manageable: true, hint: "Derivar pedidos, invitar profesionales, cancelar." },
  { key: "trabajos", label: "Trabajos", href: "/admin/trabajos", manageable: true, hint: "Cambiar estados y cancelar trabajos." },
  { key: "reclamos", label: "Reclamos", href: "/admin/reclamos", manageable: true, hint: "Responder y resolver reclamos." },
  { key: "resenas", label: "Reseñas", href: "/admin/resenas", manageable: true, hint: "Impugnaciones y reglas de publicación." },
  { key: "finanzas", label: "Finanzas", href: "/admin/finanzas", manageable: true, hint: "Reintegros, retenciones y transferencia de retiros." },
  { key: "catalogo", label: "Catálogo y zonas", href: "/admin/catalogo", manageable: true, hint: "Rubros, servicios, preguntas y zonas." },
  { key: "comisiones", label: "Cargos y parámetros", href: "/admin/comisiones", manageable: true, hint: "Cargo de servicio al cliente y parámetros." },
  { key: "arrepentimientos", label: "Arrepentimientos", href: "/admin/arrepentimientos", manageable: true, hint: "Pedidos del botón de arrepentimiento." },
  { key: "whatsapp", label: "WhatsApp", href: "/admin/whatsapp", manageable: true, hint: "Plantillas de mensajes." },
  { key: "auditoria", label: "Auditoría", href: "/admin/auditoria", manageable: false, hint: "Registro de acciones sensibles." },
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["key"];
export type Level = "none" | "view" | "manage";
export type Permissions = Partial<Record<AdminSection, "view" | "manage">>;

export const SECTION_KEYS = ADMIN_SECTIONS.map((s) => s.key) as AdminSection[];
export const isSection = (s: string): s is AdminSection => (SECTION_KEYS as string[]).includes(s);

/** Perfil "Operación" (rol operator): gestiona la operación diaria; ve, pero no cambia, catálogo, cargos ni WhatsApp. */
export const OPERATOR_PRESET: Permissions = {
  resumen: "view", socios: "view", proveedores: "manage", solicitudes: "manage", trabajos: "manage", reclamos: "manage",
  resenas: "manage", finanzas: "manage", catalogo: "view", comisiones: "view", arrepentimientos: "manage", whatsapp: "view", auditoria: "view",
};

/** Perfil "Socio": ve todo, no modifica nada. */
export const PARTNER_PRESET: Permissions = Object.fromEntries(SECTION_KEYS.map((k) => [k, "view"])) as Permissions;

export const PRESETS = {
  socio: { label: "Socio", description: "Ve todo el panel. No puede modificar nada.", permissions: PARTNER_PRESET },
  operacion: { label: "Operación", description: "Gestiona la operación diaria. Ve catálogo, cargos y WhatsApp sin poder cambiarlos.", permissions: OPERATOR_PRESET },
} as const;

export function levelFor(actor: Actor | null, section: AdminSection): Level {
  if (!actor) return "none";
  if (actor.platformRole === "admin") return "manage";
  const p = actor.platformRole === "operator" ? OPERATOR_PRESET : actor.platformRole === "team" ? actor.permissions : null;
  const lvl = p?.[section] ?? "none";
  const def = ADMIN_SECTIONS.find((s) => s.key === section)!;
  return lvl === "manage" && !def.manageable ? "view" : lvl;
}

export function can(actor: Actor | null, section: AdminSection, level: "view" | "manage" = "view"): boolean {
  const l = levelFor(actor, section);
  return level === "view" ? l !== "none" : l === "manage";
}

/** Limpia y valida una matriz de permisos recibida de un formulario. */
export function sanitizePermissions(input: Record<string, string>): Permissions {
  const out: Permissions = {};
  for (const s of ADMIN_SECTIONS) {
    const v = input[s.key];
    if (v === "view" || (v === "manage" && s.manageable)) out[s.key] = v;
    else if (v === "manage") out[s.key] = "view";
  }
  return out;
}
