import type { LeadStage } from "@/server/modules/supply";

export const STAGE_TONE: Record<LeadStage, "neutral" | "info" | "warn" | "ok" | "danger"> = {
  candidate: "neutral", contacted: "info", interested: "warn", registered: "info", verified: "ok", active: "ok", discarded: "danger",
};

export const CONTACT_CHANNELS: Record<string, string> = {
  whatsapp: "WhatsApp", call: "Llamada", instagram: "Instagram", facebook: "Facebook", email: "Email", visit: "En persona", other: "Otro",
};

/** Pestañas de Captación (las de campañas viven en su propia ruta). */
export const SUPPLY_TABS = [
  { key: "candidatos", label: "Candidatos", href: "/admin/captacion" },
  { key: "campanas", label: "Campañas", href: "/admin/captacion/campanas" },
  { key: "metricas", label: "Métricas", href: "/admin/captacion?vista=metricas" },
  { key: "cargar", label: "Cargar y sincronizar", href: "/admin/captacion?vista=cargar" },
  { key: "integraciones", label: "API e integraciones", href: "/admin/captacion?vista=integraciones" },
];

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "warn" | "ok" | "danger" }> = {
  draft: { label: "Borrador", tone: "neutral" }, active: { label: "Activa", tone: "ok" }, paused: { label: "Pausada", tone: "warn" }, closed: { label: "Cerrada", tone: "info" },
};
export const CAMPAIGN_LEAD_STATUS: Record<string, string> = {
  queued: "En cola", sent: "Enviado", replied: "Respondió", no_response: "Sin respuesta", skipped: "Salteado", opted_out: "Pidió la baja",
};
