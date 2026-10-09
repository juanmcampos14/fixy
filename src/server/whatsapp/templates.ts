/**
 * Plantillas de WhatsApp de Fixy (categoría "utilidad"). Meta las revisa antes de poder usarlas.
 * Se crean desde /admin/whatsapp. Si cambiás el texto, cambiá también el nombre (Meta no permite editar una aprobada sin revisión).
 */
export const WA_LANGUAGE = "es_AR";
const SITE = "https://www.fixy.solutions";

export const WA_TEMPLATES = {
  /** Reserva directa: el profesional elegido aceptó y propone día de visita. Params: nombre, profesional, código, fecha. Botón: id del pedido. */
  proAccepted: {
    name: "fixy_profesional_acepto",
    body: "Hola {{1}}, {{2}} aceptó tu pedido {{3}} y propone visitarte el {{4}}. Confirmá la visita desde Fixy para coordinar todo de forma segura.",
    example: ["Juan", "Plomería Sosa", "S-1024", "jueves 15/10 por la mañana"],
    button: "Ver pedido",
  },
  /** Pedido de presupuestos: llegó uno nuevo. Params: nombre, profesional, código, total. Botón: id del pedido. */
  quoteReceived: {
    name: "fixy_presupuesto_recibido",
    body: "Hola {{1}}, {{2}} te envió un presupuesto para tu pedido {{3}} por {{4}}. Revisá qué incluye antes de confirmar.",
    example: ["Juan", "Plomería Sosa", "S-1024", "$ 45.000"],
    button: "Ver presupuesto",
  },
} as const;

export type WaTemplateKey = keyof typeof WA_TEMPLATES;

/** Definición para la API de Meta (POST /{waba}/message_templates). */
export function templateDefinition(key: WaTemplateKey) {
  const t = WA_TEMPLATES[key];
  return {
    name: t.name,
    language: WA_LANGUAGE,
    category: "UTILITY",
    components: [
      { type: "BODY", text: t.body, example: { body_text: [t.example] } },
      { type: "BUTTONS", buttons: [{ type: "URL", text: t.button, url: `${SITE}/app/solicitudes/{{1}}`, example: [`${SITE}/app/solicitudes/3f1c2a9e-0000-4000-8000-000000000000`] }] },
    ],
  };
}

/** Aviso que viaja por el outbox. El primer parámetro (nombre) se completa con el de cada destinatario al enviar. */
export type WaNotice = { template: WaTemplateKey; params: string[]; requestId: string; text: string };
