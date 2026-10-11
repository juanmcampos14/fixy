-- Avisos push de las apps (iOS / Android). Cada dispositivo registra su token al iniciar sesión dentro de la app;
-- el permiso lo da la persona en el sistema operativo y se revoca desde ahí o cerrando sesión.
CREATE TABLE push_devices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform     text NOT NULL CHECK (platform IN ('ios','android')),
  token        text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at  timestamptz
);
CREATE INDEX push_devices_user_idx ON push_devices (user_id) WHERE disabled_at IS NULL;
-- Solo el servidor (dueño de la base) lee y escribe: los tokens no se exponen a ningún rol de aplicación.
ALTER TABLE push_devices ENABLE ROW LEVEL SECURITY;

ALTER TABLE outbox DROP CONSTRAINT outbox_channel_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_channel_check CHECK (channel IN ('email','whatsapp','push'));
