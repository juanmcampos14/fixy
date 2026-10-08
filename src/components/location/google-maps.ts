"use client";

/** Carga única de Google Maps JS (Places API New + Geocoding). Sin clave configurada, devuelve null. */
type G = typeof globalThis & { google?: any; __fixyMapsPromise?: Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any

export const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export function loadGoogleMaps(): Promise<any> | null { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!MAPS_KEY || typeof window === "undefined") return null;
  const g = globalThis as G;
  if (g.google?.maps?.importLibrary) return Promise.resolve(g.google);
  if (g.__fixyMapsPromise) return g.__fixyMapsPromise;
  g.__fixyMapsPromise = new Promise((resolve, reject) => {
    const cb = "__fixyMapsReady";
    (window as unknown as Record<string, unknown>)[cb] = () => resolve(g.google);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(MAPS_KEY)}&v=weekly&loading=async&language=es&region=AR&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error("No se pudo cargar Google Maps"));
    document.head.appendChild(s);
  });
  return g.__fixyMapsPromise;
}
