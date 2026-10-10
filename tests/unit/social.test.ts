import { describe, expect, it } from "vitest";
import { normalizeSocial, normalizeSocialLinks } from "@/lib/social";

describe("redes sociales del profesional", () => {
  it("acepta usuarios y links de cada red", () => {
    expect(normalizeSocial("instagram", "@plomeria.sosa")).toEqual({ ok: true, url: "https://www.instagram.com/plomeria.sosa" });
    expect(normalizeSocial("instagram", "instagram.com/plomeriasosa/")).toEqual({ ok: true, url: "https://instagram.com/plomeriasosa/" });
    expect(normalizeSocial("tiktok", "@sosa_arregla")).toEqual({ ok: true, url: "https://www.tiktok.com/@sosa_arregla" });
    expect(normalizeSocial("website", "sosa.com.ar")).toEqual({ ok: true, url: "https://sosa.com.ar/" });
    expect(normalizeSocial("facebook", "")).toEqual({ ok: true, url: "" });
  });

  it("rechaza mensajería, teléfonos, acortadores y links de otra red", () => {
    expect(normalizeSocial("website", "https://wa.me/5491155550000").ok).toBe(false);
    expect(normalizeSocial("website", "t.me/sosa").ok).toBe(false);
    expect(normalizeSocial("website", "bit.ly/abc").ok).toBe(false);
    expect(normalizeSocial("instagram", "https://facebook.com/sosa").ok).toBe(false);
    expect(normalizeSocial("instagram", "instagram.com").ok).toBe(false);
    expect(normalizeSocial("website", "tel:1155550000").ok).toBe(false);
    expect(normalizeSocial("website", "https://sosa.com.ar/llamame-11-5555-0000").ok).toBe(false);
    expect(normalizeSocialLinks({ instagram: "@ok_user", website: "wa.me/1" }).errors).toHaveLength(1);
  });
});
