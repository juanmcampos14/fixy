/**
 * API de solo lectura de captación (para ChatGPT, Claude o planillas). Clave en Authorization: Bearer fixy_ro_….
 * No devuelve teléfonos ni emails de los candidatos: solo lo necesario para analizar y no duplicar el research.
 * Especificación: /api/v1/openapi.json
 */
import { authenticateApiKey, logApiRequest } from "@/server/modules/api-keys";
import { LEAD_STAGES, type LeadStage } from "@/server/modules/supply";
import { normalizeArPhone } from "@/lib/phone-ar";
import { checkSource, domainOf } from "@/lib/lead-source";
import { sql } from "@/server/db/client";
import {
  coverageByZone, listCampaigns, listLeads, supplyByChannel, supplyByLocality, supplyByTrade, supplyFunnel, supplyWeekly,
} from "@/server/queries/supply";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

async function candidates(url: URL) {
  const p = url.searchParams;
  const stage = p.get("etapa");
  const list = await listLeads({
    stage: LEAD_STAGES.includes(stage as LeadStage) ? (stage as LeadStage) : undefined,
    category: p.get("oficio") || undefined, region: p.get("region") || undefined, source: p.get("origen") || undefined,
    q: p.get("q") || undefined, page: Math.max(1, Number(p.get("pagina")) || 1),
  });
  const ids = list.rows.map((r) => r.id);
  const extra = ids.length
    ? await sql()<{ id: string; website: string | null; source_url: string | null; has_email: boolean }[]>`select id, website, source_url, email is not null as has_email from supply_leads where id in ${sql()(ids)}`
    : [];
  const by = new Map(extra.map((e) => [e.id, e]));
  return {
    pagina: list.page, hay_mas: list.hasMore,
    candidatos: list.rows.map((r) => {
      const e = by.get(r.id);
      return {
        codigo: r.code, nombre: r.business_name, oficios: r.categories, oficio_original: r.trades_raw, localidad_base: r.base_locality, zona: r.zone,
        region: r.base_region, etapa: r.stage, origen: r.source, no_contactar: r.do_not_contact, tiene_whatsapp: !!r.whatsapp_e164, tiene_email: !!e?.has_email,
        sitio: e?.website ?? null, fuente: e?.source_url ?? null, tipo_de_fuente: checkSource(e?.source_url, e?.website), alta: r.created_at,
      };
    }),
  };
}

/** ¿Ya lo tenemos? Para no duplicar el research: compara teléfono, email y dominio del sitio. */
async function verify(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { telefono?: string; email?: string; web?: string; items?: { telefono?: string; email?: string; web?: string }[] };
  const items = (body.items ?? [body]).slice(0, 100);
  const out = [];
  for (const it of items) {
    const key = it.telefono ? normalizeArPhone(it.telefono)?.key ?? null : null;
    const email = it.email?.trim().toLowerCase() || null;
    const domain = domainOf(it.web);
    const rows = key || email || domain
      ? await sql()<{ code: string; stage: string; by: string }[]>`
          select code, stage, case when ${key}::text is not null and phone_key = ${key} then 'telefono' when ${email}::text is not null and lower(email) = ${email} then 'email' else 'sitio' end as by
          from supply_leads where (${key}::text is not null and phone_key = ${key}) or (${email}::text is not null and lower(email) = ${email})
            or (${domain}::text is not null and regexp_replace(lower(coalesce(website,'')), '^https?://(www\\.)?([^/]+).*$', '\\2') = ${domain})
          limit 5`
      : [];
    out.push({ consulta: { telefono: it.telefono ?? null, email: it.email ?? null, web: it.web ?? null }, existe: rows.length > 0, coincidencias: rows });
  }
  return { resultados: out };
}

async function handle(req: Request, { params }: { params: Promise<{ recurso: string }> }) {
  const auth = await authenticateApiKey(req, "captacion:read");
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { recurso } = await params;
  const url = new URL(req.url);
  let status = 200;
  let data: unknown;
  try {
    if (req.method === "POST" && recurso === "verificar") data = await verify(req);
    else if (req.method !== "GET") { status = 405; data = { error: "Método no permitido." }; }
    else switch (recurso) {
      case "resumen": {
        const [funnel, canales, semanas] = await Promise.all([supplyFunnel(), supplyByChannel(), supplyWeekly()]);
        data = { embudo: funnel.by, total: funnel.total, nuevos_7_dias: funnel.new7, registrados_30_dias: funnel.registered30, no_contactar: funnel.dnc, sin_telefono: funnel.no_phone, canales, semanas };
        break;
      }
      case "oficios": data = { oficios: await supplyByTrade() }; break;
      case "zonas": data = { zonas: await coverageByZone() }; break;
      case "localidades": data = { localidades: await supplyByLocality(300) }; break;
      case "canales": data = { canales: await supplyByChannel() }; break;
      case "campanas": data = { campanas: await listCampaigns() }; break;
      case "candidatos": data = await candidates(url); break;
      default: status = 404; data = { error: "Recurso desconocido. Ver /api/v1/openapi.json" };
    }
  } catch (e) {
    console.error("[api] error", e instanceof Error ? e.message : e);
    status = 500;
    data = { error: "Error interno." };
  }
  await logApiRequest(auth.keyId, req.method, `${url.pathname}${url.search}`, status);
  return json(data, status);
}

export const GET = handle;
export const POST = handle;
