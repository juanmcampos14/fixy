import { describe, expect, it } from "vitest";
import { guessZoneFromText, matchZone, ZONE_MATCH_NAMES, type AddressComponent, type MatchZone } from "@/lib/zone-match";
import { NATIONAL_ZONES, provinceOfLegacyRegion } from "@/lib/zones-national";
import { ZONES } from "@/server/seed/base";
import { nearestZoneCode } from "@/lib/zone-centroids";

const zones: MatchZone[] = [
  ...ZONES.map(([code, , region]) => ({ id: code, code, region, match_names: ZONE_MATCH_NAMES[code] ?? [], province: provinceOfLegacyRegion(region), catch_all: false })),
  ...NATIONAL_ZONES.map((z) => ({ id: z.code, code: z.code, region: z.region, match_names: z.names, province: z.province, catch_all: !!z.catchAll })),
  { id: "otra-zona", code: "otra-zona", region: "OTRA", match_names: [], province: null, catch_all: false },
];
const addr = (province: string, locality: string, adm2?: string, extra: AddressComponent[] = []): AddressComponent[] => [
  { long_name: locality, types: ["locality"] },
  ...(adm2 ? [{ long_name: adm2, types: ["administrative_area_level_2"] }] : []),
  { long_name: province, types: ["administrative_area_level_1"] },
  ...extra,
];

describe("zonas de todo el país", () => {
  it.each([
    [addr("Córdoba", "Córdoba", "Capital"), "cba-capital"],
    [addr("Córdoba", "Villa Carlos Paz", "Punilla"), "cba-sierras"],
    [addr("Córdoba", "Jesús María", "Colón"), "cba-sierras"],
    [addr("Córdoba", "Laboulaye", "Presidente Roque Sáenz Peña"), "cba-resto"],
    [addr("Santa Fe", "Rosario", "Rosario"), "sfe-rosario"],
    [addr("Mendoza", "Godoy Cruz", "Godoy Cruz"), "mza-gran-mendoza"],
    [addr("Mendoza", "Tunuyán", "Tunuyán"), "mza-resto"],
    [addr("Provincia de Buenos Aires", "La Plata", "La Plata"), "pba-la-plata"],
    [addr("Provincia de Buenos Aires", "Morón", "Morón"), "gba-moron"],
    [addr("Provincia de Buenos Aires", "Caseros", "Tres de Febrero"), "gba-tres-de-febrero"],
    [addr("Provincia de Buenos Aires", "Trenque Lauquen", "Trenque Lauquen"), "pba-resto"],
    [addr("Tierra del Fuego, Antártida e Islas del Atlántico Sur", "Ushuaia", "Ushuaia"), "tdf-ushuaia"],
    [addr("Santiago del Estero", "La Banda", "Banda"), "sde-capital"],
    // Homónimos: cada uno en su provincia.
    [addr("Chaco", "Resistencia", "San Fernando"), "cha-resistencia"],
    [addr("Provincia de Buenos Aires", "San Fernando", "San Fernando"), "gba-san-fernando"],
    [addr("San Luis", "Merlo", "Junín"), "sl-san-luis"],
    [addr("Provincia de Buenos Aires", "Merlo", "Merlo"), "gba-merlo"],
    [addr("Ciudad Autónoma de Buenos Aires", "Buenos Aires", undefined, [{ long_name: "Palermo", types: ["sublocality_level_1", "sublocality"] }]), "caba-palermo"],
  ])("ubica la dirección %#", (components, code) => {
    expect(matchZone(components, zones)?.code).toBe(code);
  });

  it("fuera de la Argentina no asigna zona", () => {
    expect(matchZone(addr("Montevideo", "Montevideo"), zones)).toBeNull();
  });

  it.each([
    ["Morón, Buenos Aires", "gba-moron"], ["Córdoba capital", "cba-capital"], ["Godoy Cruz, Mendoza", "mza-gran-mendoza"], ["estoy en Rosario", "sfe-rosario"],
    ["Bariloche", "rn-bariloche"], ["un pueblo de La Pampa", "lp-resto"], ["Palermo", "caba-palermo"], ["Merlo, San Luis", "sl-san-luis"], ["Salta", "sal-capital"],
  ])("reconoce «%s» escrito a mano", (text, code) => {
    expect(guessZoneFromText(text, zones)?.code).toBe(code);
  });

  it("no inventa una zona con nombres genéricos", () => {
    expect(guessZoneFromText("vivo en el centro, cerca de la capital", zones)).toBeNull();
  });

  it("ubica por coordenadas las ciudades principales", () => {
    expect(nearestZoneCode(-31.42, -64.19)).toBe("cba-capital");
    expect(nearestZoneCode(-32.95, -60.65)).toBe("sfe-rosario");
    expect(nearestZoneCode(-34.6, -58.42)).toMatch(/^caba-/);
  });

  it("cada provincia tiene exactamente una zona comodín y los códigos no se repiten", () => {
    const provinces = [...new Set(NATIONAL_ZONES.map((z) => z.province))];
    expect(provinces).toHaveLength(23);
    for (const p of provinces) expect(NATIONAL_ZONES.filter((z) => z.province === p && z.catchAll)).toHaveLength(1);
    expect(new Set(NATIONAL_ZONES.map((z) => z.code)).size).toBe(NATIONAL_ZONES.length);
  });
});
