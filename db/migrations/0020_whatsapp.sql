-- WhatsApp (Cloud API de Meta): conversaciones del bot, registro de mensajes, links de vinculación de cuenta.
-- Todo se maneja desde el servidor (rol propietario): RLS activado sin políticas para fixy_app.

-- Número de WhatsApp vinculado a la cuenta (formato de Meta: solo dígitos, ej. 5491155550000).
ALTER TABLE users ADD COLUMN whatsapp_phone text CHECK (whatsapp_phone IS NULL OR whatsapp_phone ~ '^\d{8,16}$');
ALTER TABLE users ADD COLUMN whatsapp_linked_at timestamptz;
CREATE UNIQUE INDEX users_whatsapp_phone_key ON users (whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;

CREATE TABLE whatsapp_conversations (
  phone           text PRIMARY KEY CHECK (phone ~ '^\d{8,16}$'),
  profile_name    text,
  state           jsonb NOT NULL DEFAULT '{"step":"idle"}'::jsonb,
  last_inbound_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE whatsapp_messages (
  id            bigserial PRIMARY KEY,
  wa_message_id text UNIQUE,                       -- idempotencia: Meta reintenta los webhooks
  phone         text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('in','out')),
  kind          text NOT NULL,
  body          jsonb NOT NULL,
  status        text,                              -- salientes: sent / failed / simulated
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_messages_phone_idx ON whatsapp_messages (phone, id DESC);

-- Link para terminar el pedido en la web y vincular el número (el token en claro solo viaja por WhatsApp).
CREATE TABLE whatsapp_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,
  phone       text NOT NULL,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  used_at     timestamptz,
  used_by     uuid REFERENCES users(id)
);

ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_links ENABLE ROW LEVEL SECURITY;
