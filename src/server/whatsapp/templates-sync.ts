/**
 * Mantiene creadas en Meta las plantillas de WhatsApp que usa Fixy, sin que nadie tenga que entrar a un panel.
 * Corre con las tareas programadas: si falta alguna (por ejemplo, después de sumar una nueva), la manda a revisión.
 * El resultado queda en `platform_settings` para verlo desde Operación.
 */
import { createHash } from "node:crypto";
import { sql } from "@/server/db/client";
import { createTemplate, listTemplates } from "./client";
import { WA_LANGUAGE, WA_TEMPLATES, templateDefinition, type WaTemplateKey } from "./templates";

const KEY = "whatsapp.templates_sync";
type SyncState = { hash: string; ok: boolean; at: string; results: string[] };

const wanted = () => createHash("sha256").update(JSON.stringify(Object.values(WA_TEMPLATES).map((t) => [t.name, t.body]))).digest("hex").slice(0, 16);

/** Crea en Meta las plantillas que falten. Devuelve qué pasó con cada una. */
export async function createMissingTemplates(): Promise<{ ok: boolean; results: string[] }> {
  const existing = await listTemplates();
  if (!existing) return { ok: false, results: ["No se pudo consultar a Meta: falta WHATSAPP_WABA_ID o el token no tiene permiso para plantillas."] };
  const results: string[] = [];
  let ok = true;
  for (const key of Object.keys(WA_TEMPLATES) as WaTemplateKey[]) {
    const t = WA_TEMPLATES[key];
    const found = existing.find((r) => r.name === t.name && r.language === WA_LANGUAGE);
    if (found) { results.push(`${t.name}: ${found.status} · ${found.category ?? "sin categoría"}`); continue; }
    const r = await createTemplate(templateDefinition(key));
    if (!r.ok) ok = false;
    results.push(r.ok ? `${t.name}: enviada a revisión` : `${t.name}: ${r.error}`);
  }
  return { ok, results };
}

/** Para las tareas programadas: solo actúa si cambió la lista de plantillas o si el último intento falló hace más de una hora. */
export async function syncWhatsAppTemplates(): Promise<"skipped" | "ok" | "failed"> {
  const hash = wanted();
  const [row] = await sql()<{ value: SyncState }[]>`select value from platform_settings where key = ${KEY}`;
  const last = row?.value;
  if (last?.hash === hash && (last.ok || Date.now() - new Date(last.at).getTime() < 3600_000)) return "skipped";
  const r = await createMissingTemplates();
  const state: SyncState = { hash, ok: r.ok, at: new Date().toISOString(), results: r.results };
  await sql()`insert into platform_settings (key, value) values (${KEY}, ${sql().json(state as never)})
    on conflict (key) do update set value = excluded.value, updated_at = now()`;
  return r.ok ? "ok" : "failed";
}
