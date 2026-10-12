import Link from "next/link";
import { headers } from "next/headers";
import { googleConfigured } from "@/server/auth/google";
import { AppGoogleButton } from "./app-google-button";

/** Dentro de la app de Fixy (iOS/Android) el navegador se identifica con "FixyApp". */
export async function inFixyApp() {
  return /\bFixyApp\//.test((await headers()).get("user-agent") ?? "");
}

const GoogleMark = () => (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);
const buttonClass = "flex h-12 w-full cursor-pointer items-center justify-center gap-3 rounded-full px-5 text-ink ring-1 ring-control transition-colors hover:bg-cream-2 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-fixy-500/40";

/**
 * "Continuar con Google" + separador. No se muestra si no está configurado.
 * Dentro de la app, Google no permite iniciar sesión en la vista web embebida: el botón abre el navegador del sistema
 * y vuelve a la app (solo en versiones de la app que traen ese puente; en las anteriores no aparece).
 */
export async function GoogleButton({ next, signup }: { next?: string; signup?: boolean }) {
  if (!googleConfigured()) return null;
  const inApp = await inFixyApp();
  const legal = signup && (
    <p className="mt-2 text-center text-xs text-muted">
      Al continuar con Google aceptás los <Link href="/terminos" className="underline" target="_blank">términos</Link> y la <Link href="/privacidad" className="underline" target="_blank">política de privacidad</Link>.
    </p>
  );
  const divider = (
    <div className="mt-5 flex items-center gap-3 text-sm text-muted" aria-hidden>
      <span className="h-px flex-1 bg-line" />o con tu email<span className="h-px flex-1 bg-line" />
    </div>
  );
  if (inApp) return <AppGoogleButton next={next} className={buttonClass} mark={<GoogleMark />}>{legal}{divider}</AppGoogleButton>;
  return (
    <div className="mb-5">
      {/* Navegación completa (no prefetch): el flujo sale a Google y vuelve. */}
      <a href={`/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`} className={buttonClass}>
        <GoogleMark />
        Continuar con Google
      </a>
      {legal}
      {divider}
    </div>
  );
}
