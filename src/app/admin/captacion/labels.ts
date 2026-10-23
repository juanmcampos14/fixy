import type { LeadStage } from "@/server/modules/supply";

export const STAGE_TONE: Record<LeadStage, "neutral" | "info" | "warn" | "ok" | "danger"> = {
  candidate: "neutral", contacted: "info", interested: "warn", registered: "info", verified: "ok", active: "ok", discarded: "danger",
};

export const CONTACT_CHANNELS: Record<string, string> = {
  whatsapp: "WhatsApp", call: "Llamada", instagram: "Instagram", facebook: "Facebook", email: "Email", visit: "En persona", other: "Otro",
};
