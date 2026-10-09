-- Documentos legales vigentes (v1.0, ya no borradores) y pedidos de arrepentimiento (Res. 424/2020).
INSERT INTO policy_documents (kind, version, title, is_draft, published_at) VALUES
  ('terms', '1.0', 'Términos y condiciones', false, now()),
  ('privacy', '1.0', 'Política de privacidad', false, now()),
  ('provider_terms', '1.0', 'Condiciones para profesionales', false, now())
ON CONFLICT (kind, version) DO NOTHING;

CREATE SEQUENCE revocation_code_seq START 1001;
CREATE TABLE revocation_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE DEFAULT ('ARR-' || nextval('revocation_code_seq')),
  user_id     uuid REFERENCES users(id),
  full_name   text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 160),
  email       text NOT NULL CHECK (length(email) BETWEEN 5 AND 200),
  reference   text CHECK (reference IS NULL OR length(reference) <= 120),
  details     text CHECK (details IS NULL OR length(details) <= 2000),
  status      text NOT NULL DEFAULT 'received' CHECK (status IN ('received','resolved')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  resolution  text
);
ALTER TABLE revocation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY revocation_requests_access ON revocation_requests FOR SELECT TO fixy_app
  USING (user_id = app.uid() OR app.is_staff(app.uid()));
GRANT SELECT ON revocation_requests TO fixy_app;
