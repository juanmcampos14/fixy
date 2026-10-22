"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

type Handle = { remove: () => void };
type Listen<E extends string, T> = (event: E, cb: (e: T) => void) => Promise<Handle> | Handle;
type AppPlugin = {
  addListener: Listen<"appUrlOpen", { url: string }>;
  getLaunchUrl: () => Promise<{ url?: string } | undefined>;
};
type PushPlugin = {
  checkPermissions: () => Promise<{ receive: "prompt" | "prompt-with-rationale" | "granted" | "denied" }>;
  requestPermissions: () => Promise<{ receive: string }>;
  register: () => Promise<void>;
  addListener: Listen<"registration", { value: string }> & Listen<"pushNotificationActionPerformed", { notification: { data?: { link?: string } } }>;
};
type CapacitorGlobal = { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: { App?: AppPlugin; PushNotifications?: PushPlugin; Browser?: { close: () => Promise<void> } } };

const TOKEN_KEY = "fixy-push-token";
const store = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (v: string | null) => { try { if (v) localStorage.setItem(TOKEN_KEY, v); else localStorage.removeItem(TOKEN_KEY); } catch { /* sin almacenamiento */ } },
};

/** Solo navega a pantallas propias: nunca a una dirección externa que venga en un link o en un aviso. */
function goPath(path?: string) {
  if (!path || !path.startsWith("/") || path.startsWith("//")) return;
  if (path !== location.pathname + location.search + location.hash) location.assign(path);
}

/** Avisos push: se piden recién con sesión iniciada, y al cerrar sesión el dispositivo se da de baja. */
async function setupPush(cap: CapacitorGlobal, push: PushPlugin, onCleanup: (h: Handle) => void) {
  const platform = cap.getPlatform?.();
  if (platform !== "ios" && platform !== "android") return;
  const cfg = await fetch("/api/push", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ signedIn: boolean; platforms: Record<string, boolean> }>) : null)).catch(() => null);
  if (!cfg) return;
  if (!cfg.signedIn) {
    // Al cerrar sesión el servidor ya borró este dispositivo (estaba atado a la sesión): al volver a entrar se registra de nuevo.
    store.set(null);
    return;
  }
  // Sin credenciales del lado del servidor no se toca el servicio nativo (en Android, sin Firebase configurado, fallaría).
  if (!cfg.platforms[platform]) return;
  onCleanup(await push.addListener("registration", (t) => {
    if (store.get() === t.value) return;
    fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ platform, token: t.value }) })
      .then((r) => { if (r.ok) store.set(t.value); })
      .catch(() => null);
  }));
  onCleanup(await push.addListener("pushNotificationActionPerformed", (e) => goPath(e.notification.data?.link)));
  let perm = (await push.checkPermissions()).receive;
  if (perm === "prompt" || perm === "prompt-with-rationale") perm = (await push.requestPermissions()).receive as typeof perm;
  if (perm === "granted") await push.register();
}

/** Solo dentro de la app de Fixy (iOS/Android): links que abren la app y avisos push. */
export function NativeAppBridge() {
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    if (!cap?.isNativePlatform?.()) return;
    const handles: Handle[] = [];
    let alive = true;
    const keep = (h: Handle) => { if (alive) handles.push(h); else h.remove(); };

    const app = cap.Plugins?.App;
    if (app) {
      const go = (raw?: string) => {
        if (!raw) return;
        try {
          const u = new URL(raw);
          // Vuelta del ingreso con Google hecho en el navegador del sistema: se canjea el código por la sesión.
          if (u.protocol === "fixy:" && (u.hostname === "auth" || u.pathname.replace(/\//g, "") === "auth")) {
            const code = u.searchParams.get("code");
            const verifier = localStorage.getItem("fixy-google-verifier");
            localStorage.removeItem("fixy-google-verifier");
            cap.Plugins?.Browser?.close().catch(() => null);
            if (code && verifier) location.assign(`/auth/app/finish?code=${encodeURIComponent(code)}&verifier=${encodeURIComponent(verifier)}`);
            return;
          }
          if (!/(^|\.)fixy\.solutions$/.test(u.hostname)) return;
          goPath(u.pathname + u.search + u.hash);
        } catch {
          // link inválido: se ignora
        }
      };
      Promise.resolve(app.addListener("appUrlOpen", (e) => go(e.url))).then(keep);
      // Abierta en frío desde un link: el sistema lo pasa como URL de lanzamiento (una sola vez por apertura).
      let first = true;
      try {
        first = !sessionStorage.getItem("fixy-launch-handled");
        sessionStorage.setItem("fixy-launch-handled", "1");
      } catch {
        // sin almacenamiento: se procesa igual
      }
      if (first) app.getLaunchUrl().then((r) => go(r?.url)).catch(() => null);
    }

    return () => { alive = false; handles.forEach((h) => h.remove()); };
  }, []);

  // Avisos: al abrir la app y al entrar a un panel (recién ahí hay sesión). Una vez registrados, no se repite.
  const pathname = usePathname();
  const pushDone = useRef(false);
  const pushHandles = useRef<Handle[]>([]);
  useEffect(() => {
    const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
    const push = cap?.isNativePlatform?.() ? cap.Plugins?.PushNotifications : undefined;
    if (!cap || !push || pushDone.current) return;
    const first = !pushHandles.current.length && !sessionStorage.getItem("fixy-push-checked");
    if (!first && !/^\/(app|proveedor|admin|notificaciones)(\/|$)/.test(pathname)) return;
    try { sessionStorage.setItem("fixy-push-checked", "1"); } catch { /* sin almacenamiento */ }
    pushDone.current = true;
    let registered = false;
    setupPush(cap, push, (h) => { registered = true; pushHandles.current.push(h); })
      .catch(() => null)
      .finally(() => { if (!registered) pushDone.current = false; });
  }, [pathname]);
  useEffect(() => () => pushHandles.current.forEach((h) => h.remove()), []);
  return null;
}
