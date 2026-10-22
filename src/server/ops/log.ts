/**
 * Logs estructurados (auditoría M-10): una línea JSON por evento, que Vercel indexa y se puede enviar a cualquier
 * servicio de logs. Nunca datos personales ni secretos: los campos con nombres sensibles se descartan y los ids de
 * usuario se seudonimizan.
 */
import { createHash } from "node:crypto";

type Level = "info" | "warn" | "error";
const SENSITIVE = /token|secret|password|clave|email|phone|telefono|address|direccion|cbu|dni|authorization|cookie/i;

/** Id de usuario seudonimizado: permite correlacionar sin exponer el id real. */
export const pseudonym = (userId: string | null | undefined) => (userId ? createHash("sha256").update(`fixy-log:${userId}`).digest("hex").slice(0, 12) : null);

function clean(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (SENSITIVE.test(k)) continue;
    if (k === "userId") out.user = pseudonym(v as string);
    else if (v instanceof Error) out[k] = v.message.slice(0, 300);
    else out[k] = v;
  }
  return out;
}

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...clean(fields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
