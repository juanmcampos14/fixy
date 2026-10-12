/** Constantes de interfaz del panel de proveedor (seguras para cliente y servidor). */
export { REGION_LABEL, REGION_ORDER } from "@/lib/regions";
import { REGION_ORDER } from "@/lib/regions";

export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
/** Orden de visualización: lunes primero. */
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const ITEM_KIND_LABEL: Record<string, string> = { labor: "Mano de obra", materials: "Materiales", visit: "Visita / diagnóstico" };
export const EVIDENCE_KIND_LABEL: Record<string, string> = { before: "Antes", progress: "Avance", after: "Después", note: "Nota" };
export const INVITATION_STATUS_LABEL: Record<string, string> = {
  invited: "Nueva",
  viewed: "Vista",
  quoted: "Cotizada",
  declined: "Rechazada por vos",
  expired: "Vencida",
  closed: "Cerrada",
};
export const DOCUMENT_STATUS_LABEL: Record<string, string> = { pending: "En revisión", approved: "Aprobado", rejected: "Rechazado" };
export const DOCUMENT_KIND_LABEL: Record<string, string> = { identity: "Documento de identidad", credential: "Credencial / matrícula", tax: "Constancia fiscal", other: "Otro" };

export function minutesToHour(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Agrupa zonas por región, en el orden definido. */
export function groupZones<T extends { region: string }>(zones: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  // "Otra zona" es solo para pedidos de clientes fuera de cobertura: los profesionales no la eligen.
  for (const z of zones) if (REGION_ORDER.includes(z.region)) map.set(z.region, [...(map.get(z.region) ?? []), z]);
  return [...map.entries()].sort((a, b) => REGION_ORDER.indexOf(a[0]) - REGION_ORDER.indexOf(b[0]));
}
