/*
 * Aplica migraciones y datos base (sin demo) en Supabase usando SUPABASE_DB_URL de .env.supabase.local.
 * Nunca imprime la cadena de conexión.
 */
import { config } from "dotenv";
config({ path: ".env.supabase.local", quiet: true });

(async () => {
  let url = process.env.SUPABASE_DB_URL ?? "";
  if (!url.startsWith("postgres")) throw new Error("Falta SUPABASE_DB_URL en .env.supabase.local");
  if (!/sslmode=/.test(url)) url += (url.includes("?") ? "&" : "?") + "sslmode=require";
  const host = new URL(url.replace(/^postgres(ql)?:/, "http:")).host;
  console.log(`Conectando a ${host.replace(/^.*@/, "")} …`);
  process.env.DATABASE_URL = url;
  process.env.FILE_SIGNING_SECRET ||= "x".repeat(32);
  process.env.MOCK_WEBHOOK_SECRET ||= "x".repeat(32);
  const { migrate } = await import("./migrate");
  await migrate(url);
  const { sql } = await import("@/server/db/client");
  const { seedBase } = await import("@/server/seed/base");
  await seedBase(sql());
  const [c] = await sql()<{ cats: number; zones: number; rules: number; tables: number; anon: number }[]>`
    select (select count(*)::int from categories) as cats, (select count(*)::int from zones) as zones,
           (select count(*)::int from commission_rules where active) as rules,
           (select count(*)::int from pg_tables where schemaname = 'public') as tables,
           (select count(*)::int from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public') as anon`;
  console.log(`✔ Listo: ${c.tables} tablas, ${c.cats} categorías, ${c.zones} zonas, ${c.rules} regla(s) de comisión activa(s). Permisos de anon en public: ${c.anon}.`);
  await sql().end();
})().catch((e) => {
  console.error("✘", (e as Error).message.replace(/postgres(ql)?:\/\/[^\s]+/g, "[cadena oculta]"));
  process.exit(1);
});
