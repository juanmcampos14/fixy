import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHandoff, redeemHandoff, validChallenge } from "@/server/auth/app-handoff";
import { sql } from "@/server/db/client";
import { registerUser } from "@/server/modules/users";

const pair = () => {
  const verifier = randomBytes(48).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

describe("ingreso con Google dentro de la app (traspaso de sesión)", () => {
  it("el código se canjea una sola vez y solo con el secreto de la app que lo pidió", async () => {
    const userId = await registerUser({ fullName: "Persona App", email: `app.${Date.now()}@test.local`, password: "password-123", acceptTerms: true, phone: "1155550000" });
    const { verifier, challenge } = pair();
    expect(validChallenge(challenge)).toBe(true);

    const code = await createHandoff(userId, challenge, "/app/solicitudes");
    // Otra app (otro secreto) no puede usar el código, y el intento lo invalida.
    expect(await redeemHandoff(code, pair().verifier)).toBeNull();
    expect(await redeemHandoff(code, verifier)).toBeNull();

    const second = await createHandoff(userId, challenge, "/app/solicitudes");
    expect(await redeemHandoff(second, verifier)).toEqual({ userId, next: "/app/solicitudes" });
    expect(await redeemHandoff(second, verifier)).toBeNull();
  });

  it("un código vencido no sirve", async () => {
    const userId = await registerUser({ fullName: "Persona App", email: `app2.${Date.now()}@test.local`, password: "password-123", acceptTerms: true, phone: "1155550000" });
    const { verifier, challenge } = pair();
    const code = await createHandoff(userId, challenge, "/app");
    await sql()`update app_login_handoffs set expires_at = now() - interval '1 second' where user_id = ${userId}`;
    expect(await redeemHandoff(code, verifier)).toBeNull();
  });

  it("rechaza desafíos con formato inválido", () => {
    expect(validChallenge("corto")).toBe(false);
    expect(validChallenge(null)).toBe(false);
  });
});
