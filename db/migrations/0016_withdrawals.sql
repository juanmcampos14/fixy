-- Profesionales: 0% de comisión, balance acumulado y retiros mensuales.
--  * Fixy no cobra comisión a los profesionales: solo el cargo de servicio al cliente. Queda garantizado por la base.
--  * Lo ganado en cada trabajo (liquidación) se acumula como saldo cuando el trabajo está completado, con reseña y sin reclamos.
--  * Una vez por mes calendario (hora de Buenos Aires) el profesional pide retirar todo su saldo; se transfiere a los 20 días
--    a la cuenta bancaria que cargó. La transferencia la registra la operación con su referencia.

-- 1) Cero comisión a profesionales (las cotizaciones ya emitidas guardan su propia tasa).
UPDATE commission_rules SET provider_rate_bps = 0;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_provider_zero CHECK (provider_rate_bps = 0);

-- 2) Datos bancarios (privados: solo administradores del perfil y la operación).
CREATE TABLE provider_bank_accounts (
  provider_id   uuid PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  holder_name   text NOT NULL CHECK (length(holder_name) BETWEEN 2 AND 160),
  holder_tax_id text NOT NULL CHECK (holder_tax_id ~ '^\d{11}$'),
  cbu           text CHECK (cbu IS NULL OR cbu ~ '^\d{22}$'),
  alias         text CHECK (alias IS NULL OR alias ~ '^[A-Za-z0-9.-]{6,20}$'),
  bank_name     text CHECK (bank_name IS NULL OR length(bank_name) <= 80),
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (cbu IS NOT NULL OR alias IS NOT NULL)
);
ALTER TABLE provider_bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_bank_accounts_access ON provider_bank_accounts FOR SELECT TO fixy_app
  USING (app.can_see_provider_finance(app.uid(), provider_id));
GRANT SELECT ON provider_bank_accounts TO fixy_app;

-- 3) Retiros.
CREATE TABLE withdrawals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES providers(id),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  status         text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','paid','rejected')),
  period         text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),     -- mes calendario del pedido (AR)
  scheduled_for  date NOT NULL,                                        -- pedido + 20 días
  bank_snapshot  jsonb NOT NULL,                                       -- cuenta destino al momento del pedido
  is_test        boolean NOT NULL,
  requested_by   uuid NOT NULL REFERENCES users(id),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  processed_by   uuid REFERENCES users(id),
  paid_at        timestamptz,
  external_ref   text,
  reject_reason  text,
  CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND external_ref IS NOT NULL)),
  CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);
-- Un retiro por mes (uno rechazado no cuenta).
CREATE UNIQUE INDEX withdrawals_one_per_month ON withdrawals (provider_id, period) WHERE status <> 'rejected';
CREATE INDEX withdrawals_status_idx ON withdrawals (status, scheduled_for);

INSERT INTO app.allowed_transitions (entity, from_state, to_state) VALUES
  ('withdrawal','requested','paid'), ('withdrawal','requested','rejected');
CREATE TRIGGER withdrawals_transition BEFORE UPDATE OF status ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('withdrawal');

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY withdrawals_access ON withdrawals FOR SELECT TO fixy_app
  USING (app.can_see_provider_finance(app.uid(), provider_id));
GRANT SELECT ON withdrawals TO fixy_app;

ALTER TABLE payouts ADD COLUMN withdrawal_id uuid REFERENCES withdrawals(id);
CREATE INDEX payouts_withdrawal_idx ON payouts (withdrawal_id);

INSERT INTO platform_settings (key, value) VALUES ('withdrawals.delay_days', '20'::jsonb) ON CONFLICT (key) DO NOTHING;

ALTER TABLE entity_events DROP CONSTRAINT entity_events_entity_type_check;
ALTER TABLE entity_events ADD CONSTRAINT entity_events_entity_type_check
  CHECK (entity_type IN ('request','quote','job','charge','payout','dispute','provider','refund','withdrawal'));
