/** Regiones en las que se agrupan las zonas de cobertura. Fuente única de nombres y orden (web, panel y bot). */
export const REGION_LABEL: Record<string, string> = {
  CABA: "Ciudad de Buenos Aires",
  GBA_NORTE: "GBA Norte",
  GBA_OESTE: "GBA Oeste",
  GBA_SUR: "GBA Sur",
  PBA: "Provincia de Buenos Aires",
  CENTRO: "Centro (Córdoba, Santa Fe, Entre Ríos, La Pampa)",
  CUYO: "Cuyo (Mendoza, San Juan, San Luis)",
  NOA: "Noroeste",
  NEA: "Noreste",
  PATAGONIA: "Patagonia",
};
export const REGION_ORDER = Object.keys(REGION_LABEL);
/** Regiones que eligen los profesionales y se muestran en listados. "OTRA" es solo el comodín de pedidos sin zona. */
export const REGION_CODES = REGION_ORDER as [string, ...string[]];
