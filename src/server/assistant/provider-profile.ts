/**
 * Arma un borrador de perfil de profesional a partir de lo que cuenta con sus palabras.
 * - Solo servidor. Salida estructurada; rubros y zonas restringidos al catálogo real.
 * - No inventa precios: solo los toma si la persona los mencionó.
 * - Es un borrador: la persona revisa y confirma todo antes de guardar.
 * - Sin clave o ante falla devuelve null y el alta sigue a mano.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/server/env";
import { maskContactInfo } from "@/server/domain/contact-guard";

export const AVAILABILITY_PRESETS = {
  weekdays: { label: "Lunes a viernes, 8 a 18 h", days: [1, 2, 3, 4, 5], start: 8 * 60, end: 18 * 60 },
  weekdays_sat: { label: "Lunes a sábado, 8 a 18 h", days: [1, 2, 3, 4, 5, 6], start: 8 * 60, end: 18 * 60 },
  every_day: { label: "Todos los días, 8 a 20 h", days: [0, 1, 2, 3, 4, 5, 6], start: 8 * 60, end: 20 * 60 },
  evenings: { label: "Lunes a viernes, 17 a 21 h", days: [1, 2, 3, 4, 5], start: 17 * 60, end: 21 * 60 },
} as const;
export type AvailabilityPreset = keyof typeof AVAILABILITY_PRESETS;

export type ProfileDraft = {
  displayName: string;
  description: string;
  yearsExperience: number | null;
  categorySlugs: string[];
  zoneCodes: string[];
  baseZoneCode: string | null;
  priceRefs: { categorySlug: string; title: string; fromPesos: number }[];
  availability: AvailabilityPreset | null;
  tips: string[];
};

export function profileAssistantAvailable() {
  return !!env().ANTHROPIC_API_KEY;
}

export async function draftProviderProfile(
  text: string,
  ctx: { kind: "individual" | "company"; name: string; categories: { slug: string; name: string }[]; zones: { code: string; name: string; region: string }[] },
): Promise<ProfileDraft | null> {
  const e = env();
  if (!e.ANTHROPIC_API_KEY || ctx.categories.length === 0 || ctx.zones.length === 0) return null;
  const slugs = ctx.categories.map((c) => c.slug) as [string, ...string[]];
  const codes = ctx.zones.map((z) => z.code) as [string, ...string[]];
  const presets = Object.keys(AVAILABILITY_PRESETS) as [AvailabilityPreset, ...AvailabilityPreset[]];
  const Schema = z.object({
    displayName: z.string().describe("Nombre comercial sugerido. Si la persona dio uno, usalo tal cual."),
    description: z.string().describe("Descripción pública de 3 a 5 oraciones, en primera persona, clara y profesional, sin teléfonos, emails, redes ni direcciones."),
    yearsExperience: z.number().int().nullable(),
    categorySlugs: z.array(z.enum(slugs)),
    zoneCodes: z.array(z.enum(codes)),
    baseZoneCode: z.enum(codes).nullable(),
    priceRefs: z.array(z.object({ categorySlug: z.enum(slugs), title: z.string(), fromPesos: z.number().int() }))
      .describe("SOLO precios que la persona mencionó explícitamente. Si no mencionó ninguno, lista vacía."),
    availability: z.enum(presets).nullable(),
    tips: z.array(z.string()).describe("Hasta 3 sugerencias concretas para completar el perfil (qué fotos subir, qué aclarar)."),
  });

  const system = `Ayudás a profesionales de oficios de Argentina a crear su perfil en Fixy, un marketplace de servicios para hogares y oficinas.
Te cuentan con sus palabras qué hacen. Armá un borrador de perfil fiel a lo que dijeron:
- Rubros: elegí solo los del catálogo que correspondan a lo que hacen.
- Zonas: mapeá barrios y partidos mencionados a los códigos del catálogo. Si dicen "zona norte", "zona oeste", "zona sur" o "capital", incluí las zonas de esa región. Si no mencionan zonas, dejá la lista vacía.
- Precios: nunca inventes. Solo los que dijeron, en pesos argentinos enteros.
- Disponibilidad: elegí el preset más parecido a lo que contaron, o null si no dijeron nada.
- Descripción: ${ctx.kind === "company" ? "en primera persona del plural (somos…)" : "en primera persona (soy…, hago…)"}, español rioplatense, sin exagerar ni prometer garantías que no mencionaron.
Catálogo de rubros: ${ctx.categories.map((c) => `${c.slug} (${c.name})`).join(", ")}.
Catálogo de zonas: ${ctx.zones.map((z) => `${z.code} (${z.name}, ${z.region})`).join(", ")}.`;

  const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: 45_000, maxRetries: 1 });
  try {
    const response = await client.messages.parse({
      model: e.ASSISTANT_MODEL,
      max_tokens: 4000,
      output_config: { format: zodOutputFormat(Schema), effort: "low" },
      system,
      messages: [{ role: "user", content: `Nombre: ${ctx.name || "(sin nombre)"}\nTipo: ${ctx.kind === "company" ? "empresa" : "independiente"}\n\n${text.slice(0, 3000)}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) return null;
    const o = response.parsed_output;
    const mask = (s: string) => maskContactInfo(s).text.replace(/https?:\/\/\S+/gi, "").trim();
    const cats = [...new Set(o.categorySlugs)];
    return {
      displayName: mask(o.displayName).slice(0, 120),
      description: mask(o.description).slice(0, 2000),
      yearsExperience: o.yearsExperience != null && o.yearsExperience >= 0 && o.yearsExperience <= 80 ? o.yearsExperience : null,
      categorySlugs: cats,
      zoneCodes: [...new Set(o.zoneCodes)],
      baseZoneCode: o.baseZoneCode,
      priceRefs: o.priceRefs.filter((p) => cats.includes(p.categorySlug) && p.fromPesos > 0 && p.fromPesos < 100_000_000).slice(0, 8)
        .map((p) => ({ ...p, title: mask(p.title).slice(0, 120) })),
      availability: o.availability,
      tips: o.tips.slice(0, 3).map(mask),
    };
  } catch (err) {
    console.warn(`[alta] no se pudo armar el borrador (${err instanceof Anthropic.APIError ? err.status ?? "red" : "error"})`);
    return null;
  }
}
