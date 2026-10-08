-- Reglas de integridad en la base: transiciones de estado válidas, inmutabilidad
-- de registros contractuales y financieros, y balance del registro financiero.

-- ───────── Transiciones permitidas (fuente de verdad también en src/server/domain/state-machines.ts) ─────────
CREATE TABLE app.allowed_transitions (
  entity     text NOT NULL,
  from_state text NOT NULL,
  to_state   text NOT NULL,
  PRIMARY KEY (entity, from_state, to_state)
);

INSERT INTO app.allowed_transitions (entity, from_state, to_state) VALUES
  -- Solicitud
  ('request','draft','submitted'), ('request','draft','cancelled'),
  ('request','submitted','searching'), ('request','submitted','no_coverage'), ('request','submitted','cancelled'),
  ('request','searching','with_quotes'), ('request','searching','no_coverage'), ('request','searching','cancelled'),
  ('request','no_coverage','searching'), ('request','no_coverage','cancelled'),
  ('request','with_quotes','converted'), ('request','with_quotes','searching'), ('request','with_quotes','cancelled'),
  -- Presupuesto
  ('quote','draft','sent'), ('quote','draft','withdrawn'),
  ('quote','sent','accepted'), ('quote','sent','rejected'), ('quote','sent','expired'), ('quote','sent','withdrawn'),
  -- Trabajo
  ('job','pending_confirmation','confirmed'), ('job','pending_confirmation','cancelled'),
  ('job','confirmed','on_the_way'), ('job','confirmed','in_progress'), ('job','confirmed','cancelled'),
  ('job','on_the_way','in_progress'), ('job','on_the_way','cancelled'),
  ('job','in_progress','pending_approval'), ('job','in_progress','cancelled'),
  ('job','pending_approval','completed'), ('job','pending_approval','in_progress'), ('job','pending_approval','cancelled'),
  -- Cobro
  ('charge','pending','processing'), ('charge','pending','approved'), ('charge','pending','failed'),
  ('charge','processing','approved'), ('charge','processing','failed'),
  ('charge','approved','partially_refunded'), ('charge','approved','refunded'),
  ('charge','partially_refunded','refunded'),
  -- Liquidación
  ('payout','pending','scheduled'), ('payout','pending','failed'),
  ('payout','scheduled','processing'), ('payout','scheduled','pending'), ('payout','scheduled','failed'),
  ('payout','processing','paid'), ('payout','processing','failed'),
  ('payout','failed','scheduled'),
  ('payout','paid','reversed'),
  -- Reclamo
  ('dispute','open','in_review'), ('dispute','open','awaiting_response'), ('dispute','open','resolved'), ('dispute','open','closed'),
  ('dispute','in_review','awaiting_response'), ('dispute','in_review','resolved'), ('dispute','in_review','closed'),
  ('dispute','awaiting_response','in_review'), ('dispute','awaiting_response','resolved'), ('dispute','awaiting_response','closed'),
  ('dispute','resolved','closed'), ('dispute','resolved','in_review'),
  -- Proveedor (estado operativo)
  ('provider','pending','in_review'),
  ('provider','in_review','approved'), ('provider','in_review','rejected'), ('provider','in_review','pending'),
  ('provider','approved','suspended'), ('provider','suspended','approved'),
  ('provider','rejected','pending');

CREATE FUNCTION app.check_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM app.allowed_transitions
      WHERE entity = TG_ARGV[0] AND from_state = OLD.status AND to_state = NEW.status
    ) THEN
      RAISE EXCEPTION 'invalid_transition: % % -> %', TG_ARGV[0], OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER service_requests_transition BEFORE UPDATE OF status ON service_requests
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('request');
CREATE TRIGGER quotes_transition BEFORE UPDATE OF status ON quotes
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('quote');
CREATE TRIGGER jobs_transition BEFORE UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('job');
CREATE TRIGGER charges_transition BEFORE UPDATE OF status ON charges
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('charge');
CREATE TRIGGER payouts_transition BEFORE UPDATE OF status ON payouts
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('payout');
CREATE TRIGGER disputes_transition BEFORE UPDATE OF status ON disputes
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('dispute');
CREATE TRIGGER providers_transition BEFORE UPDATE OF status ON providers
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('provider');

-- ───────── Inmutabilidad ─────────
CREATE FUNCTION app.forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable_record: % no admite %', TG_TABLE_NAME, TG_OP USING ERRCODE = 'check_violation';
END $$;

