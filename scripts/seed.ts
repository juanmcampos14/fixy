/* Carga datos base y, si DEMO_MODE=true o se pasa --demo, datos de demostración. */
import { loadEnv } from "./load-env";
loadEnv();

async function main() {
  const { sql } = await import("@/server/db/client");
  const { seedBase } = await import("@/server/seed/base");
  const { seedDemo } = await import("@/server/seed/demo");
  await seedBase(sql());
  console.log("✔ Datos base (zonas, catálogo, comisiones, políticas).");
  if (process.argv.includes("--demo") || process.env.DEMO_MODE === "true") {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "true") {
      throw new Error("No se cargan datos de demostración en producción. Para un entorno de demo separado, usá ALLOW_DEMO_SEED=true y DEMO_SEED_PASSWORD.");
    }
    await seedDemo(sql());
  }
  await sql().end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
