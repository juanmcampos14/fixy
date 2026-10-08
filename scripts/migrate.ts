/* Aplica migraciones SQL en orden. Uso: npm run db:migrate [-- --reset] */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { loadEnv } from "./load-env";

export async function migrate(url: string, opts: { reset?: boolean; quiet?: boolean } = {}) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    if (opts.reset) {
      await sql.unsafe(`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS app CASCADE; CREATE SCHEMA public;`);
    }
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await sql`SELECT name FROM schema_migrations`).map((r) => r.name as string));
    const dir = join(process.cwd(), "db", "migrations");
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      const content = readFileSync(join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`INSERT INTO schema_migrations (name) VALUES (${f})`;
      });
      if (!opts.quiet) console.log(`✔ migración aplicada: ${f}`);
    }
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  loadEnv();
  const reset = process.argv.includes("--reset");
  migrate(process.env.DATABASE_URL!, { reset })
    .then(() => console.log("Migraciones al día."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
