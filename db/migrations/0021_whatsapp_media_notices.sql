-- WhatsApp: fotos recibidas por el bot y avisos salientes por el outbox.

-- Avisos por WhatsApp (plantillas aprobadas o texto dentro de la ventana de 24 h), con los mismos reintentos que el email.
ALTER TABLE outbox DROP CONSTRAINT outbox_channel_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_channel_check CHECK (channel IN ('email','whatsapp'));

-- Fotos que manda el cliente por WhatsApp. Quedan privadas (sin dueño) hasta adjuntarse a su pedido.
-- claimed_by: cuenta que vinculó el número con el link (para adjuntarlas al pedido que termina en la web).
CREATE TABLE whatsapp_media (
  id          bigserial PRIMARY KEY,
  phone       text NOT NULL,
  file_id     uuid NOT NULL REFERENCES files(id),
  claimed_by  uuid REFERENCES users(id),
  request_id  uuid REFERENCES service_requests(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_media_phone_idx ON whatsapp_media (phone, created_at DESC) WHERE request_id IS NULL;
ALTER TABLE whatsapp_media ENABLE ROW LEVEL SECURITY;
