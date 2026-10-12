-- Ingreso con Google dentro de la app: Google no permite iniciar sesión en vistas web embebidas, así que el ingreso
-- se hace en el navegador del sistema y vuelve a la app con un código de un solo uso (2 minutos).
-- El código solo sirve junto con el secreto que generó esa misma instalación de la app (challenge = SHA-256 del secreto).
CREATE TABLE app_login_handoffs (
  code_hash  text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge  text NOT NULL,
  next       text NOT NULL DEFAULT '/app',
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_login_handoffs ENABLE ROW LEVEL SECURITY;
