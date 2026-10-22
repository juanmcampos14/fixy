/**
 * Estado público mínimo para monitores externos (UptimeRobot, Better Stack…): responde 200 si la web y la base
 * contestan, 503 si no. No expone nada interno; el detalle está en Operación → Salud del sistema.
 */
import { sql } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await Promise.race([sql()`select 1`, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000))]);
    return Response.json({ ok: true, db: true, ms: Date.now() - started, version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, db: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
