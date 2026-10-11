import { timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";
import { processOutbox } from "@/server/notifications";
import { sql } from "@/server/db/client";
import { expireQuotes } from "@/server/modules/quotes";
import { processReviewTasks } from "@/server/modules/disputes";
import { processReviewDisputeDeadlines } from "@/server/modules/review-disputes";
import { expireDirectBookings, rematchOpenRequests } from "@/server/modules/requests";
import { processWhatsAppOutbox } from "@/server/whatsapp/outbox";
import { processPushOutbox } from "@/server/push";

/** Tareas periódicas (llamar con cron externo): envíos pendientes y vencimiento de presupuestos. */
async function run(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const expected = env().CRON_SECRET;
  if (token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return new Response("No autorizado", { status: 401 });
  }
  const reviews = await processReviewTasks();
  const reviewDisputes = await processReviewDisputeDeadlines();
  const expiredBookings = await expireDirectBookings();
  // Pedidos sin cobertura o con pocos invitados: se suman profesionales que se registraron después.
  const rematched = await rematchOpenRequests().catch((e) => {
    console.error("[cron] rematch:", e instanceof Error ? e.message : "error");
    return 0;
  });
  const outbox = await processOutbox(100);
  const whatsapp = await processWhatsAppOutbox(100);
  const push = await processPushOutbox(100).catch((e) => {
    console.error("[cron] push:", e instanceof Error ? e.message : "error");
    return { sent: 0, failed: 0 };
  });
  const expired = await sql().begin((tx) => expireQuotes(tx as never));
  return Response.json({ outbox, whatsapp, push, expiredQuotes: expired, reviews, reviewDisputes, expiredBookings, rematched });
}

// Vercel Cron llama con GET y envía "Authorization: Bearer $CRON_SECRET".
export const GET = run;
export const POST = run;
