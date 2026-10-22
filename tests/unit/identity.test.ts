import { describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { base32Encode, matchTotp, totpAt } from "@/server/auth/mfa";
import { verifyGoogleIdToken } from "@/server/auth/google";
import { sessionIsExpired } from "@/server/auth/session";

describe("TOTP (RFC 6238)", () => {
  // Vector oficial: secreto ASCII "12345678901234567890", T = 59 s → 94287082 (8 dígitos) → 287082 con 6.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("coincide con el vector de la RFC", () => {
    expect(totpAt(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(secret, Math.floor(1111111109 / 30))).toBe("081804");
  });
  it("acepta el paso anterior y el siguiente, no más", () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(matchTotp(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totpAt(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, totpAt(secret, step - 2), now)).toBeNull();
    expect(matchTotp(secret, "12345a", now)).toBeNull();
  });
});

describe("sesiones", () => {
  const h = 3600_000;
  const now = Date.UTC(2026, 9, 22, 12);
  it("las del equipo vencen tras 12 h sin uso o 7 días; las demás tras 14 días sin uso o 30 días", () => {
    expect(sessionIsExpired(true, new Date(now - 2 * h), new Date(now - 11 * h), now)).toBe(false);
    expect(sessionIsExpired(true, new Date(now - 2 * h), new Date(now - 13 * h), now)).toBe(true);
    expect(sessionIsExpired(true, new Date(now - 8 * 24 * h), new Date(now - h), now)).toBe(true);
    expect(sessionIsExpired(false, new Date(now - 10 * 24 * h), new Date(now - 13 * 24 * h), now)).toBe(false);
    expect(sessionIsExpired(false, new Date(now - 20 * 24 * h), new Date(now - 15 * 24 * h), now)).toBe(true);
    expect(sessionIsExpired(false, new Date(now - 31 * 24 * h), new Date(now - h), now)).toBe(true);
  });
});

describe("ingreso con Google: validación del id_token", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const other = await generateKeyPair("RS256");
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" }] });
  const clientId = "cliente.apps.googleusercontent.com";
  const nonce = "nonce-123";
  const token = (claims: Record<string, unknown> = {}, key = privateKey, kid = "k1") =>
    new SignJWT({ email: "ana@gmail.com", email_verified: true, name: "Ana", nonce, azp: clientId, ...claims })
      .setProtectedHeader({ alg: "RS256", kid }).setIssuer("https://accounts.google.com").setAudience(clientId)
      .setSubject("1234567890").setIssuedAt().setExpirationTime("5m").sign(key);

  it("acepta un token válido e identifica por sub", async () => {
    expect(await verifyGoogleIdToken(await token(), { clientId, nonce, keys })).toEqual({ sub: "1234567890", email: "ana@gmail.com", emailVerified: true, name: "Ana" });
  });
  it("rechaza firma, emisor, audiencia, azp, nonce, vencimiento y sujeto inválidos", async () => {
    const bad = async (t: Promise<string>, re?: RegExp) => expect(verifyGoogleIdToken(await t, { clientId, nonce, keys })).rejects.toThrow(re);
    await bad(token({}, other.privateKey));
    await bad(new SignJWT({ nonce }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer("https://evil.example").setAudience(clientId).setSubject("1").setIssuedAt().setExpirationTime("5m").sign(privateKey));
    await bad(new SignJWT({ nonce }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer("https://accounts.google.com").setAudience("otro").setSubject("1").setIssuedAt().setExpirationTime("5m").sign(privateKey));
    await bad(token({ azp: "otro-cliente" }), /autorizado/);
    await bad(token({ nonce: "otro" }), /Nonce/);
    await bad(new SignJWT({ nonce, email: "a@b.c" }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer("https://accounts.google.com").setAudience(clientId).setSubject("1").setIssuedAt(Math.floor(Date.now() / 1000) - 7200).setExpirationTime(Math.floor(Date.now() / 1000) - 3600).sign(privateKey));
    await bad(new SignJWT({ nonce, email: "a@b.c" }).setProtectedHeader({ alg: "RS256", kid: "k1" }).setIssuer("https://accounts.google.com").setAudience(clientId).setIssuedAt().setExpirationTime("5m").sign(privateKey));
  });
});
