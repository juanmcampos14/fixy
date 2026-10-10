-- Avisos por WhatsApp para profesionales (oportunidades nuevas, te eligieron, te contrataron).
-- Requieren consentimiento explícito: el profesional los activa y se puede dar de baja escribiendo "BAJA".
ALTER TABLE users ADD COLUMN wa_provider_alerts boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN wa_alerts_consent_at timestamptz;

-- Código de un solo uso para vincular el WhatsApp desde el panel: la persona lo manda desde su teléfono
-- (así probamos que el número es suyo) y queda vinculado a la cuenta que lo pidió.
CREATE TABLE whatsapp_link_codes (
  code_hash  text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose    text NOT NULL DEFAULT 'provider_alerts' CHECK (purpose IN ('provider_alerts')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_link_codes_user_idx ON whatsapp_link_codes (user_id);
ALTER TABLE whatsapp_link_codes ENABLE ROW LEVEL SECURITY;
