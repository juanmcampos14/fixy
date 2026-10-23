/**
 * Carga inicial del CRM de captación desde archivos CSV exportados de la planilla de research.
 *   npx tsx scripts/supply-import.ts proveedores.csv [barrios.csv]
 * Es idempotente: se puede volver a correr (solo agrega lo nuevo y completa vacíos).
 */
import { readFileSync } from "node:fs";
import { loadEnv } from "./load-env";

loadEnv();
const [leadsCsv, gatedCsv] = process.argv.slice(2);
if (!leadsCsv) {
  console.error("Uso: npx tsx scripts/supply-import.ts proveedores.csv [barrios.csv]");
  process.exit(1);
}
async function main() {
  const { parseCsv } = await import("../src/lib/csv");
  const supply = await import("../src/server/modules/supply");
  const { inputs, issues } = supply.parseResearchRows(parseCsv(readFileSync(leadsCsv, "utf8")));
  const r = await supply.importLeads(inputs, { source: "research", sourceDetail: "Planilla PROVEEDORES (carga inicial)", trigger: "initial", preIssues: issues });
  console.log(`Candidatos: ${r.inserted} nuevos, ${r.updated} actualizados, ${r.unchanged} sin cambios, ${r.skipped} salteados.`);
  for (const i of r.issues) console.log(`  ${i.code}: ${i.problem}`);
  if (gatedCsv) console.log(`Barrios cerrados: ${await supply.importGatedCommunities(parseCsv(readFileSync(gatedCsv, "utf8")))}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
