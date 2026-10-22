/**
 * Etapa 2 de la auditoría (skill fixy-harden-auth): segundo factor del equipo, contraseñas con parámetros viejos y
 * lectura del equipo por sección en la base (RLS).
 */
import { describe, expect, it } from "vitest";
import { asUser, sql, systemTx } from "@/server/db/client";
import { loadActor, type Actor } from "@/server/auth/actor";
import { currentStep, decryptSecret, totpAt } from "@/server/auth/mfa";
import { hashPassword } from "@/server/auth/password";
import { confirmMfaEnrollment, mfaStatus, regenerateRecoveryCodes, resetMemberMfa, startMfaEnrollment, verifyMfaCode } from "@/server/modules/mfa";
import { authenticate, registerUser } from "@/server/modules/users";
import { actor } from "./helpers";

const reload = async (id: string) => (await systemTx((tx) => loadActor(tx, id)))!;

/** Cuenta nueva del equipo con un rol o permisos dados (sin pasar por invitación). */
async function teamMember(tag: string, role: "operator" | "team", sections: string[] = []): Promise<Actor> {
  const id = await registerUser({ fullName: `Equipo ${tag}`, email: `equipo.${tag}.${Date.now()}@test.local`, password: "password-123", acceptTerms: true });
  await sql()`update users set platform_role = ${role}, email_verified = true where id = ${id}`;
  for (const s of sections) await sql()`insert into admin_permissions (user_id, section, level) values (${id}, ${s}, 'view')`;
  return reload(id);
}

describe("segundo factor del equipo", () => {
  it("se activa con un código de la app; el secreto queda cifrado y un código no sirve dos veces", async () => {
    const op = await teamMember("mfa", "operator");
    await expect(startMfaEnrollment(await actor("ana"))).rejects.toThrow(/equipo/);
    const { secret, uri } = await startMfaEnrollment(op);
    expect(uri).toMatch(/^otpauth:\/\/totp\/Fixy%3A.*secret=/);
    expect((await startMfaEnrollment(op)).secret).toBe(secret); // recargar la página no cambia el secreto

    const [row] = await sql()<{ secret_enc: string }[]>`select secret_enc from user_mfa where user_id = ${op.id}`;
    expect(row.secret_enc).not.toContain(secret);
    expect(decryptSecret(row.secret_enc)).toBe(secret);

    await expect(confirmMfaEnrollment(op, "000000")).rejects.toThrow(/no coincide/);
    const step = currentStep();
    const codes = await confirmMfaEnrollment(op, totpAt(secret, step));
    expect(codes).toHaveLength(10);
    expect(await mfaStatus(op)).toMatchObject({ enabled: true, recoveryLeft: 10 });
    // El mismo código (mismo paso) ya se usó.
    await expect(verifyMfaCode(op, totpAt(secret, step))).rejects.toThrow(/ya se usó/);
    await expect(verifyMfaCode(op, totpAt(secret, step + 1))).resolves.toEqual({ recovery: false });

    // Códigos de respaldo: uno sirve una sola vez; en la base solo hay hashes.
    expect(await verifyMfaCode(op, codes[0])).toEqual({ recovery: true });
    await expect(verifyMfaCode(op, codes[0])).rejects.toThrow(/no es válido/);
    expect(await sql()`select 1 from user_mfa_recovery_codes where code_hash = ${codes[1]}`).toHaveLength(0);
    expect((await mfaStatus(op)).recoveryLeft).toBe(9);
    expect(await sql()`select 1 from audit_log where action = 'mfa.enabled' and entity_id = ${op.id}`).toHaveLength(1);
  });

  it("generar códigos nuevos anula los anteriores; el dueño reinicia el segundo factor y cierra las sesiones", async () => {
    const op = await teamMember("mfa2", "operator");
    const { secret } = await startMfaEnrollment(op);
    const step = currentStep();
    const old = await confirmMfaEnrollment(op, totpAt(secret, step - 1));
    const fresh = await regenerateRecoveryCodes(op, totpAt(secret, step));
    await expect(verifyMfaCode(op, old[0])).rejects.toThrow(/no es válido/);
    expect(await verifyMfaCode(op, fresh[0])).toEqual({ recovery: true });

    await sql()`insert into sessions (token_hash, user_id, expires_at) values (${`s-${op.id}`}, ${op.id}, now() + interval '1 day')`;
    await expect(resetMemberMfa(await actor("operador"), op.id, "Perdió el celular y los códigos")).rejects.toThrow(/dueño/);
    await expect(resetMemberMfa(await actor("admin"), op.id, "corto")).rejects.toThrow(/motivo/);
    await resetMemberMfa(await actor("admin"), op.id, "Perdió el celular; verificado por videollamada");
    expect(await mfaStatus(op)).toMatchObject({ enabled: false });
    expect(await sql()`select 1 from sessions where user_id = ${op.id}`).toHaveLength(0);
    expect(await sql()`select 1 from audit_log where action = 'mfa.reset' and entity_id = ${op.id}`).toHaveLength(1);
  });

  it("muchos intentos fallidos se frenan", async () => {
    const op = await teamMember("mfa3", "operator");
    const { secret } = await startMfaEnrollment(op);
    await confirmMfaEnrollment(op, totpAt(secret, currentStep()));
    let limited = false;
    for (let i = 0; i < 12 && !limited; i++) {
      await verifyMfaCode(op, "999999").catch((e: Error) => { limited = /Demasiados intentos/.test(e.message); });
    }
    expect(limited).toBe(true);
  });
});

