/**
 * Kommo como bandeja de la captación por WhatsApp: cada invitación deja al profesional como lead en el embudo
 * «Captación Fixy» (las respuestas al número comercial caen en ese lead, con nombre, oficio y zona). El equipo lo mueve
 * de etapa en Kommo y Fixy lo lee: «Respondió» o «Interesado» cortan los recordatorios; «No le interesa / Baja» lo marca
 * para no volver a contactarlo. Integración privada con token de larga duración (KOMMO_TOKEN, KOMMO_SUBDOMINIO).
 */
import { env } from "@/server/env";

export const kommoConfigured = () => !!(env().KOMMO_TOKEN && env().KOMMO_SUBDOMINIO);

const base = () => `https://${env().KOMMO_SUBDOMINIO.trim().replace(/^https?:\/\//, "").replace(/\.kommo\.com.*$/, "")}.kommo.com/api/v4`;

async function kommo<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${env().KOMMO_TOKEN}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 204) return {} as T;
  const text = await res.text();
  const j = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const det = j?.["validation-errors"]?.[0]?.errors?.map((e: { path: string; detail: string }) => `${e.path}: ${e.detail}`).join("; ");
    throw new Error(`Kommo ${res.status}: ${det || j?.detail || j?.title || text.slice(0, 200)}`);
  }
  return j as T;
}

export const PIPELINE = "Captación Fixy";
/** Etapas del embudo y qué significan para Fixy. Los colores tienen que ser de la paleta de Kommo (si no, rechaza el embudo). */
export const STAGES = [
  { name: "Invitado", color: "#c1e0ff", meaning: null },
  { name: "Recordatorio", color: "#ffdc7f", meaning: null },
  { name: "Respondió", color: "#87f2c0", meaning: "replied" },
  { name: "Interesado", color: "#deff81", meaning: "interested" },
  { name: "Se registró", color: "#98cbff", meaning: null },
  { name: "No le interesa / Baja", color: "#ffc8c8", meaning: "opt_out" },
] as const;
export type StageMeaning = "replied" | "interested" | "opt_out";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
type Status = { id: number; name: string };
type Pipeline = { id: number; name: string; _embedded: { statuses: Status[] } };

async function pipeline(): Promise<Pipeline | null> {
  const j = await kommo<{ _embedded?: { pipelines?: Pipeline[] } }>("/leads/pipelines");
  return j._embedded?.pipelines?.find((p) => norm(p.name) === norm(PIPELINE)) ?? null;
}

/** Crea el embudo «Captación Fixy» (o le agrega las etapas que falten). No borra nada. */
export async function setupKommoPipeline(): Promise<string[]> {
  const done: string[] = [];
  let p = await pipeline();
  if (!p) {
    await kommo("/leads/pipelines", {
      method: "POST",
      body: [{ name: PIPELINE, is_main: false, is_unsorted_on: true, sort: 30, _embedded: { statuses: STAGES.map((s, i) => ({ name: s.name, sort: (i + 1) * 10, color: s.color })) } }],
    });
    done.push(`Creé el embudo «${PIPELINE}» con sus etapas.`);
    p = await pipeline();
  }
  if (!p) throw new Error("Kommo no devolvió el embudo creado.");
  const missing = STAGES.filter((s) => !p!._embedded.statuses.some((x) => norm(x.name) === norm(s.name)));
  if (missing.length) {
    await kommo(`/leads/pipelines/${p.id}/statuses`, { method: "POST", body: missing.map((s, i) => ({ name: s.name, sort: 100 + i * 10, color: s.color })) });
    done.push(`Agregué las etapas: ${missing.map((s) => s.name).join(", ")}.`);
  }
  if (!done.length) done.push(`El embudo «${PIPELINE}» ya estaba listo.`);
  return done;
}

const stageId = (p: Pipeline, name: string) => p._embedded.statuses.find((s) => norm(s.name) === norm(name))?.id;

