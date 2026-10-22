#!/usr/bin/env node
/**
 * Prueba de carga sin dependencias (auditoría: capacidad). Pega a un conjunto de rutas con N usuarios concurrentes
 * durante D segundos y reporta latencia p50/p95/p99, errores y pedidos por segundo, por escenario.
 *
 *   node scripts/load/run.mjs --base http://localhost:3100 --users 20 --seconds 30
 *
 * Nunca contra producción sin avisar: usar un build local (`npm run build && npm run start -- -p 3100`) o staging.
 * Escenarios de solo lectura y pedidos anónimos; los flujos con sesión se miden con las pruebas de integración.
 */
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith("--") ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const BASE = (args.base ?? "http://localhost:3100").replace(/\/$/, "");
const USERS = Number(args.users ?? 20);
const SECONDS = Number(args.seconds ?? 30);
if (/fixy\.solutions/.test(BASE) && args.yes !== "produccion") {
  console.error("Para correr contra producción pasá --yes produccion (y avisá al equipo).");
  process.exit(1);
}

const SCENARIOS = [
  { name: "inicio", weight: 3, path: "/" },
  { name: "pedir servicio", weight: 3, path: "/solicitar" },
  { name: "ficha de oficio", weight: 2, path: "/profesionales" },
  { name: "ingresar", weight: 1, path: "/ingresar" },
  { name: "estado (api/health)", weight: 1, path: "/api/health" },
];
const bag = SCENARIOS.flatMap((s) => Array(s.weight).fill(s));
const stats = new Map(SCENARIOS.map((s) => [s.name, { ms: [], errors: 0 }]));

async function user(deadline) {
  while (Date.now() < deadline) {
    const s = bag[Math.floor(Math.random() * bag.length)];
    const t = performance.now();
    try {
      const r = await fetch(BASE + s.path, { redirect: "manual", signal: AbortSignal.timeout(15000) });
      await r.arrayBuffer();
      if (r.status >= 500) stats.get(s.name).errors++;
    } catch {
      stats.get(s.name).errors++;
    }
    stats.get(s.name).ms.push(performance.now() - t);
  }
}

const pct = (arr, p) => (arr.length ? arr.slice().sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : 0);
const started = Date.now();
await Promise.all(Array.from({ length: USERS }, () => user(started + SECONDS * 1000)));
const elapsed = (Date.now() - started) / 1000;

console.log(`\nBase ${BASE} · ${USERS} usuarios · ${SECONDS} s\n`);
console.log("escenario".padEnd(22), "pedidos".padStart(8), "rps".padStart(7), "p50".padStart(7), "p95".padStart(7), "p99".padStart(7), "errores".padStart(8));
let total = 0;
let errors = 0;
for (const [name, s] of stats) {
  total += s.ms.length;
  errors += s.errors;
  console.log(name.padEnd(22), String(s.ms.length).padStart(8), (s.ms.length / elapsed).toFixed(1).padStart(7),
    `${pct(s.ms, 50).toFixed(0)}`.padStart(7), `${pct(s.ms, 95).toFixed(0)}`.padStart(7), `${pct(s.ms, 99).toFixed(0)}`.padStart(7), String(s.errors).padStart(8));
}
console.log(`\nTotal: ${total} pedidos, ${(total / elapsed).toFixed(1)} rps, ${((errors / Math.max(1, total)) * 100).toFixed(2)} % errores (ms)\n`);
process.exit(errors / Math.max(1, total) > 0.01 ? 1 : 0);
