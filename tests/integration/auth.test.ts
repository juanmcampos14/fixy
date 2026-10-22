import { describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import { authenticate, registerUser, requestPasswordReset, resetPassword } from "@/server/modules/users";
import { verifyEmailOf } from "./helpers";

describe("autenticación", () => {
  it("el registro no otorga roles de plataforma y no admite emails duplicados", async () => {
    const email = `nuevo.${Date.now()}@test.local`;
    const id = await registerUser({ fullName: "Nueva Persona", email, password: "password-123", acceptTerms: true });
    const [u] = await sql()<{ platform_role: string | null }[]>`select platform_role from users where id = ${id}`;
    expect(u.platform_role).toBeNull();
    await expect(registerUser({ fullName: "Otra", email: email.toUpperCase(), password: "password-123", acceptTerms: true })).rejects.toThrow(/Ya existe/);
    await expect(authenticate(email, "incorrecta")).rejects.toThrow(/incorrectos/);
    await expect(authenticate("noexiste@test.local", "x")).rejects.toThrow(/incorrectos/);
    expect(await authenticate(email, "password-123")).toBe(id);
  });

  it("recupera la contraseña con un token de un solo uso", async () => {
    const email = `reset.${Date.now()}@test.local`;
    const id = await registerUser({ fullName: "Reset Persona", email, password: "password-123", acceptTerms: true });
    // Sin confirmar el email no sale el enlace de recuperación.
    await requestPasswordReset(email);
    expect(await sql()`select 1 from password_resets where user_id = ${id}`).toHaveLength(0);
    await verifyEmailOf(id);
    await requestPasswordReset(email);
    await requestPasswordReset("inexistente@test.local"); // no falla ni revela
    const [o] = await sql()<{ payload: { link: string } }[]>`select payload from outbox where recipient_user_id = ${id} order by created_at desc limit 1`;
    const token = o.payload.link.split("/").pop()!;
    await resetPassword(token, "nueva-clave-456");
    expect(await authenticate(email, "nueva-clave-456")).toBe(id);
    await expect(resetPassword(token, "otra-clave-789")).rejects.toThrow(/venció o ya fue usado/);
  });
});
