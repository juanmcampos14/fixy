/**
 * Centro aproximado de cada zona de cobertura. Sirve para asignar la zona desde coordenadas cuando no hay
 * geocodificación en el servidor (por ejemplo, la ubicación compartida por WhatsApp).
 */
const CENTROIDS: Record<string, [number, number]> = {
  "caba-palermo": [-34.5875, -58.43], "caba-belgrano": [-34.556, -58.46], "caba-recoleta": [-34.588, -58.393], "caba-centro": [-34.607, -58.38],
  "caba-caballito": [-34.618, -58.44], "caba-urquiza": [-34.573, -58.49], "caba-flores": [-34.635, -58.48], "caba-sur": [-34.638, -58.378],
  "gba-vicente-lopez": [-34.527, -58.48], "gba-san-isidro": [-34.49, -58.53], "gba-san-fernando": [-34.445, -58.56], "gba-tigre": [-34.43, -58.62],
  "gba-escobar": [-34.348, -58.79], "gba-pilar": [-34.46, -58.91], "gba-moron": [-34.653, -58.62], "gba-la-matanza": [-34.7, -58.58],
  "gba-avellaneda": [-34.663, -58.365], "gba-lanus": [-34.7, -58.395], "gba-lomas": [-34.76, -58.4], "gba-quilmes": [-34.725, -58.26],
};

function km(a: [number, number], b: [number, number]) {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Zona más cercana a unas coordenadas (código), o null si queda a más de `maxKm` de todas (fuera de cobertura). */
export function nearestZoneCode(lat: number, lng: number, maxKm = 18): string | null {
  let best: { code: string; d: number } | null = null;
  for (const [code, c] of Object.entries(CENTROIDS)) {
    const d = km([lat, lng], c);
    if (!best || d < best.d) best = { code, d };
  }
  return best && best.d <= maxKm ? best.code : null;
}
