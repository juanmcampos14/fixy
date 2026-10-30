import { describe, expect, it } from "vitest";
import { resolveDbUrl } from "@/server/db/client";

describe("conexión al pooler de Supabase", () => {
  const tx = "postgres://postgres.abc:clave@aws-0-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true";
  it("usa el modo sesión (5432) del mismo host por defecto", () => {
    expect(resolveDbUrl(tx)).toBe("postgres://postgres.abc:clave@aws-0-us-east-1.pooler.supabase.com:5432/postgres");
  });
  it("conserva los otros parámetros", () => {
    expect(resolveDbUrl(`${tx}&sslmode=require`)).toBe("postgres://postgres.abc:clave@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require");
  });
  it("respeta DATABASE_POOL_MODE=transaction y no toca bases locales", () => {
    expect(resolveDbUrl(tx, "transaction")).toBe(tx);
    expect(resolveDbUrl("postgres://fixy:x@localhost:54329/fixy")).toBe("postgres://fixy:x@localhost:54329/fixy");
  });
});
