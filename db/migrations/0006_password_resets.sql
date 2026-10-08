-- Recuperación de contraseña: token de un solo uso (solo se guarda su hash), vence en 1 hora.
CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id);
ALTER TABLE password_resets ENABLE ROW LEVEL SECURITY;
