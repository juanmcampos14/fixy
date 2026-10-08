import { config } from "dotenv";
import { migrate } from "../scripts/migrate";

export default async function setup() {
  config({ path: ".env.example", quiet: true });
  config({ path: ".env.local", override: true, quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !url.includes("test")) throw new Error("TEST_DATABASE_URL debe apuntar a una base de pruebas");
  process.env.DATABASE_URL = url;
  process.env.PAYMENTS_GATEWAY = "mock";
  process.env.STORAGE_DIR = "./.data/test-storage";
  await migrate(url, { reset: true, quiet: true });
  const { sql } = await import("../src/server/db/client");
  const { seedBase } = await import("../src/server/seed/base");
  const { seedDemo } = await import("../src/server/seed/demo");
  await seedBase(sql());
  await seedDemo(sql(), () => {});
  await sql().end();
}
