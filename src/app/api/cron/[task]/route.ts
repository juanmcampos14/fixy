/** Una tarea programada por ruta: /api/cron/<tarea> (ver src/server/ops/tasks.ts y vercel.json). */
import { cronAuthorized } from "@/server/ops/cron-auth";
import { runTask } from "@/server/ops/cron";
import { TASKS, isTask, type TaskDef } from "@/server/ops/tasks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function run(req: Request, { params }: { params: Promise<{ task: string }> }) {
  if (!cronAuthorized(req)) return new Response("No autorizado", { status: 401 });
  const { task } = await params;
  if (!isTask(task)) return new Response("Tarea desconocida", { status: 404 });
  const def: TaskDef = TASKS[task];
  const r = await runTask(task, "cron", def.maxSeconds, def.run);
  return Response.json(r, { status: "ok" in r && r.ok === false ? 500 : 200 });
}

export const GET = run;
export const POST = run;
