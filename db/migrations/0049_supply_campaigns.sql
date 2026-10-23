-- Campañas de captación sobre los candidatos (supply_leads), seguimiento y API de solo lectura para análisis.
-- Nada de esto es un CRM aparte: las campañas toman candidatos del mismo backend y cada envío queda en su historial.

-- Requisitos de cumplimiento antes de activar campañas (número comercial, base inscripta, textos revisados).
-- Se guardan en platform_settings ('supply.compliance').

CREATE TABLE supply_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL CHECK (length(name) BETWEEN 3 AND 120),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,60}$'),   -- utm_campaign
  channel          text NOT NULL CHECK (channel IN ('whatsapp','email')),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','closed')),
  category_ids     uuid[] NOT NULL DEFAULT '{}',
  regions          text[] NOT NULL DEFAULT '{}',
  zone_ids         uuid[] NOT NULL DEFAULT '{}',
  size             int NOT NULL CHECK (size BETWEEN 1 AND 500),
  first_message    text NOT NULL CHECK (length(first_message) BETWEEN 40 AND 1500),
  followup_message text CHECK (length(followup_message) <= 1500),
  email_subject    text CHECK (length(email_subject) <= 150),
  followup_days    int NOT NULL DEFAULT 4 CHECK (followup_days BETWEEN 1 AND 30),
  max_attempts     int NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 3),
  daily_cap        int NOT NULL DEFAULT 20 CHECK (daily_cap BETWEEN 1 AND 100),
  created_by       uuid REFERENCES users(id),
  activated_at     timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE supply_campaigns ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER supply_campaigns_touch BEFORE UPDATE ON supply_campaigns FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Cada candidato de la campaña: cola, envíos, seguimiento y resultado.
CREATE TABLE supply_campaign_leads (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id      uuid NOT NULL REFERENCES supply_campaigns(id) ON DELETE CASCADE,
  lead_id          uuid NOT NULL REFERENCES supply_leads(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued','sent','replied','no_response','skipped','opted_out')),
  attempts         int NOT NULL DEFAULT 0,
  last_sent_at     timestamptz,
  next_followup_at timestamptz,
  clicked_at       timestamptz,
  replied_at       timestamptz,
  skip_reason      text CHECK (length(skip_reason) <= 200),
  lease_until      timestamptz,                         -- envío de emails: evita dos envíos en paralelo
  last_error       text CHECK (length(last_error) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, lead_id)
);
CREATE INDEX supply_campaign_leads_lead_idx ON supply_campaign_leads (lead_id);
CREATE INDEX supply_campaign_leads_queue_idx ON supply_campaign_leads (campaign_id, status, next_followup_at);
ALTER TABLE supply_campaign_leads ENABLE ROW LEVEL SECURITY;

-- Historial del candidato: clics en la invitación, envíos de campaña y bajas desde el email.
ALTER TABLE supply_lead_events DROP CONSTRAINT supply_lead_events_kind_check;
ALTER TABLE supply_lead_events ADD CONSTRAINT supply_lead_events_kind_check
  CHECK (kind IN ('import','sync_update','stage','contact','note','link','opt_out','assign','click','campaign'));

-- Claves de la API de solo lectura (ChatGPT / Claude / planillas). Solo se guarda el hash.
CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(name) BETWEEN 3 AND 80),
  prefix       text NOT NULL CHECK (prefix ~ '^fixy_ro_[a-z0-9]{6}$'),
  key_hash     text NOT NULL UNIQUE,
  scopes       text[] NOT NULL DEFAULT '{captacion:read}',
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  last_used_at timestamptz,
  use_count    bigint NOT NULL DEFAULT 0,
  revoked_at   timestamptz,
  revoked_by   uuid REFERENCES users(id)
);
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- Registro de cada consulta (qué clave, qué recurso, cuándo). Se conserva 180 días.
CREATE TABLE api_key_requests (
  id         bigserial PRIMARY KEY,
  key_id     uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  method     text NOT NULL,
  path       text NOT NULL CHECK (length(path) <= 200),
  status     int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX api_key_requests_key_idx ON api_key_requests (key_id, created_at DESC);
ALTER TABLE api_key_requests ENABLE ROW LEVEL SECURITY;
