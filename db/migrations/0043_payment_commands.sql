-- Pagos fiables (auditoría H-02 / H-03). Ninguna llamada a la pasarela ocurre con una transacción abierta:
--   1) la acción de negocio guarda la intención (comando) y confirma;
--   2) un procesador la reclama con un lease corto, llama a la pasarela con una clave idempotente estable;
--   3) en una transacción breve aplica el resultado (estado, registro financiero, avisos) y cierra el comando.
-- Si el proceso se cae entre 2 y 3, el lease vence y otro procesador reintenta con la MISMA clave: la pasarela
-- devuelve la misma operación en vez de repetirla.
CREATE TABLE payment_commands (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('create_checkout','refund','orphan_refund','transfer')),
  gateway          text NOT NULL CHECK (gateway IN ('mock','mercadopago')),
  idempotency_key  text NOT NULL UNIQUE,
  charge_id        uuid REFERENCES charges(id),
  refund_id        uuid REFERENCES refunds(id),
  payout_id        uuid REFERENCES payouts(id),
  payload          jsonb NOT NULL DEFAULT '{}',
  payload_version  int NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','succeeded','retryable','dead','cancelled')),
  attempts         int NOT NULL DEFAULT 0,
  lease_until      timestamptz,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  result           jsonb,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_commands_due_idx ON payment_commands (next_attempt_at) WHERE status IN ('pending','retryable','leased');
CREATE INDEX payment_commands_charge_idx ON payment_commands (charge_id);
CREATE INDEX payment_commands_refund_idx ON payment_commands (refund_id);
CREATE INDEX payment_commands_payout_idx ON payment_commands (payout_id);
ALTER TABLE payment_commands ENABLE ROW LEVEL SECURITY;

-- Conciliación: diferencias entre Fixy y la pasarela que necesitan a una persona (las reparables se reparan solas
-- por la misma vía idempotente del webhook y quedan registradas como resueltas).
CREATE TABLE payment_incidents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('info','warning','critical')),
  charge_id    uuid REFERENCES charges(id),
  command_id   uuid REFERENCES payment_commands(id),
  detail       jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  detected_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users(id),
  resolution   text
);
CREATE UNIQUE INDEX payment_incidents_open_key ON payment_incidents (kind, coalesce(charge_id, command_id)) WHERE status = 'open';
ALTER TABLE payment_incidents ENABLE ROW LEVEL SECURITY;

-- Última vez que la conciliación revisó el cobro contra la pasarela (para recorrerlos por turnos).
ALTER TABLE charges ADD COLUMN reconciled_at timestamptz;

-- Pasarela simulada: devoluciones idempotentes por clave, como en la real.
CREATE TABLE mock_gateway_refunds (
  idempotency_key text PRIMARY KEY,
  id              text NOT NULL UNIQUE,
  payment_id      text NOT NULL REFERENCES mock_gateway_payments(id),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mock_gateway_refunds ENABLE ROW LEVEL SECURITY;
