/**
 * Teléfonos argentinos escritos de cualquier forma ("+54 9 11 3038-8764", "(0230) 442-2216", "11 4030 4838",
 * "5491130388764") → una clave de 10 dígitos (característica + número) para reconocer al mismo contacto aunque esté
 * escrito distinto, y el número de WhatsApp (549 + 10 dígitos). Puro: sirve en el navegador y en el servidor.
 */
export type ArPhone = { key: string; whatsapp: string };

export function normalizeArPhone(raw: string | null | undefined): ArPhone | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54")) d = d.slice(2);
  if (d.startsWith("9") && d.length === 11) d = d.slice(1); // 9 de celular internacional
  if (d.startsWith("0")) d = d.slice(1); // 0 de larga distancia
  // "15" de celular local después de la característica (11 15 3038 8764 → 11 3038 8764)
  if (d.length === 12) {
    for (const len of [2, 3, 4]) {
      if (d.slice(len, len + 2) === "15") {
        d = d.slice(0, len) + d.slice(len + 2);
        break;
      }
    }
  }
  if (d.length !== 10) return null;
  return { key: d, whatsapp: `549${d}` };
}

/** Clave de 10 dígitos de un número guardado en Fixy (whatsapp_phone "549…", contact_phone libre). */
export const phoneKey = (raw: string | null | undefined) => normalizeArPhone(raw)?.key ?? null;
