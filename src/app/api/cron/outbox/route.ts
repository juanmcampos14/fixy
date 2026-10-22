/**
 * Compatibilidad: la ruta vieja corre todas las tareas, cada una aislada (si una falla, las demás siguen).
 * Vercel ya llama a cada tarea por separado (/api/cron/<tarea>); esta queda para ejecuciones manuales de emergencia.
 */
import { cronAuthorized } from "@/server/ops/cron-auth";
import { runTask } from "@/server/ops/cron";
import { TASKS, type TaskDef } from "@/server/ops/tasks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(req: Request) {
  if (!cronAuthorized(req)) return new Response("No autorizado", { status: 401 });
  const results = [];
  for (const [task, def] of Object.entries(TASKS) as [string, TaskDef][]) results.push(await runTask(task, "cron", def.maxSeconds, def.run));
  return Response.json(results);
}

export const GET = run;
export const POST = run;
