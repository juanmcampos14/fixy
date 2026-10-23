/** Especificación OpenAPI de la API de solo lectura (para importar en un GPT personalizado o en otra herramienta). */
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

const get = (summary: string, description: string, parameters: unknown[] = []) => ({
  get: { summary, description, operationId: summary, parameters, responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } }, "401": { description: "Clave inválida" } } },
});
const q = (name: string, description: string, extra: Record<string, unknown> = {}) => ({ name, in: "query", required: false, description, schema: { type: "string", ...extra } });

export function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Fixy — Captación (solo lectura)",
      version: "1.0.0",
      description:
        "Datos de captación de profesionales de Fixy: embudo, oferta y demanda por oficio y zona, candidatos (sin teléfonos ni emails), canales y campañas. " +
        "Solo lectura. Etapas: candidate, contacted, interested, registered, verified, active, discarded. Regiones: CABA, GBA_NORTE, GBA_OESTE, GBA_SUR, etc.",
    },
    servers: [{ url: env().APP_URL.replace(/\/$/, "") }],
    components: { securitySchemes: { clave: { type: "http", scheme: "bearer" } }, schemas: {} },
    security: [{ clave: [] }],
    paths: {
      "/api/v1/captacion/resumen": get("resumen", "Embudo de captación (cantidad por etapa), totales, resultados por canal y altas por semana (12 semanas)."),
      "/api/v1/captacion/oficios": get("oficios", "Por oficio: candidatos, en contacto, registrados, profesionales activos en Fixy, pedidos de clientes en 30 días y pedidos por activo. Los de menos oferta primero."),
      "/api/v1/captacion/zonas": get("zonas", "Cobertura por zona: profesionales activos que la cubren, candidatos con base ahí y barrios cerrados de referencia (lotes)."),
      "/api/v1/captacion/localidades": get("localidades", "Candidatos y registrados por localidad base."),
      "/api/v1/captacion/canales": get("canales", "Por canal (utm_source u origen): candidatos, registrados, activos y gasto cargado."),
      "/api/v1/captacion/campanas": get("campanas", "Campañas de captación con sus resultados: enviados, clics, respuestas, registrados, activos y bajas."),
      "/api/v1/captacion/candidatos": get("candidatos", "Lista paginada (50 por página) de candidatos, con oficio, zona, etapa, sitio y fuente. No incluye teléfonos ni emails.", [
        q("etapa", "Etapa del embudo", { enum: ["candidate", "contacted", "interested", "registered", "verified", "active", "discarded"] }),
        q("oficio", "Slug del oficio (ej.: plomeria, electricidad, gas)"),
        q("region", "Región base (ej.: CABA, GBA_NORTE)"),
        q("origen", "Origen", { enum: ["research", "ads", "organic", "whatsapp", "referral", "manual"] }),
        q("q", "Texto a buscar en nombre, código o localidad"),
        { name: "pagina", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
      ]),
      "/api/v1/captacion/verificar": {
        post: {
          summary: "verificar", operationId: "verificar",
          description: "¿Ya está en la base? Para no duplicar el research: compara teléfono, email y dominio del sitio de hasta 100 contactos. No modifica nada.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: {
            items: { type: "array", maxItems: 100, items: { type: "object", properties: { telefono: { type: "string" }, email: { type: "string" }, web: { type: "string" } } } },
          } } } } },
          responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } } },
        },
      },
    },
  };
  return Response.json(spec, { headers: { "cache-control": "public, max-age=300" } });
}
