/**
 * Redes sociales públicas de un profesional. Solo plataformas conocidas y sitios web con https;
 * nunca links de mensajería (WhatsApp, Telegram) ni teléfonos o emails: la coordinación sigue dentro de Fixy.
 * Se acepta el link completo o, en las redes, el usuario ("@plomeriasosa").
 */
export const SOCIAL_NETWORKS = [
  { key: "instagram", label: "Instagram", placeholder: "@tuusuario o link", hosts: ["instagram.com"], handle: /^[A-Za-z0-9._]{1,30}$/, url: (h: string) => `https://www.instagram.com/${h}` },
  { key: "facebook", label: "Facebook", placeholder: "Link de tu página", hosts: ["facebook.com", "fb.com"], handle: /^[A-Za-z0-9.]{5,50}$/, url: (h: string) => `https://www.facebook.com/${h}` },
  { key: "tiktok", label: "TikTok", placeholder: "@tuusuario o link", hosts: ["tiktok.com"], handle: /^[A-Za-z0-9._]{2,24}$/, url: (h: string) => `https://www.tiktok.com/@${h}` },
  { key: "youtube", label: "YouTube", placeholder: "@tucanal o link", hosts: ["youtube.com", "youtu.be"], handle: /^[A-Za-z0-9._-]{3,30}$/, url: (h: string) => `https://www.youtube.com/@${h}` },
  { key: "linkedin", label: "LinkedIn", placeholder: "Link de tu perfil o empresa", hosts: ["linkedin.com"], handle: null, url: null },
  { key: "website", label: "Sitio web", placeholder: "https://tusitio.com.ar", hosts: null, handle: null, url: null },
] as const;

export type SocialKey = (typeof SOCIAL_NETWORKS)[number]["key"];
export type SocialLinks = Partial<Record<SocialKey, string>>;

const BLOCKED_HOSTS = ["wa.me", "whatsapp.com", "t.me", "telegram.me", "telegram.org", "api.whatsapp.com", "chat.whatsapp.com", "bit.ly", "tinyurl.com", "linktr.ee"];

const hostMatches = (host: string, list: readonly string[]) => list.some((h) => host === h || host.endsWith(`.${h}`));

/** Devuelve el link normalizado, "" si está vacío, o un error explicable. */
export function normalizeSocial(key: SocialKey, raw: string): { ok: true; url: string } | { ok: false; error: string } {
  const net = SOCIAL_NETWORKS.find((n) => n.key === key)!;
  const v = raw.trim();
  if (!v) return { ok: true, url: "" };
  if (/^(mailto|tel|whatsapp):/i.test(v) || /\b\d{2,4}[\s-]?\d{3,4}[\s-]?\d{4}\b/.test(v.replace(/^https?:\/\/[^/]+/, ""))) {
    return { ok: false, error: `${net.label}: no se permiten teléfonos ni datos de contacto directo.` };
  }
  const handle = v.replace(/^@/, "");
  const looksLikeLink = v.includes("/") || /\.(com|net|org|ar|io|tv|me)(\b|$)/i.test(v);
  if (net.handle && !looksLikeLink && net.handle.test(handle)) return { ok: true, url: net.url!(handle) };
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
  } catch {
    return { ok: false, error: `${net.label}: revisá el link.` };
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (!host.includes(".") || hostMatches(host, BLOCKED_HOSTS)) return { ok: false, error: `${net.label}: ese link no está permitido (sin WhatsApp, Telegram ni acortadores).` };
  if (net.hosts && !hostMatches(host, net.hosts)) return { ok: false, error: `${net.label}: el link tiene que ser de ${net.hosts[0]}.` };
  if (net.hosts && host !== "youtu.be" && u.pathname.replace(/\/+$/, "") === "") return { ok: false, error: `${net.label}: pegá el link a tu perfil, no a la página principal.` };
  u.protocol = "https:";
  u.hash = "";
  return { ok: true, url: u.toString().slice(0, 300) };
}

export function normalizeSocialLinks(input: Partial<Record<SocialKey, string>>): { links: SocialLinks; errors: string[] } {
  const links: SocialLinks = {};
  const errors: string[] = [];
  for (const n of SOCIAL_NETWORKS) {
    const r = normalizeSocial(n.key, input[n.key] ?? "");
    if (!r.ok) errors.push(r.error);
    else if (r.url) links[n.key] = r.url;
  }
  return { links, errors };
}

/** Para mostrar: "instagram.com/plomeriasosa". */
export const displayUrl = (url: string) => url.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "");
