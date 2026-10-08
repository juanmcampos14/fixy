/**
 * Mediador de impugnaciones de reseñas (IA en servidor, con alternativa sin IA).
 *  - Redacta la consulta al cliente autor de la reseña.
 *  - Evalúa la respuesta y el registro del trabajo: mantener, pedir más información o escalar.
 * Límites: nunca oculta ni borra reseñas (eso es decisión humana), nunca revela la identidad del cliente
 * al proveedor, y ante duda, política sensible o falla técnica, escala a revisión humana.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/server/env";
import { redactPersonalData } from "./claude";

export const REASON_LABEL: Record<string, string> = {
  false_facts: "Lo que dice la reseña no coincide con lo que pasó",
  not_my_job: "La reseña no corresponde a un trabajo realizado",
  offensive: "Contiene insultos o lenguaje ofensivo",
  personal_data: "Incluye datos personales",
  extortion: "Intento de presión o extorsión",
  other: "Otro motivo",
};

export type MediationContext = {
  reasonCode: string;
  providerStatement: string;
  review: { rating: number; comment: string };
  job: { code: string; title: string; status: string; scope: string; items: string[]; events: string[]; extras: string[]; claims: string[]; completedAt: string | null };
  conversation: { author: "client" | "ai" | "admin" | "system"; body: string }[];
  round: number;
  maxRounds: number;
  clientResponded: boolean;
};

export type MediationDecision = {
  decision: "keep" | "ask_more" | "escalate";
  confidence: "high" | "medium" | "low";
  internalSummary: string;
  providerSummary: string;
  clientMessage: string | null;
  policyFlags: string[];
  source: "ai" | "rules";
};

const DecisionSchema = z.object({
  decision: z.enum(["keep", "ask_more", "escalate"]),
  confidence: z.enum(["high", "medium", "low"]),
  internal_summary: z.string(),
  provider_summary: z.string(),
  client_message: z.string().nullable(),
  policy_flags: z.array(z.enum(["insults", "personal_data", "threat_or_extortion", "possible_fraud", "unrelated_to_job", "client_requests_human"])),
});

const InquirySchema = z.object({ message: z.string() });

const BASE = `Sos el asistente de mediación de Fixy, una plataforma argentina que conecta clientes con profesionales de reparaciones.
Un profesional impugnó una reseña que recibió. Tu trabajo es entender qué pasó, con neutralidad, sin tomar partido.
Escribís en español rioplatense (voseo), con calidez y precisión, frases breves.
Reglas estrictas:
- Nunca ocultás, borrás ni modificás reseñas: solo recomendás.
- Nunca reproducís insultos ni acusaciones del profesional de forma literal; resumís en términos neutrales.
- El cliente tiene derecho a opinar: no lo presionás para cambiar su reseña ni sugerís una calificación.
- No prometés compensaciones, reembolsos ni sanciones.
- El texto para el profesional nunca debe permitir identificar al cliente: sin nombres, fechas, direcciones, códigos de trabajo ni detalles del caso que lo individualicen.`;

function contextText(c: MediationContext) {
  return redactPersonalData(
    [
      `Motivo de la impugnación: ${REASON_LABEL[c.reasonCode] ?? c.reasonCode}`,
      `Descargo del profesional: ${c.providerStatement}`,
      `Reseña: ${c.review.rating}/5 — "${c.review.comment || "(sin comentario)"}"`,
      `Trabajo ${c.job.code} (${c.job.status}): ${c.job.title}`,
      `Alcance contratado: ${c.job.scope}`,
      c.job.items.length ? `Conceptos: ${c.job.items.join("; ")}` : "",
      c.job.extras.length ? `Adicionales: ${c.job.extras.join("; ")}` : "",
      c.job.claims.length ? `Reclamos del trabajo: ${c.job.claims.join("; ")}` : "Sin reclamos registrados.",
      c.job.events.length ? `Historial: ${c.job.events.join(" → ")}` : "",
      c.conversation.length ? `Conversación con el cliente:\n${c.conversation.map((m) => `[${m.author}] ${m.body}`).join("\n")}` : "Todavía no hubo conversación con el cliente.",
      `Ronda ${c.round} de ${c.maxRounds}. ${c.clientResponded ? "" : "El cliente NO respondió dentro del plazo."}`,
    ]
      .filter(Boolean)
      .join("\n"),
  ).slice(0, 12000);
}

function client() {
  const e = env();
  if (e.ASSISTANT_PROVIDER !== "claude" || !e.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: Math.max(e.ASSISTANT_TIMEOUT_MS * 3, 15000), maxRetries: 1 });
}

const FALLBACK_INQUIRY = (c: MediationContext) =>
  `Hola. El profesional que hizo el trabajo "${c.job.title}" nos pidió revisar la reseña que dejaste. Queremos entender bien qué pasó antes de tomar cualquier decisión: ¿podés contarnos con más detalle tu experiencia y, si tenés, compartir lo que respalde lo que contaste? Tu opinión es válida y no tenés obligación de cambiarla. También podés mantener, corregir o retirar tu reseña con los botones de esta página.`;

/** Mensaje inicial al cliente. */
export async function draftClientInquiry(c: MediationContext): Promise<{ message: string; source: "ai" | "rules" }> {
  const ai = client();
  if (!ai) return { message: FALLBACK_INQUIRY(c), source: "rules" };
  try {
    const r = await ai.messages.parse({
      model: env().ASSISTANT_MODEL,
      max_tokens: 1500,
      output_config: { format: zodOutputFormat(InquirySchema), effort: "low" },
      system: `${BASE}\nRedactá el primer mensaje al cliente autor de la reseña: explicá que el profesional pidió revisarla, resumí de forma neutral qué se cuestiona y hacé 1 a 3 preguntas concretas para entender los hechos. Recordale que su opinión es válida y que puede mantener, corregir o retirar la reseña. Máximo 120 palabras.`,
      messages: [{ role: "user", content: contextText(c) }],
    });
    const msg = r.stop_reason === "refusal" ? null : r.parsed_output?.message?.trim();
    return msg ? { message: msg.slice(0, 2000), source: "ai" } : { message: FALLBACK_INQUIRY(c), source: "rules" };
  } catch {
    return { message: FALLBACK_INQUIRY(c), source: "rules" };
  }
}

