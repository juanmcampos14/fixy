-- Operación (auditoría M-07 / M-10, Etapa 3).

-- ── Avisos: lease en vez de lock durante la red ──
-- El procesador reclama filas (status 'processing' + lease_until) en una sentencia, confirma, envía sin transacción
-- abierta y después marca el resultado. Si se cae, el lease vence y otro procesador las retoma.
ALTER TABLE outbox DROP CONSTRAINT outbox_status_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_status_check CHECK (status IN ('pending','processing','sent','failed','dead'));
ALTER TABLE outbox ADD COLUMN lease_until timestamptz;
DROP INDEX outbox_pending_idx;
CREATE INDEX outbox_due_idx ON outbox (channel, next_attempt_at) WHERE status IN ('pending','failed','processing');
CREATE INDEX outbox_dead_idx ON outbox (channel, created_at DESC) WHERE status = 'dead';

-- ── Tareas programadas: una ejecución por vez y registro de cada corrida ──
CREATE TABLE cron_locks (
  task         text PRIMARY KEY CHECK (task ~ '^[a-z][a-z0-9-]{1,40}$'),
  locked_until timestamptz,
  holder       text
);
ALTER TABLE cron_locks ENABLE ROW LEVEL SECURITY;

CREATE TABLE cron_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task        text NOT NULL,
  trigger     text NOT NULL CHECK (trigger IN ('cron','manual')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean,
  duration_ms integer,
  result      jsonb,
  error       text
);
CREATE INDEX cron_runs_task_idx ON cron_runs (task, started_at DESC);
ALTER TABLE cron_runs ENABLE ROW LEVEL SECURITY;

-- ── Alertas operativas: una abierta por tipo, con aviso al equipo como máximo una vez por hora ──
CREATE TABLE ops_alerts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('warning','critical')),
  detail           jsonb NOT NULL DEFAULT '{}',
  opened_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz,
  resolved_at      timestamptz
);
CREATE UNIQUE INDEX ops_alerts_open_key ON ops_alerts (kind) WHERE resolved_at IS NULL;
ALTER TABLE ops_alerts ENABLE ROW LEVEL SECURITY;
