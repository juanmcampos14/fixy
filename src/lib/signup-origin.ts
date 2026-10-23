/**
 * Origen de un alta de profesional (cookie "fixy_signup" que guarda /sumate/registrarme): canal, código de
 * invitación o perfil que recomendó, datos de campaña (utm) y oficio / zona de la landing para precargar el alta.
 */
export type SignupCookie = { origen?: string; ref?: string; utm?: Record<string, string>; oficio?: string; zona?: string };

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"] as const;
const clean = (v: string | null | undefined, max = 120) => (v ?? "").replace(/[^\w.\-:/ ]/g, "").trim().slice(0, max);

/** Parámetros de campaña de una URL (solo los conocidos, recortados). */
export function pickUtm(params: URLSearchParams | Record<string, string | string[] | undefined>): Record<string, string> {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : [params[k]].flat()[0]) ?? "";
  return Object.fromEntries(UTM_KEYS.map((k) => [k, clean(get(k), k.endsWith("clid") ? 200 : 120)]).filter(([, v]) => v));
}

export function readSignupCookie(raw: string | undefined): { source?: string; referrerSlug?: string; utm?: Record<string, string>; oficio?: string; zona?: string } {
  try {
    const c = JSON.parse(raw ?? "{}") as SignupCookie;
    const utm = c.utm && typeof c.utm === "object" ? Object.fromEntries(Object.entries(c.utm).filter(([k, v]) => (UTM_KEYS as readonly string[]).includes(k) && typeof v === "string").map(([k, v]) => [k, clean(v, 200)])) : {};
    return {
      source: typeof c.origen === "string" && c.origen ? c.origen : undefined,
      referrerSlug: typeof c.ref === "string" && c.ref ? c.ref : undefined,
      utm,
      oficio: typeof c.oficio === "string" ? c.oficio : undefined,
      zona: typeof c.zona === "string" ? c.zona : undefined,
    };
  } catch {
    return {};
  }
}
