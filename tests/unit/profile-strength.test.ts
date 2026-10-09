import { describe, expect, it } from "vitest";
import { profileStrength, rankingBoost, type ProfileFacts } from "@/lib/profile-strength";

const empty: ProfileFacts = { hasAvatar: false, descriptionLength: 0, hasPhone: false, hasYears: false, categories: 0, zones: 0, hasBaseZone: false, availabilitySlots: 0, photos: 0, identity: "none", credentialsComplete: false, priceRefs: 0, visitConfigured: false, payoutsEnabled: false };

describe("fuerza del perfil", () => {
  it("vacío = 0, completo = 100", () => {
    expect(profileStrength(empty).score).toBe(0);
    const full: ProfileFacts = { hasAvatar: true, descriptionLength: 200, hasPhone: true, hasYears: true, categories: 2, zones: 3, hasBaseZone: true, availabilitySlots: 5, photos: 4, identity: "verified", credentialsComplete: true, priceRefs: 3, visitConfigured: true, payoutsEnabled: true };
    expect(profileStrength(full)).toMatchObject({ score: 100, level: "Excelente" });
  });
  it("puntaje parcial por fotos e identidad cargada", () => {
    const s = profileStrength({ ...empty, photos: 1, identity: "uploaded" });
    expect(s.score).toBe(13); // 1 foto de trabajo (5) + identidad cargada (8)
  });
  it("el impulso en el ranking va de 0 a 15", () => {
    expect(rankingBoost(0)).toBe(0);
    expect(rankingBoost(100)).toBe(15);
    expect(rankingBoost(50)).toBe(8);
  });
});
