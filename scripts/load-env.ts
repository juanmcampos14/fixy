import { config } from "dotenv";
import { existsSync } from "node:fs";

/** Carga .env.local (o .env) para scripts fuera de Next.js. */
export function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    if (existsSync(f)) config({ path: f, quiet: true });
  }
}