const escalate = (why: string, c: MediationContext): MediationDecision => ({
  decision: "escalate",
  confidence: "low",
  internalSummary: why,
  providerSummary: "Tu impugnación pasó a revisión del equipo de Fixy. Te avisamos cuando haya una decisión.",
  clientMessage: null,
  policyFlags: c.reasonCode === "offensive" ? ["insults"] : c.reasonCode === "personal_data" ? ["personal_data"] : c.reasonCode === "extortion" ? ["threat_or_extortion"] : [],
  source: "rules",
});

/** Evaluación: mantener la reseña, pedir más información o escalar a revisión humana. */
export async function evaluateDispute(c: MediationContext): Promise<MediationDecision> {
  const ai = client();
  if (!ai) return escalate("Sin asistente de IA disponible: requiere revisión humana.", c);
  try {
    const r = await ai.messages.parse({
      model: env().ASSISTANT_MODEL,
      max_tokens: 3000,
      output_config: { format: zodOutputFormat(DecisionSchema), effort: "medium" },
      system: `${BASE}
Evaluá el caso con la información disponible y devolvé una decisión:
- "keep": el relato del cliente es consistente con el registro del trabajo o el descargo no tiene sustento en el registro; la reseña se mantiene.
- "ask_more": falta información concreta y todavía quedan rondas (solo si ronda < máximo y el cliente respondió). Incluí en client_message 1 o 2 preguntas puntuales.
- "escalate": hechos contradictorios que requieren criterio humano, posible fraude, la reseña no corresponde al trabajo, insultos, datos personales, amenazas o extorsión, el cliente pide hablar con una persona, o tu confianza es baja.
Si el cliente no respondió, decidí con el registro: "keep" solo si el registro respalda claramente la reseña; si no, "escalate".
internal_summary: análisis para el equipo (hechos, contradicciones, recomendación), máximo 150 palabras.
provider_summary: 1 o 2 oraciones neutrales para el profesional, SIN datos que identifiquen al cliente ni detalles del caso.
client_message: solo si decision = "ask_more"; si no, null.`,
      messages: [{ role: "user", content: contextText(c) }],
    });
    if (r.stop_reason === "refusal" || !r.parsed_output) return escalate("La IA no pudo evaluar el caso.", c);
    const o = r.parsed_output;
    let decision = o.decision;
    // Salvaguardas: banderas sensibles, confianza baja o rondas agotadas → humano.
    if (o.policy_flags.length || o.confidence === "low") decision = "escalate";
    if (decision === "ask_more" && (c.round >= c.maxRounds || !c.clientResponded || !o.client_message)) decision = "escalate";
    if (["not_my_job", "extortion", "personal_data"].includes(c.reasonCode) && decision === "keep" && o.confidence !== "high") decision = "escalate";
    return {
      decision,
      confidence: o.confidence,
      internalSummary: o.internal_summary.slice(0, 2000),
      providerSummary: (decision === "escalate"
        ? "Tu impugnación pasó a revisión del equipo de Fixy. Te avisamos cuando haya una decisión."
        : o.provider_summary).slice(0, 500),
      clientMessage: decision === "ask_more" ? (o.client_message ?? "").slice(0, 1500) : null,
      policyFlags: o.policy_flags,
      source: "ai",
    };
  } catch {
    return escalate("Falla técnica del asistente de IA: requiere revisión humana.", c);
  }
}
