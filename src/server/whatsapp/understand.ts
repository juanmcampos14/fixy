/**
 * Entiende un mensaje libre en cualquier paso de la conversación: ¿trae el dato que pedimos, es una pregunta,
 * quiere saber cómo va un pedido, sumar detalles, hablar con una persona o empezar un pedido nuevo?
 * Con IA (salida estructurada) si está configurada; si no, con reglas. Nunca decide nada de dinero ni permisos:
 * solo elige qué rama del guion seguir y, para preguntas, redacta una respuesta breve con datos que le pasamos.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/server/env";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { intentByRules, type OpenRequest } from "./intent";

export type Kind = "data" | "question" | "status" | "add_details" | "new_request" | "human" | "greeting";
export type Understood = { kind: Kind; answer: string | null; requestId: string | null };

/** Qué le estamos pidiendo a la persona en este paso (para que la IA sepa si el mensaje es el dato o no). */
export type Expecting = "nothing" | "problem" | "address" | "details" | "budget" | "confirmation";

const EXPECTING_TEXT: Record<Expecting, string> = {
  nothing: "No le pedimos nada en particular: puede ser un saludo, una consulta, un pedido nuevo o algo sobre un pedido existente.",
  problem: "Le pedimos que describa el problema o trabajo que necesita resolver (eso sería \"data\").",
  address: "Le pedimos la dirección del trabajo: calle y altura, o barrio/localidad (eso sería \"data\"). Una pregunta NO es una dirección.",
  details: "Le pedimos detalles opcionales para el pedido que está armando: horarios, piso, cómo entrar (eso sería \"data\").",
  budget: "Le pedimos cuánto quiere pagar por el trabajo, en pesos (eso sería \"data\").",
  confirmation: "Le mostramos el resumen del pedido y le preguntamos si lo enviamos.",
};

const FACTS = `Datos de Fixy (usá solo esto, no inventes):
- Fixy conecta personas, oficinas y empresas con profesionales de oficios (plomería, electricidad, gas, pintura, aire acondicionado, cerrajería y más) en CABA y GBA. También trabajos grandes y obras: se coordinan escribiendo a ${SUPPORT_EMAIL}.
- Por este WhatsApp se puede: hacer un pedido nuevo, ver cómo van los pedidos y sumar fotos o detalles a un pedido abierto (si el número está vinculado a la cuenta de Fixy).
- Al pedir se puede elegir un profesional, pedir presupuestos a varios, o decir cuánto se quiere pagar para que los profesionales se anoten u ofrezcan menos.
- La dirección la ve solo Fixy: el profesional la recibe cuando se confirma la visita.
- Se paga dentro de Fixy con Mercado Pago. Nada se cobra sin aprobación del cliente. Fixy suma un cargo de servicio del 10 %. Algunas visitas tienen costo y muchos profesionales lo descuentan si se contrata el arreglo.
- Los pedidos se siguen también en la web, en "Mis pedidos".
- Para hablar con una persona del equipo: ${SUPPORT_EMAIL}.`;

const Schema = z.object({
  kind: z.enum(["data", "question", "status", "add_details", "new_request", "human", "greeting"]),
  answer: z.string().nullable().describe("Solo si kind es question o greeting: respuesta breve (máx. 3 oraciones), en voseo rioplatense."),
  requestCode: z.string().nullable().describe("Código del pedido al que se refiere (ej. S-1024) si se puede deducir."),
});

const QUESTION_START = /^(puedo|podes|podria|se puede|como|sabes|sabe|que|cual|cuanto|cuanta|donde|cuando|hay|tienen|tenes|es posible|me podes|me podrias|necesito saber|quiero saber|y si|por que|porque)\b/;

/** ¿Parece una pregunta o un comentario sobre el servicio, más que el dato que pedimos? */
export function looksLikeQuestion(text: string): boolean {
  const t = norm(text);
  return t.includes("?") || QUESTION_START.test(t);
}

/** ¿Parece una dirección? Calle con altura, o un texto corto que no es una pregunta. */
export function looksLikeAddress(text: string): boolean {
  const t = text.trim();
  if (!t || looksLikeQuestion(t) || t.length > 160) return false;
  if (/[a-záéíóúñ]{3,}.*\b\d{1,5}\b/i.test(t)) return true; // "Av. Cabildo 2000", "Paraná 1234, Escobar"
  return t.split(/\s+/).length <= 6; // "Palermo", "Escobar centro", "Barrio Los Álamos, Pilar"
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^[¿¡\s]+/, "").trim();

