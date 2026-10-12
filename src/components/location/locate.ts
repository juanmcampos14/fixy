"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AddressComponent } from "@/lib/zone-match";
import { componentsToAddress as coreToAddress, type AddressValue } from "@/lib/address";
import { loadGoogleMaps, MAPS_KEY } from "./google-maps";

export type ZoneOption = { id: string; code: string; name: string; region: string; match_names: string[]; province?: string | null; catch_all?: boolean };
export type { AddressValue };
export type Located = { value: AddressValue; zone: ZoneOption | null; outside: boolean };
export type LocateError = "denied" | "unavailable" | "unsupported" | "geocode";

export const FEW_PROS_MESSAGE = "Recibimos tu ubicación. Hacé el pedido y te conectamos con un profesional de tu zona.";
export const LOCATE_ERROR: Record<LocateError, string> = {
  denied: "Tu navegador tiene bloqueada la ubicación para este sitio. Podés activarla desde el ícono del candado, junto a la dirección del sitio, o escribir la dirección.",
  unavailable: "No pudimos detectar tu ubicación. Escribí la dirección.",
  unsupported: "Tu navegador no permite compartir la ubicación. Escribí la dirección.",
  geocode: "No pudimos convertir tu ubicación en una dirección. Escribila.",
};

export const canLocate = () => !!MAPS_KEY && typeof navigator !== "undefined" && !!navigator.geolocation;

/** Componentes de Google → dirección + zona. Fuera de las zonas cubiertas asigna "Otra zona" (nunca rechaza). */
export function componentsToAddress(components: AddressComponent[], formatted: string, lat: number, lng: number, placeId: string, zones: ZoneOption[], streetLine?: string): Located {
  const { value, zone, outside } = coreToAddress(components, formatted, lat, lng, placeId, zones, streetLine);
  return { value, zone, outside };
}

/**
 * Pide la ubicación del dispositivo y la convierte en dirección. Llamarla SIEMPRE desde un toque del usuario:
 * los navegadores bloquean en silencio los pedidos de permiso que no vienen de una interacción.
 */
export function locateMe(zones: ZoneOption[]): Promise<{ ok: true; located: Located } | { ok: false; error: LocateError }> {
  return new Promise((resolve) => {
    if (!canLocate()) return resolve({ ok: false, error: "unsupported" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const g = await loadGoogleMaps();
          const { Geocoder } = await g.maps.importLibrary("geocoding");
          const { results } = await new Geocoder().geocode({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude }, language: "es", region: "AR" });
          const best = results.find((r: any) => r.types.includes("street_address") || r.types.includes("premise")) ?? results[0];
          if (!best) return resolve({ ok: false, error: "geocode" });
          resolve({ ok: true, located: componentsToAddress(best.address_components, best.formatted_address, pos.coords.latitude, pos.coords.longitude, best.place_id, zones) });
        } catch {
          resolve({ ok: false, error: "geocode" });
        }
      },
      (err) => resolve({ ok: false, error: err.code === err.PERMISSION_DENIED ? "denied" : "unavailable" }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  });
}
