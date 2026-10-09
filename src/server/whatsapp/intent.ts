/**
 * Qué quiere la persona cuando escribe y ya tiene pedidos abiertos: ¿un pedido nuevo, sumar fotos o detalles
 * a uno existente, o saber cómo va? Con IA si está configurada (salida estructurada) y, si no, con reglas.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { env } from "@/server/env";

export type Intent = "new_request" | "add_details" | "status" | "greeting" | "other";
export type OpenRequest = { id: string; code: string; title: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function intentByRules(text: string): Intent {
  const t = norm(text);
  if (!t) return "other";
  if (/^(hola|holis|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey|que tal)[\s!.,]*$/.test(t)) return "greeting";
  if (/(agreg|sum(o|ar)|adjunt|subir|mand(o|ar) (una |unas )?foto|foto(s)? (del|de mi|para (el|mi)) pedido|mas detalle|otro dato|me olvide|cambi(o|ar) (algo|la descripcion))/.test(t)) return "add_details";
  if (/(novedad|como va|como viene|estado|encontr|candidat|alguien|respond|acept|ya hay|que paso con|seguimiento|cuando (viene|llega)|mis? pedidos?)/.test(t)) return "status";
  if (t.length >= 12) return "new_request";
  return "other";
}

const Schema = z.object({
  intent: z.enum(["new_request", "add_details", "status", "greeting", "other"]),
  requestCode: z.string().nullable().describe("Código del pedido al que se refiere (ej. S-1024) si se puede deducir; si no, null."),
});

export async function classifyIntent(text: string, open: OpenRequest[]): Promise<{ intent: Intent; requestId: string | null }> {
  const rules = intentByRules(text);
  const e = env();
  if (!e.ANTHROPIC_API_KEY || e.ASSISTANT_PROVIDER !== "claude" || text.trim().length < 4) return { intent: rules, requestId: open.length === 1 ? open[0].id : null };
  try {
    const client = new Anthropic({ apiKey: e.ANTHROPIC_API_KEY, timeout: Math.min(e.ASSISTANT_TIMEOUT_MS, 8000), maxRetries: 0 });
    const r = await client.messages.parse({
      model: e.ASSISTANT_MODEL,
      max_tokens: 300,
      output_config: { format: zodOutputFormat(Schema), effort: "low" },
      system: `Sos el asistente de WhatsApp de Fixy (servicios para el hogar en Argentina). El cliente ya tiene estos pedidos abiertos:
${open.map((o) => `- ${o.code}: ${o.title}`).join("\n")}
Clasificá su mensaje:
- "new_request": describe un problema o trabajo NUEVO.
- "add_details": quiere sumar fotos, datos o aclaraciones a un pedido existente.
- "status": pregunta cómo va un pedido, si hay profesionales, si alguien aceptó, cuándo vienen.
- "greeting": solo saluda.
- "other": otra cosa.
Si se refiere a un pedido en particular, indicá su código.`,
      messages: [{ role: "user", content: text.slice(0, 600) }],
    });
    const out = r.parsed_output;
    if (!out) return { intent: rules, requestId: null };
    const match = out.requestCode ? open.find((o) => o.code.toUpperCase() === out.requestCode!.toUpperCase()) : null;
    return { intent: out.intent, requestId: match?.id ?? (open.length === 1 ? open[0].id : null) };
  } catch {
    return { intent: rules, requestId: open.length === 1 ? open[0].id : null };
  }
}
