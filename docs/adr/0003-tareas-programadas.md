# ADR 0003 · Tareas programadas separadas

**Estado:** aceptada.

**Decisión.** Una ruta por tarea (`/api/cron/<tarea>`, inventario en `src/server/ops/tasks.ts`), cada una con su
frecuencia, lock con vencimiento (`cron_locks`), registro de corridas (`cron_runs`) y pasos aislados: si falla Meta, los
emails y los pagos siguen. La vigilancia (`watchdog`) revisa colas, corridas y pagos y abre alertas para el equipo.

**Consecuencias.** Más entradas en `vercel.json` (plan Pro). La ruta vieja `/api/cron/outbox` corre todas en orden
solo para emergencias.
