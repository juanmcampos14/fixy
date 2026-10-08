/**
 * Interpreta el reglamento de ingreso de un barrio cerrado (PDF, imagen, link o texto) con Claude
 * y devuelve una lista de requisitos para el profesional.
 * - Solo servidor. Salida estructurada validada con Zod.
 * - El resultado NO puede incluir datos que ubiquen la propiedad (nombre del barrio, lote, calle) ni contactos:
 *   se le pide al modelo y además se enmascaran teléfonos/emails/links antes de guardar.
 * - Los links los descarga Anthropic (herramienta web_fetch), no nuestro servidor: evita SSRF.
 * - Sin clave o ante falla devuelve null y la propiedad queda con "requisitos no interpretados".
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/server/env";
import { maskContactInfo } from "@/server/domain/contact-guard";

export const REQUIREMENT_KINDS = [
  "liability_insurance", "art_insurance", "life_insurance", "no_repetition_clause", "vehicle_insurance",
  "vehicle_registration", "driver_license", "id_document", "preregistration", "background_check", "schedule", "tools_rules", "other",
] as const;

export const REQUIREMENT_KIND_LABEL: Record<(typeof REQUIREMENT_KINDS)[number], string> = {
  liability_insurance: "Seguro de responsabilidad civil",
  art_insurance: "ART / accidentes personales",
  life_insurance: "Seguro de vida",
  no_repetition_clause: "Cláusula de no repetición",
  vehicle_insurance: "Seguro del vehículo",
  vehicle_registration: "Cédula / documentación del vehículo",
  driver_license: "Licencia de conducir",
  id_document: "DNI",
  preregistration: "Alta previa en el barrio",
  background_check: "Certificado de antecedentes",
  schedule: "Horarios permitidos",
  tools_rules: "Reglas de obra y herramientas",
  other: "Otro requisito",
};

export const AccessRequirementsSchema = z.object({
  summary: z.string().describe("Resumen en 1-2 oraciones de lo que necesita un profesional para entrar."),
  requirements: z.array(z.object({
    kind: z.enum(REQUIREMENT_KINDS),
    title: z.string().describe("Requisito concreto y breve."),
    detail: z.string().describe("Detalle práctico: montos mínimos, a nombre de quién, vigencia, cómo presentarlo. Vacío si no aplica."),
    appliesTo: z.enum(["person", "vehicle", "company", "all"]),
    mandatory: z.boolean(),
  })),
  allowedHours: z.string().describe("Días y horarios permitidos para trabajos o ingreso de contratistas. Vacío si no figura."),
  howToRegister: z.string().describe("Cómo se gestiona el ingreso (alta previa, app del barrio, guardia) sin datos de contacto. Vacío si no figura."),
  missingInfo: z.array(z.string()).describe("Dudas o datos que el documento no aclara y conviene confirmar."),
  confidence: z.enum(["high", "medium", "low"]),
});
export type AccessRequirements = z.infer<typeof AccessRequirementsSchema>;

const SYSTEM = `Ayudás a profesionales de oficios (plomeros, electricistas, pintores, etc.) a entrar sin problemas a barrios cerrados y countries de Argentina.
Te pasan el reglamento o las condiciones de ingreso de contratistas/proveedores de un barrio. Extraé SOLO lo que un profesional necesita tener o cumplir para entrar a trabajar:
seguros (responsabilidad civil, ART, accidentes personales, vida) con sus montos mínimos, cláusula de no repetición y a favor de quién debe estar (escribí "a favor del barrio/administración" sin el nombre propio),
documentación de la persona y del vehículo, alta previa o pre-autorización, horarios permitidos, reglas de obra (ruidos, herramientas, materiales, vestimenta) y cualquier otra exigencia.
Reglas estrictas:
- No incluyas el nombre del barrio, direcciones, lotes, nombres de personas, teléfonos, emails ni links: la ubicación de la propiedad es privada.
- No inventes requisitos. Si algo es ambiguo, ponelo en missingInfo.
- Si el contenido no es un reglamento de ingreso, devolvé requirements vacío, confidence "low" y explicalo en summary.
- Escribí en español rioplatense, claro y concreto.`;

export type RulesSource =
  | { kind: "file"; data: Buffer; mime: string }
  | { kind: "url"; url: string }
  | { kind: "text"; text: string };

function clean(s: string, max: number) {
  return maskContactInfo(s).text.replace(/https?:\/\/\S+/gi, "").trim().slice(0, max);
}

/** Limpieza defensiva: aunque el modelo siga las reglas, nunca guardamos contactos ni links. */
export function sanitizeRequirements(r: AccessRequirements): AccessRequirements {
  return {
    summary: clean(r.summary, 600),
    requirements: r.requirements.slice(0, 30).map((q) => ({ ...q, title: clean(q.title, 160), detail: clean(q.detail, 600) })).filter((q) => q.title),
    allowedHours: clean(r.allowedHours, 400),
    howToRegister: clean(r.howToRegister, 600),
    missingInfo: r.missingInfo.slice(0, 10).map((m) => clean(m, 300)).filter(Boolean),
    confidence: r.confidence,
  };
}

export function accessRulesAvailable() {
  return !!env().ANTHROPIC_API_KEY;
}

export async function interpretAccessRules(source: RulesSource, extraNotes?: string): Promise<AccessRequirements | null> {
  const e = env();
  if (!e.ANTHROPIC_API_KEY) return null;
  const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: 90_000, maxRetries: 1 });

  const content: Anthropic.ContentBlockParam[] = [];
  if (source.kind === "file") {
    content.push(source.mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: source.data.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: source.mime as "image/jpeg" | "image/png" | "image/webp", data: source.data.toString("base64") } });
    content.push({ type: "text", text: "Este es el reglamento o las condiciones de ingreso del barrio." });
  } else if (source.kind === "url") {
    content.push({ type: "text", text: `Leé las condiciones de ingreso del barrio en este link (usá web_fetch): ${source.url}` });
  } else {
    content.push({ type: "text", text: `Condiciones de ingreso del barrio:\n\n${source.text.slice(0, 20000)}` });
  }
  if (extraNotes?.trim()) content.push({ type: "text", text: `Aclaraciones del propietario:\n${extraNotes.slice(0, 2000)}` });

  const messages: Anthropic.MessageParam[] = [{ role: "user", content }];
  try {
    for (let turn = 0; turn < 3; turn++) {
      const response = await client.messages.parse({
        model: e.ASSISTANT_MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { format: zodOutputFormat(AccessRequirementsSchema), effort: "medium" },
        system: SYSTEM,
        messages,
        ...(source.kind === "url" ? { tools: [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }] } : {}),
      });
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      if (response.stop_reason === "refusal" || !response.parsed_output) return null;
      return sanitizeRequirements(response.parsed_output);
    }
    return null;
  } catch (err) {
    console.warn(`[barrio] no se pudo interpretar el reglamento (${err instanceof Anthropic.APIError ? err.status ?? "red" : "error"})`);
    return null;
  }
}
