import { describe, expect, it } from "vitest";
import { matchZone, ZONE_MATCH_NAMES, type MatchZone } from "@/lib/zone-match";

const zones: MatchZone[] = Object.entries(ZONE_MATCH_NAMES).map(([code, match_names]) => ({ id: code, code, region: code.startsWith("caba") ? "CABA" : "GBA", match_names }));
const caba = { long_name: "Ciudad Autónoma de Buenos Aires", types: ["administrative_area_level_1", "political"] };
const pba = { long_name: "Provincia de Buenos Aires", types: ["administrative_area_level_1", "political"] };

describe("zona desde la dirección de Google", () => {
  it("CABA por barrio", () => {
    expect(matchZone([{ long_name: "Villa Crespo", types: ["sublocality_level_1", "sublocality"] }, caba], zones)?.code).toBe("caba-palermo");
    expect(matchZone([{ longText: "Núñez", types: ["neighborhood"] }, caba], zones)?.code).toBe("caba-belgrano");
  });
  it("GBA por partido, aunque la localidad sea ambigua", () => {
    expect(matchZone([{ long_name: "Villa Adelina", types: ["locality"] }, { long_name: "Partido de San Isidro", types: ["administrative_area_level_2"] }, pba], zones)?.code).toBe("gba-san-isidro");
    expect(matchZone([{ long_name: "Olivos", types: ["locality"] }, { long_name: "Vicente López Partido", types: ["administrative_area_level_2"] }, pba], zones)?.code).toBe("gba-vicente-lopez");
  });
  it("fuera de cobertura", () => {
    expect(matchZone([{ long_name: "La Plata", types: ["locality"] }, { long_name: "La Plata", types: ["administrative_area_level_2"] }, pba], zones)).toBeNull();
    expect(matchZone([{ long_name: "Rosario", types: ["locality"] }, { long_name: "Santa Fe", types: ["administrative_area_level_1"] }], zones)).toBeNull();
  });
});
