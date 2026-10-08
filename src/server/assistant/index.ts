import { env } from "@/server/env";
import { triageByRules, type TriageResult } from "./rules";

/**
 * Punto de entrada del asistente. Por defecto usa reglas (sin servicios externos).
 * Con ASSISTANT_PROVIDER=claude intenta el adaptador de IA y, ante cualquier falla, vuelve a las reglas.
 */
export async function triage(text: string, explicitCategory?: string | null): Promise<TriageResult> {
  const rules = triageByRules(text, explicitCategory);
  if (env().ASSISTANT_PROVIDER !== "claude" || !env().ANTHROPIC_API_KEY || explicitCategory) return rules;
  try {
    const { triageWithClaude } = await import("./claude");
    const ai = await triageWithClaude(text);
    if (!ai) return rules;
    // La seguridad la decide siempre la regla local (más conservadora); la IA solo mejora la categoría.
    return { ...rules, ...ai, safety: rules.safety, source: "ai" };
  } catch {
    return rules;
  }
}