-- Registros append-only: correcciones mediante asientos de ajuste o reverso.
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER entity_events_immutable BEFORE UPDATE OR DELETE ON entity_events
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER messages_immutable BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER charges_no_delete BEFORE DELETE ON charges
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER payouts_no_delete BEFORE DELETE ON payouts
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER jobs_no_delete BEFORE DELETE ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();

-- El alcance y el precio contratados no se modifican nunca.
CREATE FUNCTION app.protect_job_contract() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_snapshot IS DISTINCT FROM OLD.contract_snapshot
     OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
     OR NEW.provider_net_minor IS DISTINCT FROM OLD.provider_net_minor
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id
     OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'immutable_contract: el contrato del trabajo % no puede modificarse', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_protect_contract BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.protect_job_contract();

-- Un presupuesto enviado no cambia de importes ni alcance.
CREATE FUNCTION app.protect_sent_quote() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
    OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
    OR NEW.provider_net_minor IS DISTINCT FROM OLD.provider_net_minor
    OR NEW.client_fee_minor IS DISTINCT FROM OLD.client_fee_minor
    OR NEW.provider_fee_minor IS DISTINCT FROM OLD.provider_fee_minor
    OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.exclusions IS DISTINCT FROM OLD.exclusions
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.mode IS DISTINCT FROM OLD.mode) THEN
    RAISE EXCEPTION 'immutable_quote: un presupuesto enviado no puede modificarse' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quotes_protect_sent BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION app.protect_sent_quote();

-- Adicionales: importes inmutables una vez propuestos.
CREATE FUNCTION app.protect_extra() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.total_minor IS DISTINCT FROM OLD.total_minor
     OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
     OR NEW.provider_net_minor IS DISTINCT FROM OLD.provider_net_minor
     OR NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION 'immutable_extra' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'proposed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'invalid_transition: extra % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_extras_protect BEFORE UPDATE ON job_extras
  FOR EACH ROW EXECUTE FUNCTION app.protect_extra();

-- Cobros: importe, moneda y referencias inmutables; reembolsos nunca superan lo cobrado.
CREATE FUNCTION app.protect_charge() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
     OR NEW.is_test IS DISTINCT FROM OLD.is_test THEN
    RAISE EXCEPTION 'immutable_charge' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.refunded_minor < OLD.refunded_minor THEN
    RAISE EXCEPTION 'refunded_amount_cannot_decrease' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER charges_protect BEFORE UPDATE ON charges
  FOR EACH ROW EXECUTE FUNCTION app.protect_charge();

-- ───────── Balance del registro financiero: cada transacción suma cero ─────────
CREATE FUNCTION app.check_ledger_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  SELECT coalesce(sum(amount_minor), 0) INTO s FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF s <> 0 THEN
    RAISE EXCEPTION 'unbalanced_ledger_txn: % suma %', NEW.txn_id, s USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_ledger_balance();

-- ───────── Proveedores suspendidos o no aprobados no reciben trabajos nuevos ─────────
CREATE FUNCTION app.check_job_provider_active() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM providers WHERE id = NEW.provider_id;
  IF st IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'provider_not_eligible: estado %', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_provider_active BEFORE INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.check_job_provider_active();
CREATE TRIGGER invitations_provider_active BEFORE INSERT ON request_invitations
  FOR EACH ROW EXECUTE FUNCTION app.check_job_provider_active();

-- Reseñas: solo para trabajos completados y por el cliente del trabajo.
CREATE FUNCTION app.check_review() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE j record;
BEGIN
  SELECT status, client_user_id, provider_id INTO j FROM jobs WHERE id = NEW.job_id;
  IF j.status <> 'completed' THEN
    RAISE EXCEPTION 'review_requires_completed_job' USING ERRCODE = 'check_violation';
  END IF;
  IF j.client_user_id <> NEW.client_user_id OR j.provider_id <> NEW.provider_id THEN
    RAISE EXCEPTION 'review_party_mismatch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviews_check BEFORE INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION app.check_review();

-- updated_at genérico
CREATE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER service_requests_touch BEFORE UPDATE ON service_requests FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER jobs_touch BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER payouts_touch BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER providers_touch BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER disputes_touch BEFORE UPDATE ON disputes FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
