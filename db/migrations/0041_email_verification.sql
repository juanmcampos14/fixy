-- Confirmación de email (auditoría H-01). `email_verified` pasa a significar "se probó que la casilla es de esta persona":
-- - Google lo prueba al ingresar; el registro clásico deja la cuenta sin confirmar hasta que abre el enlace que le mandamos.
-- - A un email sin confirmar no se le escribe nada más que el enlace de confirmación, y no puede pagar, cobrar ni
--   sumarse al equipo hasta confirmarlo (quien tiene el WhatsApp vinculado ya probó su identidad por ese canal).
-- Transición: las cuentas clásicas existentes que nunca lo probaron quedan sin confirmar y lo confirman al volver a entrar.
-- Rollback: ALTER COLUMN email_verified SET DEFAULT true; DROP TABLE email_verifications; (no revierte la marca de las cuentas).
CREATE TABLE email_verifications (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email      text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_verifications_user_idx ON email_verifications (user_id, created_at DESC);
ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT false;

UPDATE users SET email_verified = false
WHERE email_verified AND google_sub IS NULL AND NOT email_placeholder AND NOT is_demo AND NOT sandbox;
