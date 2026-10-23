/**
 * Lectura de la planilla de captación. Primero con la cuenta de servicio (planilla compartida con su client_email);
 * si no hay credenciales o no tiene acceso, prueba la exportación CSV pública (planilla "cualquiera con el link").
 */
import { env } from "@/server/env";
import { parseCsv } from "@/lib/csv";
import { googleAccessToken, serviceAccount } from "./google-auth";

export class SheetAccessError extends Error {}

export async function readSheet(sheetId = env().SUPPLY_SHEET_ID, tab = env().SUPPLY_SHEET_TAB): Promise<{ rows: string[][]; via: "api" | "csv" }> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(sheetId)) throw new SheetAccessError("Falta configurar SUPPLY_SHEET_ID.");
  const a = serviceAccount();
  let apiProblem = "no hay cuenta de servicio configurada";
  if (a) {
    const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(tab)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`, {
      headers: { authorization: `Bearer ${await googleAccessToken(a, "https://www.googleapis.com/auth/spreadsheets.readonly")}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const j = (await res.json()) as { values?: unknown[][] };
      return { rows: (j.values ?? []).map((r) => r.map((c) => String(c ?? ""))), via: "api" };
    }
    apiProblem = res.status === 403 ? `la planilla no está compartida con ${a.client_email} o la API de Sheets no está activada` : `Google respondió ${res.status}`;
  }
  const csv = await fetch(`https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`, { signal: AbortSignal.timeout(20_000), redirect: "manual" });
  const type = csv.headers.get("content-type") ?? "";
  if (csv.ok && type.includes("csv")) return { rows: parseCsv(await csv.text()), via: "csv" };
  throw new SheetAccessError(`No se pudo leer la planilla: ${apiProblem}.`);
}
