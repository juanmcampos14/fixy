import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, verifyPassword } from "@/server/auth/password";

describe("contraseñas", () => {
  it("con los parámetros de producción (N = 2^17) guarda el formato con parámetros y verifica", async () => {
    const h = await hashPassword("clave-segura-123", { N: 2 ** 17, r: 8, p: 1 });
    expect(h).toMatch(/^scrypt\$131072\$8\$1\$[^$]+\$[^$]+$/);
    expect(await verifyPassword("clave-segura-123", h)).toBe(true);
    expect(await verifyPassword("otra", h)).toBe(false);
  });

  it("acepta el formato anterior y pide volver a cifrarlo", async () => {
    const actual = await hashPassword("clave-vieja-1", { N: 2 ** 14, r: 8, p: 1 });
    const [, n, , , salt, hash] = actual.split("$");
    const viejo = `scrypt$${n}$${salt}$${hash}`;
    expect(await verifyPassword("clave-vieja-1", viejo)).toBe(true);
    expect(needsRehash(viejo)).toBe(true);
    expect(needsRehash(await hashPassword("x"))).toBe(false);
  });

  it("rechaza parámetros manipulados que pedirían memoria o tiempo desmedidos", async () => {
    expect(await verifyPassword("x", "scrypt$1073741824$8$1$c2FsdA==$aGFzaA==")).toBe(false);
    expect(await verifyPassword("x", "scrypt$1000$8$1$c2FsdA==$aGFzaA==")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$10$abc")).toBe(false);
  });
});
