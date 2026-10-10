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
    path: "/app/solicitudes/",
  },
  /** Pedido de presupuestos: llegó uno nuevo. Params: nombre, profesional, código, total. Botón: id del pedido. */
  quoteReceived: {
    name: "fixy_presupuesto_recibido",
    body: "Hola {{1}}, {{2}} te envió un presupuesto para tu pedido {{3}} por {{4}}. Revisá qué incluye antes de confirmar.",
    example: ["Juan", "Plomería Sosa", "S-1024", "$ 45.000"],
    button: "Ver presupuesto",
    path: "/app/solicitudes/",
  },
  // ── Para profesionales (solo si activaron los avisos por WhatsApp) ──
  /** Pedido nuevo de su rubro y zona. Params: nombre, rubro, zona, título. Botón: id de la invitación. */
  newOpportunity: {
    name: "fixy_nueva_oportunidad",
    body: "Hola {{1}}, tenés un pedido nuevo de {{2}} en {{3}}: «{{4}}». Revisalo y respondé desde Fixy: responder rápido te ayuda a que te elijan.",
    example: ["Juan", "electricidad", "Escobar", "Cambiar un tomacorriente"],
    button: "Ver pedido",
    path: "/proveedor/oportunidades/",
  },
  /** Reserva directa: el cliente lo eligió. Params: nombre, rubro, zona, título. Botón: id de la invitación. */
  chosenYou: {
    name: "fixy_cliente_te_eligio",
    body: "Hola {{1}}, un cliente te eligió para un trabajo de {{2}} en {{3}}: «{{4}}». Respondé lo antes posible desde Fixy para coordinar la visita.",
    example: ["Juan", "plomería", "Palermo", "Pierde agua la canilla"],
    button: "Responder",
    path: "/proveedor/oportunidades/",
  },
  /** Pedido con presupuesto del cliente. Params: nombre, monto, rubro, zona, título. Botón: id de la invitación. */
  budgetOffer: {
    name: "fixy_cliente_ofrece",
    body: "Hola {{1}}, un cliente ofrece {{2}} por un trabajo de {{3}} en {{4}}: «{{5}}». Anotate por ese precio u ofrecé menos desde Fixy.",
    example: ["Juan", "$ 60.000", "pintura", "Belgrano", "Pintar un ambiente"],
    button: "Ofertar",
    path: "/proveedor/oportunidades/",
  },
  /** El cliente aceptó su presupuesto. Params: nombre, código del trabajo. Botón: id del trabajo. */
  hired: {
    name: "fixy_te_contrataron",
    body: "Hola {{1}}, ¡te contrataron! El cliente aceptó tu presupuesto del trabajo {{2}}. Entrá a Fixy para ver los detalles y coordinar.",
    example: ["Juan", "T-1024"],
    button: "Ver trabajo",
    path: "/proveedor/trabajos/",
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
      { type: "BUTTONS", buttons: [{ type: "URL", text: t.button, url: `${SITE}${t.path}{{1}}`, example: [`${SITE}${t.path}3f1c2a9e-0000-4000-8000-000000000000`] }] },
    ],
  };
}

/** Aviso que viaja por el outbox. El primer parámetro (nombre) se completa con el de cada destinatario al enviar. */
export type WaNotice = {
  template: WaTemplateKey;
  params: string[];
  /** Id que completa el link del botón (pedido, invitación o trabajo según la plantilla). */
  requestId: string;
  text: string;
  /** "provider": solo a quienes activaron los avisos de profesionales. */
  audience?: "client" | "provider";
};

/** Meta no admite saltos de línea, tabulaciones ni muchos espacios seguidos en los parámetros. */
export const waParam = (v: string, max = 60) => {
  const t = v.replace(/[\n\t\r]+/g, " ").replace(/\s{2,}/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t || "-";
};
