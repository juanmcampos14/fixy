"use client";

import { useEffect, useState } from "react";

type BrowserPlugin = { open: (o: { url: string }) => Promise<void> };
type Cap = { isNativePlatform?: () => boolean; Plugins?: { Browser?: BrowserPlugin } };
export const APP_LOGIN_VERIFIER = "fixy-google-verifier";

const b64url = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Ingreso con Google desde la app: abre el navegador del sistema (Google no acepta la vista web de la app)
 * y la app recibe el resultado por el link `fixy://auth` (ver NativeAppBridge).
 */
export function AppGoogleButton({ next, className, mark, children }: { next?: string; className: string; mark: React.ReactNode; children?: React.ReactNode }) {
  const [browser, setBrowser] = useState<BrowserPlugin | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: Cap }).Capacitor;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- el puente nativo solo existe en el navegador de la app
    setBrowser(cap?.isNativePlatform?.() ? cap.Plugins?.Browser ?? null : null);
  }, []);
  if (!browser) return null;

  async function start() {
    if (!browser || busy) return;
    setBusy(true);
    try {
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
      localStorage.setItem(APP_LOGIN_VERIFIER, verifier);
      const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      const url = new URL("/auth/google", location.origin);
      url.searchParams.set("app", challenge);
      if (next) url.searchParams.set("next", next);
      await browser.open({ url: url.toString() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5">
      <button type="button" onClick={start} disabled={busy} className={className}>
        {mark}
        Continuar con Google
      </button>
      {children}
    </div>
  );
}
