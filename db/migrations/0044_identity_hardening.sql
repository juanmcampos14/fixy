-- Identidad (auditoría A-04, M-02 y skill fixy-harden-auth, Etapa 2).

-- ── Sesiones observables y revocables ──
-- Cada sesión tiene un id visible (para listarla y cerrarla sin exponer el token), última actividad para vencer por
-- inactividad, un resumen del dispositivo y cuándo se verificó el segundo factor.
ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sessions ADD CONSTRAINT sessions_id_key UNIQUE (id);
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 200);
ALTER TABLE sessions ADD COLUMN ip_hint text CHECK (ip_hint IS NULL OR length(ip_hint) <= 64);
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;

-- ── Segundo factor (TOTP) para el equipo ──
-- El secreto se guarda cifrado (AES-256-GCM con MFA_ENCRYPTION_KEY, fuera de la base); los códigos de respaldo, solo
-- como hash. last_step evita reusar el mismo código dentro de su ventana.
CREATE TABLE user_mfa (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc  text NOT NULL,
  enabled_at  timestamptz,
  last_step   bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;

CREATE TABLE user_mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_mfa_recovery_codes_user_idx ON user_mfa_recovery_codes (user_id);
ALTER TABLE user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

-- ── Lectura del equipo por sección (mínimo privilegio en la base) ──
-- Antes todo el equipo leía todo (app.is_staff). Ahora finanzas, documentos de identidad y auditoría solo los lee
-- quien tiene esa sección (admin y operator, que ven todas las secciones, siguen igual).
CREATE FUNCTION app.staff_can(u uuid, sections text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users us WHERE us.id = u AND us.disabled_at IS NULL AND (
      us.platform_role IN ('admin','operator')
      OR (us.platform_role = 'team' AND EXISTS (SELECT 1 FROM admin_permissions ap WHERE ap.user_id = u AND ap.section = ANY (sections)))
    ))
$$;

CREATE OR REPLACE FUNCTION app.can_see_provider_finance(u uuid, p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.staff_can(u, ARRAY['finanzas']) OR app.provider_role(u, p) = 'admin'
$$;

DROP POLICY charges_access ON charges;
CREATE POLICY charges_access ON charges FOR SELECT TO fixy_app
  USING (app.staff_can(app.uid(), ARRAY['finanzas','trabajos','reclamos']) OR app.is_job_client(app.uid(), job_id)
         OR EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_id AND app.can_see_provider_finance(app.uid(), j.provider_id)));

DROP POLICY payouts_access ON payouts;
CREATE POLICY payouts_access ON payouts FOR SELECT TO fixy_app
  USING (app.can_see_provider_finance(app.uid(), provider_id) OR app.staff_can(app.uid(), ARRAY['trabajos','reclamos']));

DROP POLICY ledger_access ON ledger_entries;
CREATE POLICY ledger_access ON ledger_entries FOR SELECT TO fixy_app USING (app.staff_can(app.uid(), ARRAY['finanzas']));

DROP POLICY payment_events_staff ON payment_events;
CREATE POLICY payment_events_staff ON payment_events FOR SELECT TO fixy_app USING (app.staff_can(app.uid(), ARRAY['finanzas']));

DROP POLICY provider_documents_private ON provider_documents;
CREATE POLICY provider_documents_private ON provider_documents FOR SELECT TO fixy_app
  USING (app.provider_role(app.uid(), provider_id) = 'admin' OR app.staff_can(app.uid(), ARRAY['proveedores']));

DROP POLICY audit_log_staff ON audit_log;
CREATE POLICY audit_log_staff ON audit_log FOR SELECT TO fixy_app USING (app.staff_can(app.uid(), ARRAY['auditoria']));

-- Archivos de profesionales privados (DNI, matrículas): solo el equipo con la sección Profesionales.
DROP POLICY files_access ON files;
CREATE POLICY files_access ON files FOR SELECT TO fixy_app
  USING (
    visibility = 'public'
    OR uploaded_by = app.uid()
    OR (app.is_staff(app.uid()) AND (owner_type <> 'provider' OR app.staff_can(app.uid(), ARRAY['proveedores'])))
    OR (owner_type = 'provider' AND app.provider_role(app.uid(), owner_id) = 'admin')
    OR (owner_type = 'request' AND app.can_see_request(app.uid(), owner_id))
    OR (owner_type = 'job' AND app.can_see_job(app.uid(), owner_id))
    OR (owner_type = 'conversation' AND app.can_see_conversation(app.uid(), owner_id))
    OR (owner_type = 'dispute' AND EXISTS (SELECT 1 FROM disputes d WHERE d.id = owner_id AND app.can_see_job(app.uid(), d.job_id)))
    OR (owner_type = 'property' AND app.can_see_property(app.uid(), owner_id))
  );
