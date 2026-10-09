/** Geocodificación en el servidor (Google Geocoding API). Requiere GOOGLE_MAPS_SERVER_KEY; sin clave devuelve null. */
import { env } from "@/server/env";
import type { AddressComponent } from "@/lib/zone-match";

export type GeoResult = { components: AddressComponent[]; formatted: string; lat: number; lng: number; placeId: string };

async function geocode(params: Record<string, string>): Promise<GeoResult | null> {
  const key = env().GOOGLE_MAPS_SERVER_KEY;
  if (!key) return null;
  const qs = new URLSearchParams({ ...params, language: "es", region: "ar", key });
  try {
    const res = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${qs}`, { signal: AbortSignal.timeout(6000) });
    const json = (await res.json()) as { status: string; results: { address_components: AddressComponent[]; formatted_address: string; place_id: string; types: string[]; geometry: { location: { lat: number; lng: number } } }[] };
    if (json.status !== "OK" || !json.results.length) return null;
    const best = json.results.find((r) => r.types.includes("street_address") || r.types.includes("premise")) ?? json.results[0];
    return { components: best.address_components, formatted: best.formatted_address, lat: best.geometry.location.lat, lng: best.geometry.location.lng, placeId: best.place_id };
  } catch {
    return null;
  }
}

export const reverseGeocode = (lat: number, lng: number) => geocode({ latlng: `${lat},${lng}` });
export const geocodeAddress = (text: string) => geocode({ address: text, components: "country:AR" });
export const serverGeocodingAvailable = () => !!env().GOOGLE_MAPS_SERVER_KEY;
