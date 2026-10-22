import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { registerUser, signInWithGoogle } from "@/server/modules/users";
import { assertContactVerified, confirmEmail, sendEmailVerificationTx } from "@/server/modules/email-verification";
import { createCharge } from "@/server/modules/payments";
import { lastVerifyToken } from "./helpers";

const fresh = async (tag: string) => {
  const email = `${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}@test.local`;
  const id = await registerUser({ fullName: "Persona Prueba", email, password: "password-123", acceptTerms: true });
  return { id, email };
};
const verified = async (id: string) => (await sql()<{ v: boolean }[]>`select email_verified as v from users where id = ${id}`)[0].v;

describe("confirmación de email", () => {
  it("el registro clásico queda sin confirmar y encola el enlace", async () => {
    const { id } = await fresh("nuevo");
    expect(await verified(id)).toBe(false);
    expect(await lastVerifyToken(id)).toBeTruthy();
    expect(await sql()`select 1 from email_verifications where user_id = ${id} and token_hash is not null`).toHaveLength(1);
  });

  it("el enlace confirma una sola vez; repetido, inventado o vencido falla", async () => {
    const { id } = await fresh("token");
    const token = (await lastVerifyToken(id))!;
    await expect(confirmEmail(`${token}x`)).rejects.toThrow(/venció o ya fue usado/);
    await confirmEmail(token);
    expect(await verified(id)).toBe(true);
    await expect(confirmEmail(token)).rejects.toThrow(/venció o ya fue usado/);

    const other = await fresh("vencido");
    await sql()`update email_verifications set expires_at = now() - interval '1 minute' where user_id = ${other.id}`;
    await expect(confirmEmail((await lastVerifyToken(other.id))!)).rejects.toThrow(/venció o ya fue usado/);
    expect(await verified(other.id)).toBe(false);
  });

  it("dos aperturas simultáneas del mismo enlace confirman una sola vez", async () => {
    const { id } = await fresh("doble");
    const token = (await lastVerifyToken(id))!;
    const results = await Promise.allSettled([confirmEmail(token), confirmEmail(token)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await sql()`select 1 from audit_log where action = 'user.email_verified' and entity_id = ${id}`).toHaveLength(1);
  });

  it("reenviar anula el enlace anterior y respeta el límite por hora", async () => {
    const { id } = await fresh("reenvio");
    const first = (await lastVerifyToken(id))!;
    expect(await systemTx((tx) => sendEmailVerificationTx(tx, id))).toBe(true);
    await expect(confirmEmail(first)).rejects.toThrow(/venció o ya fue usado/);
    expect(await systemTx((tx) => sendEmailVerificationTx(tx, id))).toBe(true);
    expect(await systemTx((tx) => sendEmailVerificationTx(tx, id))).toBe(false); // 3 en la última hora
    await confirmEmail((await lastVerifyToken(id))!);
    expect(await verified(id)).toBe(true);
  });

  it("si el email de la cuenta cambió, el enlace viejo no confirma el nuevo", async () => {
    const { id } = await fresh("cambio");
    const token = (await lastVerifyToken(id))!;
    await sql()`update users set email = ${`otro.${Date.now()}@test.local`} where id = ${id}`;
    await expect(confirmEmail(token)).rejects.toThrow(/ya no corresponde/);
    expect(await verified(id)).toBe(false);
  });

  it("sin contacto probado no puede pagar; con email confirmado o WhatsApp vinculado sí", async () => {
    const { id } = await fresh("pago");
    await expect(systemTx((tx) => createCharge(tx, {
      jobId: "00000000-0000-0000-0000-000000000000", kind: "visit", amountMinor: 100, clientFeeMinor: 0, taxMinor: 0,
      providerFeeMinor: 0, providerNetMinor: 100, payerUserId: id, description: "x", payoutAccountRef: null,
    }))).rejects.toThrow(/confirmá tu email/);

    await sql()`update users set whatsapp_phone = ${`5491100${Date.now().toString().slice(-6)}`} where id = ${id}`;
    await expect(systemTx((tx) => assertContactVerified(tx, id, "pagar"))).resolves.toBeUndefined();

    const other = await fresh("pago2");
    await confirmEmail((await lastVerifyToken(other.id))!);
    await expect(systemTx((tx) => assertContactVerified(tx, other.id, "pagar"))).resolves.toBeUndefined();
  });

  it("Google prueba el email: la cuenta nace confirmada y al vincular una clásica la confirma", async () => {
    const g = await signInWithGoogle({ sub: `g-${Date.now()}`, email: `g.${Date.now()}@test.local`, emailVerified: true, name: "Gu" });
    expect(await verified(g.userId)).toBe(true);
    const { id, email } = await fresh("vincular");
    await signInWithGoogle({ sub: `g2-${Date.now()}`, email, emailVerified: true, name: "Vi" });
    expect(await verified(id)).toBe(true);
  });
});