/**
 * Registra en Kommo una invitación enviada: crea el lead (con su contacto) en «Invitado», o lo mueve a «Recordatorio»
 * si ya existía, y deja el texto como nota. Devuelve el id del lead.
 */
export async function registerInvitation(p: {
  kommoLeadId: number | null; code: string; name: string; phoneE164: string; trade: string | null; place: string | null; followup: boolean; text: string;
}): Promise<number> {
  const pl = await pipeline();
  if (!pl) throw new Error(`Falta el embudo «${PIPELINE}» en Kommo (Campañas › Requisitos › Armar embudo).`);
  const status = stageId(pl, p.followup ? "Recordatorio" : "Invitado");
  if (!status) throw new Error("Faltan etapas en el embudo de Kommo.");
  let id = p.kommoLeadId;
  if (id) {
    await kommo(`/leads/${id}`, { method: "PATCH", body: { pipeline_id: pl.id, status_id: status } });
  } else {
    const tags = [{ name: "captación" }, ...(p.trade ? [{ name: p.trade.toLowerCase() }] : [])];
    const j = await kommo<{ id: number }[]>("/leads/complex", {
      method: "POST",
      body: [{
        name: `${p.name} (${p.code})`, pipeline_id: pl.id, status_id: status,
        _embedded: { tags, contacts: [{ name: p.name, custom_fields_values: [{ field_code: "PHONE", values: [{ value: `+${p.phoneE164}`, enum_code: "MOB" }] }] }] },
      }],
    });
    id = j[0]?.id ?? null;
    if (!id) throw new Error("Kommo no devolvió el lead creado.");
  }
  await kommo(`/leads/${id}/notes`, {
    method: "POST",
    body: [{ note_type: "common", params: { text: `WhatsApp de Fixy (${p.followup ? "recordatorio" : "invitación"}) · ${p.code}${p.trade ? ` · ${p.trade}` : ""}${p.place ? ` · ${p.place}` : ""}:\n\n${p.text}` } }],
  });
  return id;
}

/** Leads del embudo movidos a «Respondió», «Interesado» o «Baja» en los últimos 60 días, con lo que significa cada uno. */
export async function kommoOutcomes(): Promise<{ leadId: number; meaning: StageMeaning }[]> {
  const pl = await pipeline();
  if (!pl) return [];
  const byStatus = new Map<number, StageMeaning>();
  for (const s of STAGES) {
    const id = s.meaning ? stageId(pl, s.name) : undefined;
    if (id && s.meaning) byStatus.set(id, s.meaning);
  }
  if (!byStatus.size) return [];
  const since = Math.floor(Date.now() / 1000) - 60 * 86400;
  const filter = [...byStatus.keys()].map((id, i) => `filter[statuses][${i}][pipeline_id]=${pl.id}&filter[statuses][${i}][status_id]=${id}`).join("&");
  const out: { leadId: number; meaning: StageMeaning }[] = [];
  for (let page = 1; page <= 20; page++) {
    const j = await kommo<{ _embedded?: { leads?: { id: number; status_id: number }[] } }>(`/leads?${filter}&filter[updated_at][from]=${since}&limit=250&page=${page}`);
    const leads = j._embedded?.leads ?? [];
    for (const l of leads) { const m = byStatus.get(l.status_id); if (m) out.push({ leadId: l.id, meaning: m }); }
    if (leads.length < 250) break;
  }
  return out;
}

/** Mueve a «Se registró» los leads de quienes ya tienen perfil en Fixy. */
export async function markRegisteredInKommo(leadIds: number[]) {
  if (!leadIds.length) return 0;
  const pl = await pipeline();
  const status = pl && stageId(pl, "Se registró");
  if (!pl || !status) return 0;
  for (let i = 0; i < leadIds.length; i += 50) {
    await kommo("/leads", { method: "PATCH", body: leadIds.slice(i, i + 50).map((id) => ({ id, pipeline_id: pl.id, status_id: status })) });
  }
  return leadIds.length;
}