describe("contraseñas guardadas con parámetros viejos", () => {
  it("se vuelven a cifrar con los actuales al ingresar", async () => {
    const id = await registerUser({ fullName: "Clave Vieja", email: `vieja.${Date.now()}@test.local`, password: "password-123", acceptTerms: true });
    const modern = await hashPassword("clave-antigua-9");
    const [, n, , , salt, hash] = modern.split("$");
    await sql()`update users set password_hash = ${`scrypt$${n}$${salt}$${hash}`} where id = ${id}`;
    const [{ email }] = await sql()<{ email: string }[]>`select email from users where id = ${id}`;
    expect(await authenticate(email, "clave-antigua-9")).toBe(id);
    const [after] = await sql()<{ password_hash: string }[]>`select password_hash from users where id = ${id}`;
    expect(after.password_hash.split("$")).toHaveLength(6);
    expect(await authenticate(email, "clave-antigua-9")).toBe(id);
  });
});

describe("lectura del equipo por sección (RLS)", () => {
  const counts = (userId: string) => asUser(userId, async (tx) => {
    const one = async (q: Promise<{ n: number }[]>) => (await q)[0].n;
    return {
      ledger: await one(tx`select count(*)::int as n from ledger_entries`),
      charges: await one(tx`select count(*)::int as n from charges`),
      audit: await one(tx`select count(*)::int as n from audit_log`),
      docs: await one(tx`select count(*)::int as n from provider_documents`),
      privateProviderFiles: await one(tx`select count(*)::int as n from files where owner_type = 'provider' and visibility <> 'public'`),
      jobs: await one(tx`select count(*)::int as n from jobs`),
    };
  });

  it("un miembro solo con Catálogo no lee finanzas, documentos ni auditoría; con esas secciones sí", async () => {
    const cat = await teamMember("rls-cat", "team", ["catalogo"]);
    const c = await counts(cat.id);
    expect(c).toMatchObject({ ledger: 0, charges: 0, audit: 0, docs: 0, privateProviderFiles: 0 });
    expect(c.jobs).toBeGreaterThan(0); // el resto de la operación sigue igual

    const fin = await teamMember("rls-fin", "team", ["finanzas", "proveedores", "auditoria"]);
    const f = await counts(fin.id);
    expect(f.ledger).toBeGreaterThan(0);
    expect(f.charges).toBeGreaterThan(0);
    expect(f.audit).toBeGreaterThan(0);
    expect(f.docs).toBeGreaterThan(0);

    const ops = await counts((await teamMember("rls-op", "operator")).id);
    expect(ops.ledger).toBeGreaterThan(0);
  });

  it("un cliente sigue sin ver el registro financiero ni la auditoría", async () => {
    const c = await counts((await actor("ana")).id);
    expect(c.ledger).toBe(0);
    expect(c.audit).toBe(0);
  });
});
