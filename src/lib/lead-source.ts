/**
 * De dónde salió un candidato: compara la URL de la fuente con su sitio para saber si el dato es de primera mano
 * (su propio sitio), de un directorio comercial o de otra página.
 */
export const KNOWN_DIRECTORIES = [
  "argentino.com.ar", "laguiaonline.com.ar", "paginasamarillas.com.ar", "guiaoleo.com.ar", "mercadolibre.com.ar", "google.com", "maps.app.goo.gl",
  "instagram.com", "facebook.com", "zonaprop.com.ar", "habitissimo.com.ar", "doinn.com", "opcionespilar.com.ar",
];

export type SourceCheck = "same_site" | "directory" | "other";
export const SOURCE_CHECK_LABEL: Record<SourceCheck, string> = {
  same_site: "Su propio sitio", directory: "Directorio o red", other: "Otra página",
};

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function checkSource(sourceUrl: string | null | undefined, website: string | null | undefined): SourceCheck | null {
  const src = domainOf(sourceUrl);
  if (!src) return null;
  const site = domainOf(website);
  if (site && (src === site || src.endsWith(`.${site}`))) return "same_site";
  return KNOWN_DIRECTORIES.some((d) => src === d || src.endsWith(`.${d}`)) ? "directory" : "other";
}
