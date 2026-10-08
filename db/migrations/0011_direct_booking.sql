-- Modelo "elegí a tu profesional": el cliente elige un profesional, reserva la visita (con o sin cargo,
-- según defina cada profesional), el profesional ve el problema y cotiza el arreglo en el lugar dentro de Fixy.

-- Visita definida por cada profesional (0 = sin cargo) y si se descuenta del trabajo si el cliente lo contrata.
ALTER TABLE providers ADD COLUMN visit_fee_minor bigint NOT NULL DEFAULT 0 CHECK (visit_fee_minor >= 0 AND visit_fee_minor <= 100000000);
ALTER TABLE providers ADD COLUMN visit_fee_credited boolean NOT NULL DEFAULT true;

-- Precios de referencia "desde" por servicio (información pública del perfil).
CREATE TABLE provider_price_refs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id),
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  from_minor  bigint NOT NULL CHECK (from_minor > 0),
  note        text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_price_refs_idx ON provider_price_refs (provider_id, category_id);
GRANT SELECT ON provider_price_refs TO fixy_app;

-- Modo de la solicitud: reserva directa a un profesional elegido, o presupuestos de varios (opción secundaria).
ALTER TABLE service_requests ADD COLUMN request_mode text NOT NULL DEFAULT 'quotes' CHECK (request_mode IN ('direct','quotes'));
-- Plazo para que el profesional responda una reserva directa.
ALTER TABLE request_invitations ADD COLUMN respond_by timestamptz;
CREATE INDEX request_invitations_respond_by_idx ON request_invitations (respond_by) WHERE status IN ('invited','viewed');

-- Visitas sin cargo: el presupuesto de visita y el trabajo pueden valer $0 (no se crea cobro).
ALTER TABLE quotes DROP CONSTRAINT quotes_subtotal_minor_check, DROP CONSTRAINT quotes_total_minor_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_subtotal_minor_check CHECK (subtotal_minor >= 0),
                   ADD CONSTRAINT quotes_total_minor_check CHECK (total_minor >= 0),
                   ADD CONSTRAINT quotes_zero_only_visit CHECK (total_minor > 0 OR mode = 'diagnostic');
ALTER TABLE jobs DROP CONSTRAINT jobs_total_minor_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_total_minor_check CHECK (total_minor >= 0);

-- Código de visita: el cliente se lo da al profesional al llegar; registra que la visita ocurrió.
ALTER TABLE jobs ADD COLUMN visit_code text CHECK (visit_code IS NULL OR visit_code ~ '^[0-9]{4}$');
ALTER TABLE jobs ADD COLUMN checked_in_at timestamptz;

-- Presupuesto del arreglo en el lugar (adicional) con descuento de la visita ya pagada, si corresponde.
ALTER TABLE job_extras ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0);
ALTER TABLE job_extras ADD COLUMN is_main_quote boolean NOT NULL DEFAULT false;
ALTER TABLE job_extras DROP CONSTRAINT job_extras_check, DROP CONSTRAINT job_extras_subtotal_minor_check, DROP CONSTRAINT job_extras_total_minor_check;
ALTER TABLE job_extras ADD CONSTRAINT job_extras_subtotal_minor_check CHECK (subtotal_minor >= 0), ADD CONSTRAINT job_extras_total_minor_check CHECK (total_minor >= 0);
ALTER TABLE job_extras ADD CONSTRAINT job_extras_check CHECK (subtotal_minor = labor_minor + materials_minor - discount_minor);

-- Revelado de dirección y acceso: profesional elegido con la visita confirmada (pagada, o sin cargo).
CREATE OR REPLACE FUNCTION app.is_revealed_provider(u uuid, req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.request_id = req AND j.status <> 'cancelled'
      AND (app.provider_role(u, j.provider_id) = 'admin' OR (j.assigned_user_id = u AND app.provider_role(u, j.provider_id) IS NOT NULL))
      AND (
        EXISTS (SELECT 1 FROM charges c WHERE c.job_id = j.id AND c.kind IN ('visit','job_total','deposit') AND c.status IN ('approved','partially_refunded','refunded'))
        OR (j.total_minor = 0 AND j.status <> 'pending_confirmation')
      )
  )
$$;

INSERT INTO platform_settings (key, value) VALUES
  ('booking.respond_hours', '4'::jsonb),
  ('booking.respond_hours_urgent', '2'::jsonb)
ON CONFLICT (key) DO NOTHING;
