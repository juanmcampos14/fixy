/* Procesa el outbox de notificaciones externas (email). Ejecutar periódicamente (cron) o usar /api/cron/outbox. */
import { loadEnv } from "./load-env";
loadEnv();
(async () => {
  const { processOutbox } = await import("@/server/notifications");
  const { sql } = await import("@/server/db/client");
  const r = await processOutbox(100);
  console.log(`Outbox: ${r.sent} enviados, ${r.failed} con error.`);
  await sql().end();
})();
