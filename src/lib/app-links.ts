/**
 * Links que abren la app (Universal Links en iOS, App Links en Android).
 * Si la app está instalada, un link de Fixy (WhatsApp, mail, notificaciones) abre la app en esa pantalla;
 * si no, abre la web como siempre. Nada de esto es secreto: Apple y Google lo leen públicamente.
 */
export const APP_ID = "solutions.fixy.app";

/** Team ID de la cuenta de Apple Developer de Flips (aparece en developer.apple.com → Membership details cuando aprueban la inscripción). */
export const APPLE_TEAM_ID: string | null = null;

/**
 * Huellas SHA-256 de los certificados que firman la app de Android.
 * - La de depuración de la Mac de desarrollo (para probar en el emulador).
 * - La de "Firma de apps de Google Play": con esa llega firmada la app que se instala desde la tienda.
 */
export const ANDROID_CERT_SHA256 = [
  "A9:97:7A:33:FA:98:43:25:A9:65:AD:DA:B5:77:C3:68:FC:D4:E2:1C:96:5C:25:C6:30:54:2B:92:0B:BC:09:7F",
  "02:B0:95:48:B4:37:26:7A:57:ED:41:10:AE:33:A3:F2:55:1B:DE:D4:CC:F1:89:E5:BE:1D:F4:BA:8C:B5:FF:B2",
];

/** Rutas que abre la app. El resto (por ejemplo, el ingreso con Google, que no puede ir dentro de la app) sigue en el navegador. */
export const APP_PATHS = [
  "/", "/app", "/proveedor", "/solicitar", "/wa", "/pagos", "/notificaciones", "/profesionales", "/invitacion",
  "/recuperar", "/ingresar", "/registro", "/sumate",
];

/** Ficha de Fixy en Google Play. */
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${APP_ID}`;

/** Ficha de Fixy en el App Store. null hasta que Apple apruebe la app: mientras tanto, en iPhone se usa la web. */
export const APP_STORE_URL: string | null = null;

/** Link corto para compartir la app: manda a la tienda según el celular (ver /descargar). */
export const DOWNLOAD_PATH = "/descargar";

export type StoreTarget = "android" | "ios" | "other";

/** Qué tienda corresponde según el navegador. iPadOS se presenta como Mac: cae en "other" y ve la página con las dos opciones. */
export function storeFor(userAgent: string): StoreTarget {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  return "other";
}

/** Link a Google Play con el origen de la descarga (?src=whatsapp, qr…) para verlo en las estadísticas de Play Console. */
export function playStoreUrl(source?: string | null): string {
  const src = source && /^[a-z0-9_-]{1,40}$/i.test(source) ? source : null;
  return src ? `${PLAY_STORE_URL}&referrer=${encodeURIComponent(`utm_source=${src}&utm_medium=link`)}` : PLAY_STORE_URL;
}
