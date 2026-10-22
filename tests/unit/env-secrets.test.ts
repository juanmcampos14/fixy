import { describe, expect, it } from "vitest";
import { isPlaceholderSecret } from "@/server/env";

describe("claves de ejemplo", () => {
  it("reconoce los valores de .env.example y claves triviales", () => {
    expect(isPlaceholderSecret("change-me-local-file-signing-secret-000000")).toBe(true);
    expect(isPlaceholderSecret("change-me-cron-secret-000000000000")).toBe(true);
    expect(isPlaceholderSecret("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(true);
    expect(isPlaceholderSecret("abababababababababababababababab")).toBe(true);
  });

  it("acepta claves aleatorias", () => {
    expect(isPlaceholderSecret("Zq3v9-Lk2pXw7_RtYb8NcMd4FhJs6GaE1uQo0iTe5yWrKz")).toBe(false);
    expect(isPlaceholderSecret("3f9c1a7e5b2d8f04c6e1a9b7d3f5c2e8a0b4d6f1c3e5a7b9")).toBe(false);
  });
});