export async function understand(text: string, c: { expecting: Expecting; open: OpenRequest[]; linked: boolean; draftTitle?: string | null }): Promise<Understood> {
  const fallback = byRules(text, c);
  const e = env();
  if (!e.ANTHROPIC_API_KEY || e.ASSISTANT_PROVIDER !== "claude") return fallback;
  try {
    const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: Math.min(e.ASSISTANT_TIMEOUT_MS, 9000), maxRetries: 0 });
    const requests = c.open.length ? c.open.map((o) => `- ${o.code}: ${o.title}`).join("\n") : "(no tiene pedidos abiertos)";
    const r = await client.messages.parse({
      model: e.ASSISTANT_MODEL,
      max_tokens: 400,
      output_config: { format: zodOutputFormat(Schema), effort: "low" },
      system: `Sos el asistente de WhatsApp de Fixy (Argentina). Clasificás el último mensaje de la persona y, si es una pregunta, la respondés.
${FACTS}

Estado de la conversación:
- ${EXPECTING_TEXT[c.expecting]}
- WhatsApp vinculado a una cuenta de Fixy: ${c.linked ? "sí" : "no (no podemos ver sus pedidos hasta vincularlo)"}.
- Pedidos abiertos de la persona:
${requests}${c.draftTitle ? `\n- Tiene un pedido armado por WhatsApp que quedó sin enviar: "${c.draftTitle}".` : ""}

Clasificación:
- "data": el mensaje es el dato que le pedimos en este paso.
- "question": pregunta o comentario sobre Fixy, sobre cómo funciona o sobre el propio bot (respondela en "answer").
- "status": quiere saber cómo va un pedido, si hay profesionales, si alguien respondió.
- "add_details": quiere sumar fotos, datos o aclaraciones a un pedido que ya hizo (o pregunta si puede hacerlo).
- "new_request": describe un problema o trabajo nuevo.
- "human": quiere hablar con una persona.
- "greeting": solo saluda o agradece (respondé breve en "answer").
Si pregunta por "mi pedido" y tiene pedidos abiertos, usá esos datos; si no tiene, decí que no ves pedidos abiertos con este número. Nunca inventes estados, precios, fechas ni nombres.`,
      messages: [{ role: "user", content: text.slice(0, 800) }],
    });
    const out = r.parsed_output;
    if (!out) return fallback;
    const match = out.requestCode ? c.open.find((o) => o.code.toUpperCase() === out.requestCode!.toUpperCase()) : null;
    return { kind: out.kind, answer: out.answer?.slice(0, 700) ?? null, requestId: match?.id ?? (c.open.length === 1 ? c.open[0].id : null) };
  } catch {
    return fallback;
  }
}

/** Sin IA: reglas simples. Las preguntas se responden con textos fijos según el tema. */
export function byRules(text: string, c: { expecting: Expecting; open: OpenRequest[] }): Understood {
  const t = norm(text);
  const single = c.open.length === 1 ? c.open[0].id : null;
  const rule = intentByRules(text);
  if (rule === "greeting") return { kind: "greeting", answer: null, requestId: null };
  if (rule === "add_details" && (looksLikeQuestion(text) || c.expecting === "nothing")) return { kind: "add_details", answer: null, requestId: single };
  if (rule === "status" && (looksLikeQuestion(text) || c.expecting === "nothing")) return { kind: "status", answer: null, requestId: single };
  if (looksLikeQuestion(text)) return { kind: "question", answer: cannedAnswer(t), requestId: single };
  if (c.expecting === "nothing") return { kind: text.trim().length >= 12 ? "new_request" : "greeting", answer: null, requestId: null };
  return { kind: "data", answer: null, requestId: null };
}

function cannedAnswer(t: string): string {
  if (/(pag|cobr|precio|cuesta|sale|tarjeta|mercado ?pago|comision|cargo)/.test(t)) {
    return "Se paga dentro de Fixy con Mercado Pago y nada se cobra sin tu aprobación. Fixy suma un cargo de servicio del 10 %. Algunas visitas tienen costo y muchos profesionales lo descuentan si contratás el arreglo.";
  }
  if (/(direccion|domicilio|seguro|privacidad|datos)/.test(t)) {
    return "Tu dirección la ve solo Fixy: el profesional la recibe recién cuando se confirma la visita.";
  }
  if (/(obra|grande|edificio|consorcio|empresa|remodel|refacc)/.test(t)) {
    return `Sí, también hacemos trabajos grandes y obras: escribinos a ${SUPPORT_EMAIL} con tu proyecto y te acercamos a los mejores profesionales.`;
  }
  if (/(zona|cubren|llegan|donde trabajan)/.test(t)) return "Trabajamos en CABA y GBA. Contame dónde es y te muestro quiénes pueden ir.";
  return `Te ayudo por acá a hacer un pedido, ver cómo van tus pedidos o sumarles fotos y detalles. Para hablar con una persona del equipo, escribinos a ${SUPPORT_EMAIL}.`;
}

/** "50.000", "$ 50000", "50 mil", "50k", "1,5 millones" → centavos. null si no se entiende. */
export function parseBudget(text: string): number | null {
  const t = norm(text).replace(/\$|ars|pesos?/g, "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(mil|k|millon(?:es)?|palos?|lucas?)?$/);
  if (!m) return null;
  let n = Number(m[1].replace(/[.\s]/g, "")) + (m[2] ? Number(`0.${m[2]}`) : 0);
  const unit = m[3] ?? "";
  if (/^(mil|k|lucas?)$/.test(unit)) n *= 1000;
  if (/^(millon|palo)/.test(unit)) n *= 1_000_000;
  const minor = Math.round(n * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? minor : null;
}
