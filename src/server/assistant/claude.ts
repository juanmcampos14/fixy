/**
 * Adaptador OPCIONAL de IA (Claude) para sugerir la categoría de un pedido.
 * - Solo se ejecuta en el servidor (ANTHROPIC_API_KEY nunca llega al navegador).
 * - Salida estructurada validada con Zod; categoría restringida a slugs existentes.
 * - Límites: timeout configurable, sin reintentos, max_tokens acotado, texto truncado.
 * - Minimización de datos: se eliminan emails, teléfonos y números largos antes de enviar.
 * - Ante cualquier falla devuelve null y el sistema usa el asistente por reglas.
 * - No genera diagnósticos, precios ni disponibilidad: solo clasifica.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/server/env";
import { CATEGORIES } from "@/server/seed/base";
import type { TriageResult } from "./rules";

// Los rubros salen del catálogo base: al sumar uno ahí, el asistente ya lo puede elegir.
const SLUGS = CATEGORIES.map((c) => c.slug) as [string, ...string[]];

const OutputSchema = z.object({
  category: z.enum(SLUGS),
  confidence: z.enum(["high", "medium", "low"]),
  title: z.string(),
  urgency: z.enum(["flexible", "normal", "soon", "urgent"]),
});

export function redactPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/(\+?\d[\d\s-]{6,}\d)/g, "[número]")
    .slice(0, 1200);
}

const SYSTEM = `Clasificás pedidos de reparación, instalación o mantenimiento para hogares y oficinas en Argentina.
Elegí la categoría de profesional más adecuada entre las permitidas:
${CATEGORIES.filter((c) => c.slug !== "otro").map((c) => `- ${c.slug}: ${c.description}`).join("\n")}
 Si el pedido es ambiguo o no encaja, usá "otro" con confianza "low".
Proponé un título breve (máximo 80 caracteres) en español rioplatense y una urgencia según lo descripto.
No hagas diagnósticos, no estimes precios y no prometas disponibilidad.`;

export async function triageWithClaude(text: string): Promise<Partial<TriageResult> | null> {
  const e = env();
  const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: e.ASSISTANT_TIMEOUT_MS, maxRetries: 0 });
  try {
    const response = await client.messages.parse({
      model: e.ASSISTANT_MODEL,
      max_tokens: 1024,
      output_config: { format: zodOutputFormat(OutputSchema), effort: "low" },
      system: SYSTEM,
      messages: [{ role: "user", content: redactPersonalData(text) }],
    });
    if (response.stop_reason === "refusal") return null;
    const out = response.parsed_output;
    if (!out) return null;
    const needsReview = out.category === "otro" || out.confidence === "low";
    return {
      categorySlug: needsReview && out.category !== "otro" ? null : out.category,
      confidence: out.confidence,
      suggestedTitle: out.title.slice(0, 120),
      suggestedUrgency: out.urgency,
      needsReview,
      reviewReason: needsReview ? "El asistente no tiene suficiente certeza: lo revisa una persona del equipo." : null,
    };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.warn(`[asistente] Claude no disponible (${err.status ?? "red"}); se usan reglas.`);
    return null;
  }
}
