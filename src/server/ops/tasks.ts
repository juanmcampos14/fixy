/**
 * Inventario de tareas programadas. Cada una tiene su ruta (/api/cron/<tarea>), su frecuencia en vercel.json y su
 * dependencia externa, para saber qué mirar cuando falla. Lotes acotados por entorno.
 */
import { sql } from "@/server/db/client";
import { processOutbox } from "@/server/notifications";
import { processWhatsAppOutbox } from "@/server/whatsapp/outbox";
import { processPushOutbox } from "@/server/push";
import { syncWhatsAppTemplates } from "@/server/whatsapp/templates-sync";
import { expireQuotes } from "@/server/modules/quotes";
import { processReviewTasks } from "@/server/modules/disputes";
import { processReviewDisputeDeadlines } from "@/server/modules/review-disputes";
import { expireDirectBookings, rematchOpenRequests } from "@/server/modules/requests";
import { runPaymentCommands } from "@/server/modules/payment-commands";
import { runReconciliation } from "@/server/modules/payment-reconciliation";
import { refreshLeadStages, syncSupplySheet } from "@/server/modules/supply";
import { runWatchdog } from "./alerts";

const batch = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 && n <= 500 ? n : fallback;
};

/** Corre un paso y, si falla, lo informa sin cortar los demás pasos de la misma tarea. */
async function step<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    return { error: (e instanceof Error ? e.message : "error").slice(0, 200) };
  }
}

/**
 * Procesa una cola por tandas hasta vaciarla o agotar el presupuesto de tiempo (así un pico de avisos no espera
 * varias corridas de 5 minutos). Suma los resultados de cada tanda.
 */
async function drain(budgetMs: number, fn: () => Promise<{ sent: number; failed: number }>) {
  const until = Date.now() + budgetMs;
  const total = { sent: 0, failed: 0, batches: 0 };
  while (Date.now() < until) {
    const r = await fn();
    total.sent += r.sent;
    total.failed += r.failed;
    total.batches++;
    if (r.sent + r.failed === 0) break;
  }
  return total;
}

export type TaskDef = { label: string; everyMinutes: number; maxSeconds: number; external: string; run: () => Promise<unknown> };

export const TASKS = {
  notifications: {
    label: "Avisos (email, WhatsApp, celular)", everyMinutes: 5, maxSeconds: 240, external: "Resend, Meta, FCM/APNs",
    run: async () => ({
      // Hasta ~70 s por canal: con la cola vacía termina en milisegundos.
      email: await step(() => drain(70_000, () => processOutbox(batch("BATCH_EMAIL", 100)))),
      whatsapp: await step(() => drain(70_000, () => processWhatsAppOutbox(batch("BATCH_WHATSAPP", 100)))),
      push: await step(() => drain(70_000, () => processPushOutbox(batch("BATCH_PUSH", 100)))),
    }),
  },
  payments: {
    label: "Pagos (operaciones y conciliación)", everyMinutes: 10, maxSeconds: 240, external: "Mercado Pago",
    run: async () => ({
      commands: await step(() => runPaymentCommands({ limit: batch("BATCH_PAYMENT_COMMANDS", 50) })),
      reconciliation: await step(() => runReconciliation({ limit: batch("BATCH_RECONCILIATION", 40) })),
    }),
  },
  requests: {
    label: "Pedidos (vencimientos y nuevos profesionales)", everyMinutes: 10, maxSeconds: 240, external: "—",
    run: async () => ({
      expiredQuotes: await step(() => sql().begin((tx) => expireQuotes(tx as never))),
      expiredBookings: await step(() => expireDirectBookings()),
      rematched: await step(() => rematchOpenRequests()),
      // Etapas de captación (registrado → verificado → activo) al ritmo de las aprobaciones.
      leadStages: await step(() => refreshLeadStages()),
    }),
  },
  reviews: {
    label: "Reseñas (recordatorios y plazos)", everyMinutes: 30, maxSeconds: 240, external: "—",
    run: async () => ({ reviews: await step(() => processReviewTasks()), disputes: await step(() => processReviewDisputeDeadlines()) }),
  },
  "whatsapp-templates": {
    label: "Plantillas de WhatsApp", everyMinutes: 60, maxSeconds: 120, external: "Meta",
    run: async () => ({ templates: await step(() => syncWhatsAppTemplates()) }),
  },
  "supply-sync": {
    label: "Captación (planilla de research)", everyMinutes: 1440, maxSeconds: 120, external: "Google Sheets",
    run: async () => ({ sheet: await step(() => syncSupplySheet("cron")) }),
  },
  watchdog: {
    label: "Vigilancia (alertas al equipo)", everyMinutes: 10, maxSeconds: 60, external: "—",
    run: () => runWatchdog(),
  },
} satisfies Record<string, TaskDef>;

export type TaskName = keyof typeof TASKS;
export const isTask = (t: string): t is TaskName => Object.hasOwn(TASKS, t);
