import { describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import { authenticate, signInWithGoogle } from "@/server/modules/users";
import { actor } from "./helpers";

describe("ingreso con Google", () => {
  it("crea la cuenta sin contraseña, vuelve a ingresar por el mismo identificador y no permite contraseña", async () => {
    const email = `nuevo.google.${Date.now()}@gmail.com`;
    const a = await signInWithGoogle({ sub: `g-${Date.now()}`, email, emailVerified: true, name: "Ana Google" });
    expect(a.created).toBe(true);
    const [u] = await sql()<{ password_hash: string | null; full_name: string }[]>`select password_hash, full_name from users where id = ${a.userId}`;
    expect(u).toEqual({ password_hash: null, full_name: "Ana Google" });
    const [{ n }] = await sql()<{ n: number }[]>`select count(*)::int as n from policy_acceptances where user_id = ${a.userId}`;
    expect(n).toBeGreaterThanOrEqual(2);
    await expect(authenticate(email, "cualquier-clave")).rejects.toThrow(/Google/);
  });

  it("vincula una cuenta existente con el mismo email verificado; rechaza emails no verificados y otra cuenta de Google", async () => {
    const ana = await actor("ana");
    const sub = `g-ana-${Date.now()}`;
    await expect(signInWithGoogle({ sub, email: ana.email, emailVerified: false, name: "Ana" })).rejects.toThrow(/verificado/);
    const r = await signInWithGoogle({ sub, email: ana.email.toUpperCase(), emailVerified: true, name: "Ana" });
    expect(r).toEqual({ userId: ana.id, created: false });
    expect((await signInWithGoogle({ sub, email: "otro@gmail.com", emailVerified: true, name: "x" })).userId).toBe(ana.id);
    await expect(signInWithGoogle({ sub: `otra-${sub}`, email: ana.email, emailVerified: true, name: "Ana" })).rejects.toThrow(/otra cuenta de Google/);
  });
});
