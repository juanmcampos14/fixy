-- Auditoría M-08: dar de baja un dispositivo ya no depende de que alguien presente su token sin sesión.
-- Cada dispositivo queda atado a la sesión con la que se registró: al cerrar sesión (o al revocarse las sesiones,
-- por ejemplo al cambiar la contraseña) deja de recibir avisos solo.
ALTER TABLE push_devices ADD COLUMN session_hash text REFERENCES sessions(token_hash) ON DELETE CASCADE;
CREATE INDEX push_devices_session_idx ON push_devices (session_hash) WHERE session_hash IS NOT NULL;
