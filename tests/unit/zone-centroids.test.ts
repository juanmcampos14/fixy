import { describe, expect, it } from "vitest";
import { nearestZoneCode } from "@/lib/zone-centroids";

describe("zona por coordenadas", () => {
  it("ubica puntos conocidos", () => {
    expect(nearestZoneCode(-34.343273, -58.722935)).toBe("gba-escobar"); // Puertos, Escobar
    expect(nearestZoneCode(-34.5627, -58.4565)).toBe("caba-belgrano");
    expect(nearestZoneCode(-34.4587, -58.9139)).toBe("gba-pilar");
    expect(nearestZoneCode(-31.4201, -64.1888)).toBe("cba-capital"); // Córdoba: con cobertura nacional
    expect(nearestZoneCode(-34.9011, -56.1645)).toBeNull(); // Montevideo: fuera del país
  });
});
