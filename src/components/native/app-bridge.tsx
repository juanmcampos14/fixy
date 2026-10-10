"use client";

import { useEffect } from "react";

type AppPlugin = {
  addListener: (event: "appUrlOpen", cb: (e: { url: string }) => void) => Promise<{ remove: () => void }> | { remove: () => void };
  getLaunchUrl: () => Promise<{ url?: string } | undefined>;
};
type CapacitorGlobal = { isNativePlatform?: () => boolean; Plugins?: { App?: AppPlugin } };

/** Solo dentro de la app de Fixy (iOS/Android): si la abrieron desde un link de Fixy, va a esa pantalla. */
export function NativeAppBridge() {
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    const app = cap?.isNativePlatform?.() ? cap.Plugins?.App : undefined;
    if (!app) return;
    const go = (raw?: string) => {
      if (!raw) return;
      try {
        const u = new URL(raw);
        if (!/(^|\.)fixy\.solutions$/.test(u.hostname)) return;
        const target = u.pathname + u.search + u.hash;
        if (target !== location.pathname + location.search + location.hash) location.assign(target);
      } catch {
        // link inválido: se ignora
      }
    };
    let remove: (() => void) | undefined;
    Promise.resolve(app.addListener("appUrlOpen", (e) => go(e.url))).then((h) => { remove = h.remove; });
    // Abierta en frío desde un link: el sistema lo pasa como URL de lanzamiento (una sola vez por apertura).
    let first = true;
    try {
      first = !sessionStorage.getItem("fixy-launch-handled");
      sessionStorage.setItem("fixy-launch-handled", "1");
    } catch {
      // sin almacenamiento: se procesa igual
    }
    if (first) app.getLaunchUrl().then((r) => go(r?.url)).catch(() => null);
    return () => remove?.();
  }, []);
  return null;
}
