-- Impugnación de reseñas: el proveedor cuestiona una reseña publicada (sin saber quién la escribió);
-- una IA consulta al cliente y evalúa; si no se resuelve, pasa a revisión humana.

CREATE TABLE review_disputes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id           uuid NOT NULL REFERENCES reviews(id),
  provider_id         uuid NOT NULL REFERENCES providers(id),
  opened_by           uuid NOT NULL REFERENCES users(id),
  reason_code         text NOT NULL CHECK (reason_code IN ('false_facts','not_my_job','offensive','personal_data','extortion','other')),
  provider_statement  text NOT NULL CHECK (length(provider_statement) BETWEEN 20 AND 3000),
  status              text NOT NULL DEFAULT 'awaiting_client'
                      CHECK (status IN ('awaiting_client','ai_review','escalated','resolved','closed')),
  resolution          text CHECK (resolution IN ('kept','edited','withdrawn','hidden','other')),
  resolved_by_ai      boolean NOT NULL DEFAULT false,
  resolved_by         uuid REFERENCES users(id),
  ai_rounds           integer NOT NULL DEFAULT 0,
  ai_last_decision    jsonb,
  internal_summary    text,          -- análisis para operación (puede identificar a las partes)
  provider_summary    text,          -- resumen para el proveedor (nunca identifica al cliente)
  escalation_reason   text,
  client_deadline     timestamptz NOT NULL DEFAULT now() + interval '5 days',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);
-- Una impugnación por reseña (la decisión final no se puede re-impugnar desde el panel).
CREATE UNIQUE INDEX review_disputes_one_per_review ON review_disputes (review_id);
CREATE INDEX review_disputes_status_idx ON review_disputes (status, created_at);
CREATE TRIGGER review_disputes_touch BEFORE UPDATE ON review_disputes FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

INSERT INTO app.allowed_transitions (entity, from_state, to_state) VALUES
  ('review_dispute','awaiting_client','ai_review'), ('review_dispute','awaiting_client','escalated'), ('review_dispute','awaiting_client','resolved'),
  ('review_dispute','ai_review','awaiting_client'), ('review_dispute','ai_review','resolved'), ('review_dispute','ai_review','escalated'),
  ('review_dispute','escalated','resolved'), ('review_dispute','escalated','awaiting_client'),
  ('review_dispute','resolved','closed');
CREATE TRIGGER review_disputes_transition BEFORE UPDATE OF status ON review_disputes
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('review_dispute');

-- Conversación de la consulta: cliente ↔ asistente (IA) ↔ operación. El proveedor no la ve.
CREATE TABLE review_dispute_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  uuid NOT NULL REFERENCES review_disputes(id),
  author      text NOT NULL CHECK (author IN ('client','ai','admin','system')),
  author_id   uuid REFERENCES users(id),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_dispute_messages_idx ON review_dispute_messages (dispute_id, created_at);
CREATE TRIGGER review_dispute_messages_immutable BEFORE UPDATE OR DELETE ON review_dispute_messages
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();

-- Historial de versiones de reseñas (ediciones del cliente), y retiro voluntario.
CREATE TABLE review_revisions (
  id         bigserial PRIMARY KEY,
  review_id  uuid NOT NULL REFERENCES reviews(id),
  rating     integer NOT NULL,
  comment    text NOT NULL,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reviews ADD COLUMN edited_at timestamptz;
ALTER TABLE reviews ADD COLUMN withdrawn_at timestamptz;

-- RLS
ALTER TABLE review_disputes ENABLE ROW LEVEL SECURITY;
-- La fila completa (con el análisis interno) solo la ve operación. Proveedor y cliente usan vistas acotadas.
CREATE POLICY review_disputes_staff ON review_disputes FOR SELECT TO fixy_app USING (app.is_staff(app.uid()));
ALTER TABLE review_dispute_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_dispute_messages_access ON review_dispute_messages FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid())
         OR EXISTS (SELECT 1 FROM review_disputes d JOIN reviews r ON r.id = d.review_id WHERE d.id = dispute_id AND r.client_user_id = app.uid()));
ALTER TABLE review_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_revisions_access ON review_revisions FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid()) OR EXISTS (SELECT 1 FROM reviews r WHERE r.id = review_id AND r.client_user_id = app.uid()));
GRANT SELECT ON review_disputes, review_dispute_messages, review_revisions TO fixy_app;

-- Vista del proveedor: estado y resumen no identificatorio de SUS impugnaciones.
CREATE VIEW review_disputes_provider AS
  SELECT d.id, d.review_id, d.provider_id, d.reason_code, d.status, d.resolution, d.provider_summary, d.created_at, d.resolved_at
  FROM review_disputes d
  WHERE app.provider_role(app.uid(), d.provider_id) = 'admin' OR app.is_staff(app.uid());
-- Vista del cliente autor de la reseña: estado de la consulta (sin el descargo literal ni el análisis interno).
CREATE VIEW review_disputes_client AS
  SELECT d.id, d.review_id, d.reason_code, d.status, d.resolution, d.client_deadline, d.created_at, d.resolved_at
  FROM review_disputes d JOIN reviews r ON r.id = d.review_id
  WHERE r.client_user_id = app.uid();
GRANT SELECT ON review_disputes_provider, review_disputes_client TO fixy_app;

INSERT INTO platform_settings (key, value) VALUES
  ('reviews.dispute_window_days', '30'::jsonb),
  ('reviews.dispute_client_days', '5'::jsonb),
  ('reviews.dispute_max_ai_rounds', '2'::jsonb)
ON CONFLICT (key) DO NOTHING;
