-- Captación de profesionales: candidatos comerciales (research, campañas, altas espontáneas) en un único backend.
-- Un candidato NO es un profesional registrado: cuando se registra (por cualquier camino) se vincula a su perfil y
-- las etapas Registrado → Verificado → Activo salen del perfil real. Contactado / Interesado los marca el equipo.

CREATE TABLE supply_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,4}-[0-9]{1,6}$'),  -- FX-001 (research) o AL-0001 (alta en Fixy)
  source              text NOT NULL CHECK (source IN ('research','ads','organic','whatsapp','referral','manual')),
  source_detail       text CHECK (length(source_detail) <= 200),   -- planilla, canal o campaña
  source_url          text CHECK (length(source_url) <= 500),
  business_name       text NOT NULL CHECK (length(business_name) BETWEEN 1 AND 200),
  contact_name        text CHECK (length(contact_name) <= 120),
  phone_raw           text CHECK (length(phone_raw) <= 60),
  phone_key           text CHECK (phone_key ~ '^[0-9]{10}$'),       -- característica + número (10 dígitos): para no duplicar
  whatsapp_e164       text CHECK (whatsapp_e164 ~ '^549[0-9]{10}$'),
  email               text CHECK (length(email) <= 200),
  website             text CHECK (length(website) <= 500),
  trades_raw          text CHECK (length(trades_raw) <= 200),        -- el oficio tal como figura en la fuente
  category_ids        uuid[] NOT NULL DEFAULT '{}',
  primary_category_id uuid REFERENCES categories(id),
  base_locality       text CHECK (length(base_locality) <= 120),     -- localidad BASE (no es su zona de cobertura)
  base_zone_id        uuid REFERENCES zones(id),
  base_region         text CHECK (length(base_region) <= 40),
  stage               text NOT NULL DEFAULT 'candidate'
                      CHECK (stage IN ('candidate','contacted','interested','registered','verified','active','discarded')),
  do_not_contact      boolean NOT NULL DEFAULT false,
  opt_out_at          timestamptz,
  owner_id            uuid REFERENCES users(id),
  provider_id         uuid UNIQUE REFERENCES providers(id) ON DELETE SET NULL,
  user_id             uuid REFERENCES users(id) ON DELETE SET NULL,
  contacted_at        timestamptz,
  interested_at       timestamptz,
  registered_at       timestamptz,
  verified_at         timestamptz,
  active_at           timestamptz,
  discarded_at        timestamptz,
  discard_reason      text CHECK (length(discard_reason) <= 300),
  next_action_at      timestamptz,
  notes               text CHECK (length(notes) <= 4000),
  research_data       jsonb NOT NULL DEFAULT '{}',                  -- fila original de la fuente (respaldo)
  utm                 jsonb NOT NULL DEFAULT '{}',
  synced_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supply_leads_phone_idx ON supply_leads (phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX supply_leads_email_idx ON supply_leads (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX supply_leads_stage_idx ON supply_leads (stage);
CREATE INDEX supply_leads_zone_idx ON supply_leads (base_zone_id);
CREATE INDEX supply_leads_cats_idx ON supply_leads USING gin (category_ids);
CREATE INDEX supply_leads_created_idx ON supply_leads (created_at DESC);
ALTER TABLE supply_leads ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER supply_leads_touch BEFORE UPDATE ON supply_leads FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- Historial: importaciones, sincronizaciones, cambios de etapa, contactos, notas, vínculo con el perfil, bajas.
CREATE TABLE supply_lead_events (
  id         bigserial PRIMARY KEY,
  lead_id    uuid NOT NULL REFERENCES supply_leads(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('import','sync_update','stage','contact','note','link','opt_out','assign')),
  detail     jsonb NOT NULL DEFAULT '{}',
  actor_id   uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX supply_lead_events_lead_idx ON supply_lead_events (lead_id, created_at DESC);
ALTER TABLE supply_lead_events ENABLE ROW LEVEL SECURITY;

-- Corridas de importación / sincronización (qué entró, qué se actualizó, qué se descartó y por qué).
CREATE TABLE supply_sync_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source      text NOT NULL,
  trigger     text NOT NULL CHECK (trigger IN ('cron','manual','upload','initial')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok          boolean,
  inserted    int NOT NULL DEFAULT 0,
  updated     int NOT NULL DEFAULT 0,
  unchanged   int NOT NULL DEFAULT 0,
  skipped     int NOT NULL DEFAULT 0,
  issues      jsonb NOT NULL DEFAULT '[]',
  actor_id    uuid REFERENCES users(id)
);
ALTER TABLE supply_sync_runs ENABLE ROW LEVEL SECURITY;

-- Gasto en captación por canal y mes (para el costo por profesional registrado / activo).
CREATE TABLE marketing_spend (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel      text NOT NULL CHECK (channel ~ '^[a-z0-9-]{2,40}$'),
  month        date NOT NULL CHECK (extract(day FROM month) = 1),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  note         text CHECK (length(note) <= 300),
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, month)
);
ALTER TABLE marketing_spend ENABLE ROW LEVEL SECURITY;

-- Barrios cerrados de referencia (research de demanda: dónde concentrar campañas a clientes).
CREATE TABLE gated_community_refs (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partido   text NOT NULL,
  locality  text NOT NULL,
  name      text NOT NULL,
  lots      int CHECK (lots >= 0),
  zone_id   uuid REFERENCES zones(id),
  source    text NOT NULL DEFAULT 'research',
  UNIQUE (name)
);
ALTER TABLE gated_community_refs ENABLE ROW LEVEL SECURITY;

-- Datos de la campaña con la que llegó cada profesional (utm_source, utm_campaign…).
ALTER TABLE providers ADD COLUMN signup_utm jsonb NOT NULL DEFAULT '{}';

-- "Barrio Norte" es Recoleta.
UPDATE zones SET match_names = array_append(match_names, 'barrio norte') WHERE code = 'caba-recoleta' AND NOT ('barrio norte' = ANY (match_names));

-- Códigos de candidatos creados en Fixy (altas espontáneas, carga manual): AL-0001, AL-0002…
CREATE SEQUENCE supply_lead_al_seq;
