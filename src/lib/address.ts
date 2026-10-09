/** Dirección + zona a partir de componentes de Google. Función pura: la usan la web y el bot de WhatsApp. */
import { matchZone, type AddressComponent, type MatchZone } from "./zone-match";

export type ZoneLike = MatchZone & { name: string };
export type AddressValue = { addressLine: string; zoneId: string; lat: string; lng: string; placeId: string; formattedAddress: string };

export function componentsToAddress<Z extends ZoneLike>(components: AddressComponent[], formatted: string, lat: number, lng: number, placeId: string, zones: Z[], streetLine?: string) {
  const zone = (matchZone(components, zones) as Z | null) ?? zones.find((z) => z.code === "otra-zona") ?? null;
  const route = components.find((c) => c.types.includes("route"));
  const number = components.find((c) => c.types.includes("street_number"));
  const street = [route?.long_name ?? route?.longText, number?.long_name ?? number?.longText].filter(Boolean).join(" ");
  const line = streetLine ?? (street || formatted.split(",")[0]);
  return {
    value: { addressLine: line, formattedAddress: formatted, lat: lat.toFixed(6), lng: lng.toFixed(6), placeId, zoneId: zone?.id ?? "" } as AddressValue,
    zone,
    outside: !zone || zone.code === "otra-zona",
    hasStreetNumber: !!number,
  };
}
