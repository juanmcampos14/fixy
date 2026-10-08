import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { processOutbox } from "@/server/notifications";
import { sql } from "@/server/db/client";
import { expireQuotes } from "@/server/modules/quotes";
import { processReviewTasks } from "@/server/modules/disputes";
import { processReviewDisputeDeadlines } from "@/server/modules/review-disputes";

/** Tareas periódicas (llamar con cron externo): envíos pendientes y vencimiento de presupuestos. */
async function run(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const expected = env().CRON_SECRET;
  if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return new Response("No autorizado", { status: 401 });
  }
  const reviews = await processReviewTasks();
  const reviewDisputes = await processReviewDisputeDeadlines();
  const outbox = await processOutbox(100);
  const expired = await sql().begin((tx) => expireQuotes(tx as never));
  return Response.json({ outbox, expiredQuotes: expired, reviews, reviewDisputes });
}

// Vercel Cron llama con GET y envía "Authorization: Bearer $CRON_SECRET".
export const GET = run;
export const POST = run;
