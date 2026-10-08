import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import type { ActionState } from "@/lib/action-state";
import { fromDbError, isDomainError } from "@/server/domain/errors";

/** Ejecuta una acción de servidor y traduce errores a mensajes comprensibles (sin filtrar detalles internos). */
export async function act(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of e.issues) {
        const k = String(i.path[0] ?? "_");
        (fieldErrors[k] ??= []).push(i.message);
      }
      return { error: "Revisá los datos marcados.", fieldErrors };
    }
    if (isDomainError(e)) return { error: e.message };
    const db = fromDbError(e);
    if (db) return { error: db.message };
    console.error("[action] error inesperado:", e instanceof Error ? e.message : "desconocido");
    return { error: "No pudimos completar la acción. Probá de nuevo en unos minutos." };
  }
}

export const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};
export const strs = (f: FormData, k: string) => f.getAll(k).filter((v): v is string => typeof v === "string" && v !== "");
export const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";

/** Archivos válidos de un FormData (descarta inputs vacíos). Validación real de tipo/tamaño en storage. */
export async function files(f: FormData, k: string): Promise<{ data: Buffer; name: string }[]> {
  const out: { data: Buffer; name: string }[] = [];
  for (const v of f.getAll(k)) {
    if (v instanceof File && v.size > 0) out.push({ data: Buffer.from(await v.arrayBuffer()), name: v.name });
  }
  return out;
}
