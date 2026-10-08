-- Fixy · Inicialización completa para Supabase (SQL Editor o API; UNA sola vez en un proyecto vacío).
BEGIN;
CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

-- ===== 0001_schema.sql =====
-- Fixy · Esquema base del MVP
-- Importes: enteros en unidades monetarias menores (centavos) + moneda explícita.
-- Convención: estados como text + CHECK (más fácil de evolucionar que ENUM).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS app;

-- ───────────────────────── Identidad ─────────────────────────
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 120),
  phone         text,
  -- Rol de plataforma: solo se asigna desde administración o seeds, nunca desde el registro.
  platform_role text CHECK (platform_role IN ('operator','admin')),
  is_demo       boolean NOT NULL DEFAULT false,
  disabled_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  hits         integer NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE policy_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('terms','privacy','provider_terms')),
  version      text NOT NULL,
  title        text NOT NULL,
  is_draft     boolean NOT NULL DEFAULT true,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, version)
);

CREATE TABLE policy_acceptances (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  policy_id   uuid NOT NULL REFERENCES policy_documents(id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, policy_id)
);

-- ───────────────────── Organizaciones ─────────────────────
CREATE TABLE organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 160),
  tax_id          text,
  billing_email   text,
  billing_address text,
  contact_phone   text,
  is_demo         boolean NOT NULL DEFAULT false,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('admin','member')),
  -- Preparado para aprobaciones por monto (segunda etapa).
  approval_limit_minor bigint CHECK (approval_limit_minor IS NULL OR approval_limit_minor >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX organization_members_user_idx ON organization_members (user_id);

-- ───────────────────── Cobertura y catálogo ─────────────────────
CREATE TABLE zones (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code      text NOT NULL UNIQUE,
  name      text NOT NULL,
  region    text NOT NULL CHECK (region IN ('CABA','GBA_NORTE','GBA_OESTE','GBA_SUR')),
  active    boolean NOT NULL DEFAULT true,
  sort      integer NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  icon        text NOT NULL DEFAULT 'wrench',
  sort        integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  -- "Otro problema / no sé": deriva a revisión operativa.
  requires_review boolean NOT NULL DEFAULT false,
  safety_note text
);

CREATE TABLE credential_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  expires     boolean NOT NULL DEFAULT true
);

CREATE TABLE category_required_credentials (
  category_id        uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  credential_type_id uuid NOT NULL REFERENCES credential_types(id),
  PRIMARY KEY (category_id, credential_type_id)
);

CREATE TABLE services (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   uuid NOT NULL REFERENCES categories(id),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  pricing_mode  text NOT NULL CHECK (pricing_mode IN ('fixed','quote','diagnostic')),
  -- Precio de referencia para servicios con precio cerrado (mano de obra).
  fixed_price_minor      bigint CHECK (fixed_price_minor IS NULL OR fixed_price_minor > 0),
  diagnostic_price_minor bigint CHECK (diagnostic_price_minor IS NULL OR diagnostic_price_minor > 0),
  currency      text NOT NULL DEFAULT 'ARS' CHECK (currency = 'ARS'),
  scope         text NOT NULL DEFAULT '',
  exclusions    text NOT NULL DEFAULT '',
  active        boolean NOT NULL DEFAULT true,
  sort          integer NOT NULL DEFAULT 0,
  CHECK (pricing_mode <> 'fixed' OR fixed_price_minor IS NOT NULL),
  CHECK (pricing_mode <> 'diagnostic' OR diagnostic_price_minor IS NOT NULL)
);
CREATE INDEX services_category_idx ON services (category_id);

CREATE TABLE service_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  key         text NOT NULL,
  label       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('text','select','boolean')),
  options     jsonb NOT NULL DEFAULT '[]'::jsonb,
  required    boolean NOT NULL DEFAULT false,
  sort        integer NOT NULL DEFAULT 0,
  UNIQUE (category_id, key)
);

-- ───────────────────── Configuración comercial ─────────────────────
CREATE TABLE commission_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id       uuid REFERENCES categories(id),  -- NULL = regla por defecto
  provider_rate_bps integer NOT NULL CHECK (provider_rate_bps BETWEEN 0 AND 5000),
  client_rate_bps   integer NOT NULL CHECK (client_rate_bps BETWEEN 0 AND 5000),
  -- Impuesto configurado sobre el cargo de servicio al cliente (0 = sin impuestos configurados).
  client_fee_tax_bps integer NOT NULL DEFAULT 0 CHECK (client_fee_tax_bps BETWEEN 0 AND 5000),
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX commission_rules_active_key
  ON commission_rules (coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE active;

CREATE TABLE platform_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────── Archivos privados ─────────────────────
CREATE TABLE files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by   uuid REFERENCES users(id),
  visibility    text NOT NULL CHECK (visibility IN ('private','public')),
  purpose       text NOT NULL CHECK (purpose IN ('provider_document','portfolio','request_photo','job_evidence','message_attachment','dispute_evidence')),
  storage_key   text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256        text NOT NULL,
  -- Recurso al que pertenece (para autorizar descargas).
  owner_type    text CHECK (owner_type IN ('provider','request','job','conversation','dispute')),
  owner_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_owner_idx ON files (owner_type, owner_id);

-- ───────────────────── Proveedores ─────────────────────
CREATE TABLE providers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('individual','company')),
  slug             text NOT NULL UNIQUE,
  display_name     text NOT NULL CHECK (length(display_name) BETWEEN 2 AND 120),
  legal_name       text,
  tax_id           text,             -- CUIT: privado, nunca se publica
  responsible_name text NOT NULL,
  contact_email    text NOT NULL,
  contact_phone    text,
  description      text NOT NULL DEFAULT '',
  years_experience integer CHECK (years_experience IS NULL OR years_experience BETWEEN 0 AND 80),
  billing_info     text,             -- condición fiscal / datos de facturación (privado)
  accepting_jobs   boolean NOT NULL DEFAULT true,
  max_active_jobs  integer NOT NULL DEFAULT 5 CHECK (max_active_jobs BETWEEN 1 AND 500),
  base_zone_id     uuid REFERENCES zones(id),
  -- Estados separados (ver docs/state-machines.md)
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','in_review','approved','rejected','suspended')),
  identity_status  text NOT NULL DEFAULT 'unverified'
                   CHECK (identity_status IN ('unverified','pending','verified','rejected')),
  payouts_status   text NOT NULL DEFAULT 'not_started'
                   CHECK (payouts_status IN ('not_started','pending','enabled','disabled')),
  payout_account_ref text,          -- referencia de la cuenta en la pasarela (nunca datos bancarios)
  payout_provider    text CHECK (payout_provider IN ('mock','mercadopago')),
  review_note      text,             -- última observación visible para el proveedor
  submitted_at     timestamptz,
  approved_at      timestamptz,
  is_demo          boolean NOT NULL DEFAULT false,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX providers_status_idx ON providers (status);

CREATE TABLE provider_members (
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('admin','technician')),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, user_id)
);
CREATE INDEX provider_members_user_idx ON provider_members (user_id);

CREATE TABLE provider_categories (
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id),
  PRIMARY KEY (provider_id, category_id)
);
CREATE INDEX provider_categories_cat_idx ON provider_categories (category_id);

CREATE TABLE provider_zones (
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  zone_id     uuid NOT NULL REFERENCES zones(id),
  PRIMARY KEY (provider_id, zone_id)
);
CREATE INDEX provider_zones_zone_idx ON provider_zones (zone_id);

CREATE TABLE provider_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id  uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  weekday      integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),   -- 0 = domingo
  start_minute integer NOT NULL CHECK (start_minute BETWEEN 0 AND 1439),
  end_minute   integer NOT NULL CHECK (end_minute BETWEEN 1 AND 1440),
  CHECK (end_minute > start_minute)
);
CREATE INDEX provider_availability_idx ON provider_availability (provider_id);

CREATE TABLE provider_portfolio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files(id),
  caption     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE provider_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id        uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('identity','credential','tax','other')),
  credential_type_id uuid REFERENCES credential_types(id),
  file_id            uuid NOT NULL REFERENCES files(id),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  expires_on         date,
  review_note        text,
  reviewed_by        uuid REFERENCES users(id),
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'credential' OR credential_type_id IS NOT NULL)
);
CREATE INDEX provider_documents_provider_idx ON provider_documents (provider_id);

-- ───────────────────── Propiedades y sedes ─────────────────────
CREATE TABLE properties (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('home','office','site','other')),
  label           text NOT NULL CHECK (length(label) BETWEEN 1 AND 120),
  address_line    text NOT NULL,       -- dirección exacta: sensible
  address_extra   text,                -- piso/depto: sensible
  zone_id         uuid NOT NULL REFERENCES zones(id),
  contact_name    text,
  contact_phone   text,
  access_notes    text,                -- datos de acceso: sensibles
  archived_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NULL) <> (organization_id IS NULL))
);
CREATE INDEX properties_owner_idx ON properties (owner_user_id);
CREATE INDEX properties_org_idx ON properties (organization_id);

-- ───────────────────── Solicitudes ─────────────────────
CREATE SEQUENCE request_code_seq START 1001;

CREATE TABLE request_drafts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,      -- el token en claro solo vive en una cookie httpOnly
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_by  uuid REFERENCES users(id),
  claimed_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE DEFAULT ('S-' || nextval('request_code_seq')),
  created_by      uuid NOT NULL REFERENCES users(id),
  organization_id uuid REFERENCES organizations(id),
  responsible_user_id uuid REFERENCES users(id),
  property_id     uuid NOT NULL REFERENCES properties(id),
  category_id     uuid REFERENCES categories(id),
  service_id      uuid REFERENCES services(id),
  title           text NOT NULL CHECK (length(title) BETWEEN 3 AND 140),
  description     text NOT NULL CHECK (length(description) BETWEEN 10 AND 4000),
  answers         jsonb NOT NULL DEFAULT '{}'::jsonb,
  urgency         text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('flexible','normal','soon','urgent')),
  preferred_windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','submitted','searching','with_quotes','converted','cancelled','no_coverage')),
  needs_review    boolean NOT NULL DEFAULT false,
  review_reason   text,
  safety_flag     text,
  target_provider_id uuid REFERENCES providers(id),   -- presupuesto a un proveedor concreto
  previous_job_id uuid,                                -- "volver a contratar" (FK abajo)
  assistant_source text NOT NULL DEFAULT 'rules' CHECK (assistant_source IN ('rules','ai','manual')),
  cancel_reason   text,
  submitted_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_requests_creator_idx ON service_requests (created_by);
CREATE INDEX service_requests_org_idx ON service_requests (organization_id);
CREATE INDEX service_requests_status_idx ON service_requests (status);
CREATE INDEX service_requests_property_idx ON service_requests (property_id);

-- Datos sensibles de acceso: tabla separada para que la RLS los oculte hasta la contratación con pago aprobado.
CREATE TABLE request_private (
  request_id  uuid PRIMARY KEY REFERENCES service_requests(id) ON DELETE CASCADE,
  access_info text
);

CREATE TABLE request_attachments (
  request_id uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id),
  PRIMARY KEY (request_id, file_id)
);

CREATE TABLE request_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  provider_id  uuid NOT NULL REFERENCES providers(id),
  source       text NOT NULL CHECK (source IN ('matching','client','operator')),
  invited_by   uuid REFERENCES users(id),
  status       text NOT NULL DEFAULT 'invited'
               CHECK (status IN ('invited','viewed','declined','quoted','expired','closed')),
  rank_position integer,
  rank_score   integer,
  rank_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  decline_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (request_id, provider_id)
);
CREATE INDEX request_invitations_provider_idx ON request_invitations (provider_id, status);

-- ───────────────────── Presupuestos ─────────────────────
CREATE TABLE quotes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id         uuid NOT NULL REFERENCES service_requests(id),
  provider_id        uuid NOT NULL REFERENCES providers(id),
  invitation_id      uuid NOT NULL REFERENCES request_invitations(id),
  mode               text NOT NULL CHECK (mode IN ('fixed','quote','diagnostic')),
  status             text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','sent','accepted','rejected','expired','withdrawn')),
  scope              text NOT NULL CHECK (length(scope) BETWEEN 5 AND 4000),
  exclusions         text NOT NULL DEFAULT '',
  materials_included boolean NOT NULL DEFAULT false,
  proposed_date      date,
  proposed_window    text,
  valid_until        timestamptz NOT NULL,
  currency           text NOT NULL DEFAULT 'ARS' CHECK (currency = 'ARS'),
  labor_minor        bigint NOT NULL DEFAULT 0 CHECK (labor_minor >= 0),
  materials_minor    bigint NOT NULL DEFAULT 0 CHECK (materials_minor >= 0),
  visit_minor        bigint NOT NULL DEFAULT 0 CHECK (visit_minor >= 0),
  subtotal_minor     bigint NOT NULL CHECK (subtotal_minor > 0),
  client_fee_minor   bigint NOT NULL CHECK (client_fee_minor >= 0),
  client_fee_tax_minor bigint NOT NULL DEFAULT 0 CHECK (client_fee_tax_minor >= 0),
  provider_fee_minor bigint NOT NULL CHECK (provider_fee_minor >= 0),
  total_minor        bigint NOT NULL CHECK (total_minor > 0),
  provider_net_minor bigint NOT NULL CHECK (provider_net_minor >= 0),
  provider_rate_bps  integer NOT NULL,
  client_rate_bps    integer NOT NULL,
  client_fee_tax_bps integer NOT NULL DEFAULT 0,
  cancellation_terms text NOT NULL,
  created_by         uuid NOT NULL REFERENCES users(id),
  sent_at            timestamptz,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (subtotal_minor = labor_minor + materials_minor + visit_minor),
  CHECK (total_minor = subtotal_minor + client_fee_minor + client_fee_tax_minor),
  CHECK (provider_net_minor = subtotal_minor - provider_fee_minor)
);
CREATE INDEX quotes_request_idx ON quotes (request_id);
CREATE INDEX quotes_provider_idx ON quotes (provider_id);
-- Un proveedor tiene como máximo un presupuesto vigente (enviado) por solicitud.
CREATE UNIQUE INDEX quotes_one_active_per_provider ON quotes (request_id, provider_id) WHERE status IN ('draft','sent');
-- Una solicitud tiene como máximo un presupuesto aceptado.
CREATE UNIQUE INDEX quotes_one_accepted_per_request ON quotes (request_id) WHERE status = 'accepted';

CREATE TABLE quote_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id         uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('labor','materials','visit')),
  description      text NOT NULL,
  quantity         integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  amount_minor     bigint NOT NULL CHECK (amount_minor = quantity * unit_price_minor),
  sort             integer NOT NULL DEFAULT 0
);

-- ───────────────────── Trabajos ─────────────────────
CREATE SEQUENCE job_code_seq START 501;

CREATE TABLE jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE DEFAULT ('T-' || nextval('job_code_seq')),
  request_id         uuid NOT NULL UNIQUE REFERENCES service_requests(id),  -- una única orden por solicitud
  quote_id           uuid NOT NULL UNIQUE REFERENCES quotes(id),
  provider_id        uuid NOT NULL REFERENCES providers(id),
  client_user_id     uuid NOT NULL REFERENCES users(id),
  organization_id    uuid REFERENCES organizations(id),
  property_id        uuid NOT NULL REFERENCES properties(id),
  category_id        uuid REFERENCES categories(id),
  assigned_user_id   uuid REFERENCES users(id),     -- técnico asignado
  mode               text NOT NULL CHECK (mode IN ('fixed','quote','diagnostic')),
  status             text NOT NULL DEFAULT 'pending_confirmation'
                     CHECK (status IN ('pending_confirmation','confirmed','on_the_way','in_progress','pending_approval','completed','cancelled')),
  scheduled_date     date,
  scheduled_window   text,
  -- Copia inmutable del alcance y precio contratados (protegida por trigger).
  contract_snapshot  jsonb NOT NULL,
  currency           text NOT NULL DEFAULT 'ARS' CHECK (currency = 'ARS'),
  total_minor        bigint NOT NULL CHECK (total_minor > 0),
  provider_net_minor bigint NOT NULL CHECK (provider_net_minor >= 0),
  cancel_reason      text,
  cancelled_by       uuid REFERENCES users(id),
  confirmed_at       timestamptz,
  started_at         timestamptz,
  finished_at        timestamptz,
  completed_at       timestamptz,
  cancelled_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_provider_idx ON jobs (provider_id, status);
CREATE INDEX jobs_client_idx ON jobs (client_user_id);
CREATE INDEX jobs_org_idx ON jobs (organization_id);
CREATE INDEX jobs_property_idx ON jobs (property_id);

ALTER TABLE service_requests
  ADD CONSTRAINT service_requests_previous_job_fk FOREIGN KEY (previous_job_id) REFERENCES jobs(id);

CREATE TABLE job_extras (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id             uuid NOT NULL REFERENCES jobs(id),
  description        text NOT NULL CHECK (length(description) BETWEEN 5 AND 2000),
  reason             text NOT NULL,
  labor_minor        bigint NOT NULL DEFAULT 0 CHECK (labor_minor >= 0),
  materials_minor    bigint NOT NULL DEFAULT 0 CHECK (materials_minor >= 0),
  subtotal_minor     bigint NOT NULL CHECK (subtotal_minor > 0),
  client_fee_minor   bigint NOT NULL CHECK (client_fee_minor >= 0),
  client_fee_tax_minor bigint NOT NULL DEFAULT 0,
  provider_fee_minor bigint NOT NULL CHECK (provider_fee_minor >= 0),
  total_minor        bigint NOT NULL CHECK (total_minor > 0),
  provider_net_minor bigint NOT NULL CHECK (provider_net_minor >= 0),
  currency           text NOT NULL DEFAULT 'ARS',
  status             text NOT NULL DEFAULT 'proposed'
                     CHECK (status IN ('proposed','accepted','rejected','withdrawn')),
  proposed_by        uuid NOT NULL REFERENCES users(id),
  decided_by         uuid REFERENCES users(id),
  decision_note      text,
  decided_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (subtotal_minor = labor_minor + materials_minor),
  CHECK (total_minor = subtotal_minor + client_fee_minor + client_fee_tax_minor),
  CHECK (provider_net_minor = subtotal_minor - provider_fee_minor)
);
CREATE INDEX job_extras_job_idx ON job_extras (job_id);

CREATE TABLE job_reschedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL REFERENCES jobs(id),
  proposed_by    uuid NOT NULL REFERENCES users(id),
  proposed_side  text NOT NULL CHECK (proposed_side IN ('client','provider')),
  previous_date  date,
  previous_window text,
  new_date       date NOT NULL,
  new_window     text,
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected','withdrawn')),
  decided_by     uuid REFERENCES users(id),
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX job_reschedules_one_open ON job_reschedules (job_id) WHERE status = 'proposed';

CREATE TABLE job_evidence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      uuid NOT NULL REFERENCES jobs(id),
  file_id     uuid REFERENCES files(id),
  kind        text NOT NULL CHECK (kind IN ('before','progress','after','note')),
  note        text NOT NULL DEFAULT '',
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (file_id IS NOT NULL OR length(note) > 0)
);
CREATE INDEX job_evidence_job_idx ON job_evidence (job_id);

-- Historial de eventos (línea de tiempo y transiciones de estado) para cualquier entidad.
CREATE TABLE entity_events (
  id          bigserial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('request','quote','job','charge','payout','dispute','provider','refund')),
  entity_id   uuid NOT NULL,
  action      text NOT NULL,
  from_state  text,
  to_state    text,
  actor_id    uuid REFERENCES users(id),
  actor_role  text,
  reason      text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entity_events_entity_idx ON entity_events (entity_type, entity_id, id);

-- ───────────────────── Mensajería ─────────────────────
CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES service_requests(id),
  provider_id uuid NOT NULL REFERENCES providers(id),
  job_id      uuid REFERENCES jobs(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, provider_id)
);

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  sender_id       uuid REFERENCES users(id),           -- NULL = mensaje del sistema
  sender_side     text NOT NULL CHECK (sender_side IN ('client','provider','platform','system')),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  file_id         uuid REFERENCES files(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE conversation_reads (
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  last_read_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- ───────────────────── Pagos ─────────────────────
CREATE TABLE charges (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              uuid NOT NULL REFERENCES jobs(id),
  extra_id            uuid REFERENCES job_extras(id),
  kind                text NOT NULL CHECK (kind IN ('visit','job_total','deposit','balance','extra')),
  gateway             text NOT NULL CHECK (gateway IN ('mock','mercadopago')),
  is_test             boolean NOT NULL,
  currency            text NOT NULL DEFAULT 'ARS' CHECK (currency = 'ARS'),
  amount_minor        bigint NOT NULL CHECK (amount_minor > 0),
  client_fee_minor    bigint NOT NULL DEFAULT 0,
  tax_minor           bigint NOT NULL DEFAULT 0,
  provider_fee_minor  bigint NOT NULL DEFAULT 0,
  provider_net_minor  bigint NOT NULL DEFAULT 0,
  refunded_minor      bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','processing','approved','failed','partially_refunded','refunded')),
  external_reference  text NOT NULL UNIQUE,   -- referencia nuestra enviada a la pasarela
  external_payment_id text,                   -- id del pago en la pasarela
  checkout_url        text,
  idempotency_key     text NOT NULL UNIQUE,
  payer_user_id       uuid NOT NULL REFERENCES users(id),
  failure_reason      text,
  status_rank         integer NOT NULL DEFAULT 0,  -- para descartar eventos fuera de orden
  approved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_minor <= amount_minor)
);
CREATE INDEX charges_job_idx ON charges (job_id);
-- Evita cobros duplicados del mismo concepto: solo un cobro vivo/aprobado por trabajo+tipo(+adicional).
CREATE UNIQUE INDEX charges_one_live_per_concept
  ON charges (job_id, kind, coalesce(extra_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status IN ('pending','processing','approved','partially_refunded','refunded');

CREATE TABLE payment_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gateway           text NOT NULL,
  external_event_id text NOT NULL,
  event_type        text NOT NULL,
  external_payment_id text,
  signature_valid   boolean NOT NULL,
  payload           jsonb NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  result            text CHECK (result IN ('applied','ignored_duplicate','ignored_stale','rejected','error')),
  error             text,
  attempts          integer NOT NULL DEFAULT 0,
  UNIQUE (gateway, external_event_id)
);

CREATE TABLE refunds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id        uuid NOT NULL REFERENCES charges(id),
  amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
  currency         text NOT NULL DEFAULT 'ARS',
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','failed')),
  reason           text NOT NULL,
  dispute_id       uuid,
  external_refund_id text,
  idempotency_key  text NOT NULL UNIQUE,
  requested_by     uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz
);
CREATE INDEX refunds_charge_idx ON refunds (charge_id);

CREATE TABLE payouts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES providers(id),
  job_id         uuid NOT NULL REFERENCES jobs(id),
  gateway        text NOT NULL CHECK (gateway IN ('mock','mercadopago')),
  is_test        boolean NOT NULL,
  currency       text NOT NULL DEFAULT 'ARS',
  gross_minor    bigint NOT NULL CHECK (gross_minor >= 0),
  fee_minor      bigint NOT NULL CHECK (fee_minor >= 0),
  adjustments_minor bigint NOT NULL DEFAULT 0,
  amount_minor   bigint NOT NULL CHECK (amount_minor >= 0),   -- neto a liquidar
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','scheduled','processing','paid','failed','reversed')),
  on_hold        boolean NOT NULL DEFAULT false,
  hold_reason    text,
  scheduled_for  date,
  external_ref   text,
  paid_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (amount_minor = gross_minor - fee_minor + adjustments_minor),
  UNIQUE (job_id)
);
CREATE INDEX payouts_provider_idx ON payouts (provider_id, status);

-- Registro financiero de doble entrada simplificado. Inmutable (ver triggers).
CREATE TABLE ledger_entries (
  id            bigserial PRIMARY KEY,
  txn_id        uuid NOT NULL,                 -- agrupa asientos que suman 0
  job_id        uuid REFERENCES jobs(id),
  charge_id     uuid REFERENCES charges(id),
  refund_id     uuid REFERENCES refunds(id),
  payout_id     uuid REFERENCES payouts(id),
  provider_id   uuid REFERENCES providers(id),
  entry_type    text NOT NULL CHECK (entry_type IN ('charge','deposit','balance','extra','platform_fee','provider_payable','refund','chargeback','payout','adjustment','reversal')),
  account       text NOT NULL CHECK (account IN ('gateway_clearing','client_payments','platform_revenue','provider_payable','taxes_payable','refunds')),
  amount_minor  bigint NOT NULL,              -- con signo: débito > 0, crédito < 0
  currency      text NOT NULL DEFAULT 'ARS',
  is_test       boolean NOT NULL,
  external_ref  text,
  reason        text NOT NULL,
  actor_id      uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_job_idx ON ledger_entries (job_id);
CREATE INDEX ledger_provider_idx ON ledger_entries (provider_id);
CREATE INDEX ledger_txn_idx ON ledger_entries (txn_id);

-- ───────────────────── Reclamos y reseñas ─────────────────────
CREATE TABLE disputes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES jobs(id),
  opened_by     uuid NOT NULL REFERENCES users(id),
  opened_side   text NOT NULL CHECK (opened_side IN ('client','provider')),
  reason_code   text NOT NULL CHECK (reason_code IN ('incomplete','quality','damage','no_show','price','behavior','other')),
  description   text NOT NULL CHECK (length(description) BETWEEN 10 AND 4000),
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','in_review','awaiting_response','resolved','closed')),
  resolution    text CHECK (resolution IN ('no_action','partial_refund','full_refund','redo_work','provider_favor','other')),
  resolution_note text,
  resolved_by   uuid REFERENCES users(id),
  assigned_to   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz
);
CREATE INDEX disputes_job_idx ON disputes (job_id);
CREATE UNIQUE INDEX disputes_one_open_per_job ON disputes (job_id) WHERE status IN ('open','in_review','awaiting_response');

ALTER TABLE refunds ADD CONSTRAINT refunds_dispute_fk FOREIGN KEY (dispute_id) REFERENCES disputes(id);

CREATE TABLE dispute_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  uuid NOT NULL REFERENCES disputes(id),
  author_id   uuid NOT NULL REFERENCES users(id),
  author_side text NOT NULL CHECK (author_side IN ('client','provider','platform')),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  file_id     uuid REFERENCES files(id),
  internal    boolean NOT NULL DEFAULT false,   -- notas internas solo visibles para operación
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dispute_messages_idx ON dispute_messages (dispute_id, created_at);

CREATE TABLE reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         uuid NOT NULL UNIQUE REFERENCES jobs(id),   -- una reseña por trabajo
  client_user_id uuid NOT NULL REFERENCES users(id),
  provider_id    uuid NOT NULL REFERENCES providers(id),
  rating         integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        text NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  provider_reply text,
  is_demo        boolean NOT NULL DEFAULT false,
  hidden_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_provider_idx ON reviews (provider_id);

-- ───────────────────── Notificaciones y outbox ─────────────────────
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Outbox persistente: los envíos externos (email, etc.) se procesan con reintentos.
CREATE TABLE outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         text NOT NULL CHECK (channel IN ('email')),
  recipient_user_id uuid REFERENCES users(id),
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','dead')),
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox (next_attempt_at) WHERE status IN ('pending','failed');

CREATE TABLE delivery_attempts (
  id         bigserial PRIMARY KEY,
  outbox_id  uuid NOT NULL REFERENCES outbox(id),
  adapter    text NOT NULL,
  ok         boolean NOT NULL,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────── Auditoría ─────────────────────
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id),
  actor_role  text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  reason      text,
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- Simulación de la pasarela (adaptador "mock"): representa el estado del lado de la pasarela,
-- para poder "consultar" pagos igual que con una integración real. No contiene datos de tarjetas.
CREATE TABLE mock_gateway_payments (
  id                 text PRIMARY KEY,
  external_reference text NOT NULL,
  amount_minor       bigint NOT NULL,
  currency           text NOT NULL,
  status             text NOT NULL CHECK (status IN ('pending','approved','rejected','refunded','partially_refunded')),
  refunded_minor     bigint NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mock_gateway_accounts (
  id          text PRIMARY KEY,
  provider_id uuid NOT NULL UNIQUE REFERENCES providers(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mock_gateway_transfers (
  id           text PRIMARY KEY,
  account_id   text NOT NULL REFERENCES mock_gateway_accounts(id),
  amount_minor bigint NOT NULL,
  reference    text NOT NULL UNIQUE,
  status       text NOT NULL CHECK (status IN ('processing','paid','failed','reversed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (name) VALUES ('0001_schema.sql');

-- ===== 0002_integrity.sql =====
-- Reglas de integridad en la base: transiciones de estado válidas, inmutabilidad
-- de registros contractuales y financieros, y balance del registro financiero.

-- ───────── Transiciones permitidas (fuente de verdad también en src/server/domain/state-machines.ts) ─────────
CREATE TABLE app.allowed_transitions (
  entity     text NOT NULL,
  from_state text NOT NULL,
  to_state   text NOT NULL,
  PRIMARY KEY (entity, from_state, to_state)
);

INSERT INTO app.allowed_transitions (entity, from_state, to_state) VALUES
  -- Solicitud
  ('request','draft','submitted'), ('request','draft','cancelled'),
  ('request','submitted','searching'), ('request','submitted','no_coverage'), ('request','submitted','cancelled'),
  ('request','searching','with_quotes'), ('request','searching','no_coverage'), ('request','searching','cancelled'),
  ('request','no_coverage','searching'), ('request','no_coverage','cancelled'),
  ('request','with_quotes','converted'), ('request','with_quotes','searching'), ('request','with_quotes','cancelled'),
  -- Presupuesto
  ('quote','draft','sent'), ('quote','draft','withdrawn'),
  ('quote','sent','accepted'), ('quote','sent','rejected'), ('quote','sent','expired'), ('quote','sent','withdrawn'),
  -- Trabajo
  ('job','pending_confirmation','confirmed'), ('job','pending_confirmation','cancelled'),
  ('job','confirmed','on_the_way'), ('job','confirmed','in_progress'), ('job','confirmed','cancelled'),
  ('job','on_the_way','in_progress'), ('job','on_the_way','cancelled'),
  ('job','in_progress','pending_approval'), ('job','in_progress','cancelled'),
  ('job','pending_approval','completed'), ('job','pending_approval','in_progress'), ('job','pending_approval','cancelled'),
  -- Cobro
  ('charge','pending','processing'), ('charge','pending','approved'), ('charge','pending','failed'),
  ('charge','processing','approved'), ('charge','processing','failed'),
  ('charge','approved','partially_refunded'), ('charge','approved','refunded'),
  ('charge','partially_refunded','refunded'),
  -- Liquidación
  ('payout','pending','scheduled'), ('payout','pending','failed'),
  ('payout','scheduled','processing'), ('payout','scheduled','pending'), ('payout','scheduled','failed'),
  ('payout','processing','paid'), ('payout','processing','failed'),
  ('payout','failed','scheduled'),
  ('payout','paid','reversed'),
  -- Reclamo
  ('dispute','open','in_review'), ('dispute','open','awaiting_response'), ('dispute','open','resolved'), ('dispute','open','closed'),
  ('dispute','in_review','awaiting_response'), ('dispute','in_review','resolved'), ('dispute','in_review','closed'),
  ('dispute','awaiting_response','in_review'), ('dispute','awaiting_response','resolved'), ('dispute','awaiting_response','closed'),
  ('dispute','resolved','closed'), ('dispute','resolved','in_review'),
  -- Proveedor (estado operativo)
  ('provider','pending','in_review'),
  ('provider','in_review','approved'), ('provider','in_review','rejected'), ('provider','in_review','pending'),
  ('provider','approved','suspended'), ('provider','suspended','approved'),
  ('provider','rejected','pending');

CREATE FUNCTION app.check_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM app.allowed_transitions
      WHERE entity = TG_ARGV[0] AND from_state = OLD.status AND to_state = NEW.status
    ) THEN
      RAISE EXCEPTION 'invalid_transition: % % -> %', TG_ARGV[0], OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER service_requests_transition BEFORE UPDATE OF status ON service_requests
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('request');
CREATE TRIGGER quotes_transition BEFORE UPDATE OF status ON quotes
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('quote');
CREATE TRIGGER jobs_transition BEFORE UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('job');
CREATE TRIGGER charges_transition BEFORE UPDATE OF status ON charges
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('charge');
CREATE TRIGGER payouts_transition BEFORE UPDATE OF status ON payouts
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('payout');
CREATE TRIGGER disputes_transition BEFORE UPDATE OF status ON disputes
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('dispute');
CREATE TRIGGER providers_transition BEFORE UPDATE OF status ON providers
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('provider');

-- ───────── Inmutabilidad ─────────
CREATE FUNCTION app.forbid_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'immutable_record: % no admite %', TG_TABLE_NAME, TG_OP USING ERRCODE = 'check_violation';
END $$;

-- Registros append-only: correcciones mediante asientos de ajuste o reverso.
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER entity_events_immutable BEFORE UPDATE OR DELETE ON entity_events
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER messages_immutable BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER charges_no_delete BEFORE DELETE ON charges
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER refunds_no_delete BEFORE DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER payouts_no_delete BEFORE DELETE ON payouts
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();
CREATE TRIGGER jobs_no_delete BEFORE DELETE ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();

-- El alcance y el precio contratados no se modifican nunca.
CREATE FUNCTION app.protect_job_contract() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contract_snapshot IS DISTINCT FROM OLD.contract_snapshot
     OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
     OR NEW.provider_net_minor IS DISTINCT FROM OLD.provider_net_minor
     OR NEW.quote_id IS DISTINCT FROM OLD.quote_id
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
     OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id
     OR NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'immutable_contract: el contrato del trabajo % no puede modificarse', OLD.code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_protect_contract BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.protect_job_contract();

-- Un presupuesto enviado no cambia de importes ni alcance.
CREATE FUNCTION app.protect_sent_quote() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
    OR NEW.total_minor IS DISTINCT FROM OLD.total_minor
    OR NEW.provider_net_minor IS DISTINCT FROM OLD.provider_net_minor
    OR NEW.client_fee_minor IS DISTINCT FROM OLD.client_fee_minor
    OR NEW.provider_fee_minor IS DISTINCT FROM OLD.provider_fee_minor
    OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.exclusions IS DISTINCT FROM OLD.exclusions
    OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
    OR NEW.mode IS DISTINCT FROM OLD.mode) THEN
    RAISE EXCEPTION 'immutable_quote: un presupuesto enviado no puede modificarse' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quotes_protect_sent BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION app.protect_sent_quote();

-- Adicionales: importes inmutables una vez propuestos.
CREATE FUNCTION app.protect_extra() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.total_minor IS DISTINCT FROM OLD.total_minor
     OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor
     OR NEW.provider_net_minor IS DISTINCT FROM OLD.provider_net_minor
     OR NEW.description IS DISTINCT FROM OLD.description THEN
    RAISE EXCEPTION 'immutable_extra' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'proposed' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'invalid_transition: extra % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER job_extras_protect BEFORE UPDATE ON job_extras
  FOR EACH ROW EXECUTE FUNCTION app.protect_extra();

-- Cobros: importe, moneda y referencias inmutables; reembolsos nunca superan lo cobrado.
CREATE FUNCTION app.protect_charge() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.external_reference IS DISTINCT FROM OLD.external_reference
     OR NEW.is_test IS DISTINCT FROM OLD.is_test THEN
    RAISE EXCEPTION 'immutable_charge' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.refunded_minor < OLD.refunded_minor THEN
    RAISE EXCEPTION 'refunded_amount_cannot_decrease' USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER charges_protect BEFORE UPDATE ON charges
  FOR EACH ROW EXECUTE FUNCTION app.protect_charge();

-- ───────── Balance del registro financiero: cada transacción suma cero ─────────
CREATE FUNCTION app.check_ledger_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  SELECT coalesce(sum(amount_minor), 0) INTO s FROM ledger_entries WHERE txn_id = NEW.txn_id;
  IF s <> 0 THEN
    RAISE EXCEPTION 'unbalanced_ledger_txn: % suma %', NEW.txn_id, s USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION app.check_ledger_balance();

-- ───────── Proveedores suspendidos o no aprobados no reciben trabajos nuevos ─────────
CREATE FUNCTION app.check_job_provider_active() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM providers WHERE id = NEW.provider_id;
  IF st IS DISTINCT FROM 'approved' THEN
    RAISE EXCEPTION 'provider_not_eligible: estado %', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_provider_active BEFORE INSERT ON jobs
  FOR EACH ROW EXECUTE FUNCTION app.check_job_provider_active();
CREATE TRIGGER invitations_provider_active BEFORE INSERT ON request_invitations
  FOR EACH ROW EXECUTE FUNCTION app.check_job_provider_active();

-- Reseñas: solo para trabajos completados y por el cliente del trabajo.
CREATE FUNCTION app.check_review() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE j record;
BEGIN
  SELECT status, client_user_id, provider_id INTO j FROM jobs WHERE id = NEW.job_id;
  IF j.status <> 'completed' THEN
    RAISE EXCEPTION 'review_requires_completed_job' USING ERRCODE = 'check_violation';
  END IF;
  IF j.client_user_id <> NEW.client_user_id OR j.provider_id <> NEW.provider_id THEN
    RAISE EXCEPTION 'review_party_mismatch' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviews_check BEFORE INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION app.check_review();

-- updated_at genérico
CREATE FUNCTION app.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER service_requests_touch BEFORE UPDATE ON service_requests FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER jobs_touch BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER payouts_touch BEFORE UPDATE ON payouts FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER providers_touch BEFORE UPDATE ON providers FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER disputes_touch BEFORE UPDATE ON disputes FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

INSERT INTO schema_migrations (name) VALUES ('0002_integrity.sql');

-- ===== 0003_access.sql =====
-- Control de acceso en la base de datos.
--
-- Las reglas de acceso viven en funciones app.* que reciben el usuario como parámetro.
--  * Las políticas RLS las invocan con app.uid() (usuario de la sesión, fijado por el servidor
--    con set_config('app.user_id', ..., true) dentro de cada transacción).
--  * Los servicios de dominio del servidor las invocan con el id del actor antes de escribir.
-- Así hay una sola fuente de verdad para "quién puede ver/operar qué".
--
-- El rol fixy_app es de solo lectura y está sujeto a RLS. Las escrituras las hace
-- el servidor luego de autorizar explícitamente (ver docs/architecture.md).

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fixy_app') THEN
    CREATE ROLE fixy_app NOLOGIN;
  END IF;
END $$;
GRANT fixy_app TO CURRENT_USER;
GRANT USAGE ON SCHEMA public, app TO fixy_app;

CREATE FUNCTION app.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION app.is_staff(u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = u AND platform_role IN ('operator','admin') AND disabled_at IS NULL)
$$;

CREATE FUNCTION app.is_platform_admin(u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = u AND platform_role = 'admin' AND disabled_at IS NULL)
$$;

CREATE FUNCTION app.org_role(u uuid, org uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM organization_members WHERE user_id = u AND organization_id = org
$$;

CREATE FUNCTION app.provider_role(u uuid, p uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM provider_members WHERE user_id = u AND provider_id = p AND active
$$;

-- Proveedor contratado con el cobro inicial aprobado: recién ahí ve dirección exacta y datos de acceso.
CREATE FUNCTION app.is_revealed_provider(u uuid, req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.request_id = req AND j.status <> 'cancelled'
      AND (app.provider_role(u, j.provider_id) = 'admin' OR (j.assigned_user_id = u AND app.provider_role(u, j.provider_id) IS NOT NULL))
      AND EXISTS (SELECT 1 FROM charges c WHERE c.job_id = j.id AND c.kind IN ('visit','job_total','deposit') AND c.status IN ('approved','partially_refunded','refunded'))
  )
$$;

-- Propiedad: dueño particular, miembro de la organización dueña, o proveedor contratado (con pago aprobado).
CREATE FUNCTION app.can_see_property(u uuid, prop uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.is_staff(u) OR EXISTS (
    SELECT 1 FROM properties p
    WHERE p.id = prop AND (p.owner_user_id = u OR (p.organization_id IS NOT NULL AND app.org_role(u, p.organization_id) IS NOT NULL))
  ) OR EXISTS (
    SELECT 1 FROM service_requests r WHERE r.property_id = prop AND app.is_revealed_provider(u, r.id)
  )
$$;

CREATE FUNCTION app.can_manage_property(u uuid, prop uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM properties p
    WHERE p.id = prop AND (p.owner_user_id = u OR (p.organization_id IS NOT NULL AND app.org_role(u, p.organization_id) = 'admin'))
  )
$$;

-- Lado cliente de una solicitud: creador, responsable, o admin de la organización.
-- Los miembros comunes ven las solicitudes que crearon o de las que son responsables.
CREATE FUNCTION app.is_request_client(u uuid, req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM service_requests r
    WHERE r.id = req AND (
      r.created_by = u OR r.responsible_user_id = u
      OR (r.organization_id IS NOT NULL AND app.org_role(u, r.organization_id) = 'admin')
    )
  )
$$;

-- Lado proveedor: miembros de un proveedor invitado (técnicos solo si tienen el trabajo asignado).
CREATE FUNCTION app.is_request_provider(u uuid, req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM request_invitations i
    WHERE i.request_id = req AND app.provider_role(u, i.provider_id) = 'admin'
  ) OR EXISTS (
    SELECT 1 FROM jobs j WHERE j.request_id = req AND j.assigned_user_id = u
      AND app.provider_role(u, j.provider_id) IS NOT NULL
  )
$$;

CREATE FUNCTION app.can_see_request(u uuid, req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.is_staff(u) OR app.is_request_client(u, req) OR app.is_request_provider(u, req)
$$;

CREATE FUNCTION app.is_job_client(u uuid, job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM jobs j WHERE j.id = job AND app.is_request_client(u, j.request_id))
$$;

CREATE FUNCTION app.is_job_provider(u uuid, job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.id = job AND (
      app.provider_role(u, j.provider_id) = 'admin'
      OR (j.assigned_user_id = u AND app.provider_role(u, j.provider_id) = 'technician')
    )
  )
$$;

CREATE FUNCTION app.can_see_job(u uuid, job uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.is_staff(u) OR app.is_job_client(u, job) OR app.is_job_provider(u, job)
$$;

-- Información financiera del proveedor: solo administradores del proveedor (no técnicos).
CREATE FUNCTION app.can_see_provider_finance(u uuid, p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.is_staff(u) OR app.provider_role(u, p) = 'admin'
$$;

CREATE FUNCTION app.can_see_conversation(u uuid, conv uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = conv AND (
      app.is_staff(u)
      OR app.is_request_client(u, c.request_id)
      OR app.provider_role(u, c.provider_id) = 'admin'
      OR (c.job_id IS NOT NULL AND app.is_job_provider(u, c.job_id))
    )
  )
$$;

-- Nombres visibles de usuarios (sin email ni teléfono) para mostrar contrapartes.
CREATE VIEW user_names AS SELECT id, full_name FROM users;

-- ───────── RLS ─────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_self ON users FOR SELECT TO fixy_app
  USING (id = app.uid() OR app.is_staff(app.uid()));

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_members ON organizations FOR SELECT TO fixy_app
  USING (app.org_role(app.uid(), id) IS NOT NULL OR app.is_staff(app.uid()));

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY organization_members_peers ON organization_members FOR SELECT TO fixy_app
  USING (app.org_role(app.uid(), organization_id) IS NOT NULL OR app.is_staff(app.uid()));

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY properties_owner ON properties FOR SELECT TO fixy_app
  USING (app.can_see_property(app.uid(), id));

ALTER TABLE providers ENABLE ROW LEVEL SECURITY;
-- La fila completa (con CUIT, facturación y referencias de pago) solo la ven sus miembros y la operación.
-- Los datos públicos se leen desde la vista provider_public.
CREATE POLICY providers_visible ON providers FOR SELECT TO fixy_app
  USING (app.provider_role(app.uid(), id) IS NOT NULL OR app.is_staff(app.uid()));

CREATE VIEW provider_public AS
  SELECT id, slug, kind, display_name, description, years_experience, base_zone_id, status,
         identity_status, accepting_jobs, is_demo, created_at, approved_at
  FROM providers;

ALTER TABLE provider_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_members_peers ON provider_members FOR SELECT TO fixy_app
  USING (app.provider_role(app.uid(), provider_id) IS NOT NULL OR app.is_staff(app.uid()));

ALTER TABLE provider_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_documents_private ON provider_documents FOR SELECT TO fixy_app
  USING (app.provider_role(app.uid(), provider_id) = 'admin' OR app.is_staff(app.uid()));

ALTER TABLE files ENABLE ROW LEVEL SECURITY;
CREATE POLICY files_access ON files FOR SELECT TO fixy_app
  USING (
    visibility = 'public'
    OR uploaded_by = app.uid()
    OR app.is_staff(app.uid())
    OR (owner_type = 'provider' AND app.provider_role(app.uid(), owner_id) = 'admin')
    OR (owner_type = 'request' AND app.can_see_request(app.uid(), owner_id))
    OR (owner_type = 'job' AND app.can_see_job(app.uid(), owner_id))
    OR (owner_type = 'conversation' AND app.can_see_conversation(app.uid(), owner_id))
    OR (owner_type = 'dispute' AND EXISTS (SELECT 1 FROM disputes d WHERE d.id = owner_id AND app.can_see_job(app.uid(), d.job_id)))
  );

ALTER TABLE service_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_requests_access ON service_requests FOR SELECT TO fixy_app
  USING (app.can_see_request(app.uid(), id));

ALTER TABLE request_private ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_private_access ON request_private FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid()) OR app.is_request_client(app.uid(), request_id) OR app.is_revealed_provider(app.uid(), request_id));

ALTER TABLE request_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_attachments_access ON request_attachments FOR SELECT TO fixy_app
  USING (app.can_see_request(app.uid(), request_id));

ALTER TABLE request_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_invitations_access ON request_invitations FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid()) OR app.is_request_client(app.uid(), request_id)
         OR app.provider_role(app.uid(), provider_id) = 'admin');

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
-- El cliente ve presupuestos enviados (no borradores); el proveedor ve solo los propios.
CREATE POLICY quotes_access ON quotes FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid())
         OR app.provider_role(app.uid(), provider_id) = 'admin'
         OR (status <> 'draft' AND app.is_request_client(app.uid(), request_id)));

ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY quote_items_access ON quote_items FOR SELECT TO fixy_app
  USING (EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id));  -- hereda la RLS de quotes

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY jobs_access ON jobs FOR SELECT TO fixy_app
  USING (app.can_see_job(app.uid(), id));

ALTER TABLE job_extras ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_extras_access ON job_extras FOR SELECT TO fixy_app USING (app.can_see_job(app.uid(), job_id));
ALTER TABLE job_reschedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_reschedules_access ON job_reschedules FOR SELECT TO fixy_app USING (app.can_see_job(app.uid(), job_id));
ALTER TABLE job_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_evidence_access ON job_evidence FOR SELECT TO fixy_app USING (app.can_see_job(app.uid(), job_id));

ALTER TABLE entity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY entity_events_access ON entity_events FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid())
         OR (entity_type = 'request' AND app.can_see_request(app.uid(), entity_id))
         OR (entity_type = 'job' AND app.can_see_job(app.uid(), entity_id))
         OR (entity_type = 'provider' AND app.provider_role(app.uid(), entity_id) = 'admin'));

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_access ON conversations FOR SELECT TO fixy_app USING (app.can_see_conversation(app.uid(), id));
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_access ON messages FOR SELECT TO fixy_app USING (app.can_see_conversation(app.uid(), conversation_id));

ALTER TABLE charges ENABLE ROW LEVEL SECURITY;
-- Cobros: cliente del trabajo y administración del proveedor (no técnicos).
CREATE POLICY charges_access ON charges FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid()) OR app.is_job_client(app.uid(), job_id)
         OR EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_id AND app.can_see_provider_finance(app.uid(), j.provider_id)));

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY refunds_access ON refunds FOR SELECT TO fixy_app
  USING (EXISTS (SELECT 1 FROM charges c WHERE c.id = charge_id));   -- hereda la RLS de charges

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY payouts_access ON payouts FOR SELECT TO fixy_app
  USING (app.can_see_provider_finance(app.uid(), provider_id));

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_access ON ledger_entries FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid()));

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_events_staff ON payment_events FOR SELECT TO fixy_app USING (app.is_staff(app.uid()));

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY disputes_access ON disputes FOR SELECT TO fixy_app USING (app.can_see_job(app.uid(), job_id));
ALTER TABLE dispute_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY dispute_messages_access ON dispute_messages FOR SELECT TO fixy_app
  USING (EXISTS (SELECT 1 FROM disputes d WHERE d.id = dispute_id)
         AND (NOT internal OR app.is_staff(app.uid())));

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_public ON reviews FOR SELECT TO fixy_app USING (hidden_at IS NULL OR app.is_staff(app.uid()));

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_own ON notifications FOR SELECT TO fixy_app USING (user_id = app.uid());

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_staff ON audit_log FOR SELECT TO fixy_app USING (app.is_staff(app.uid()));

ALTER TABLE outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_staff ON outbox FOR SELECT TO fixy_app USING (app.is_staff(app.uid()));

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;            -- sin política: invisible para fixy_app
ALTER TABLE request_drafts ENABLE ROW LEVEL SECURITY;      -- idem
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;         -- idem

-- Tablas de catálogo y configuración: lectura pública.
GRANT SELECT ON zones, categories, services, service_questions, credential_types, category_required_credentials,
  commission_rules, platform_settings, policy_documents, provider_categories, provider_zones,
  provider_availability, provider_portfolio, user_names, provider_public TO fixy_app;

GRANT SELECT ON request_private, users, organizations, organization_members, properties, providers, provider_members,
  provider_documents, files, service_requests, request_attachments, request_invitations, quotes, quote_items,
  jobs, job_extras, job_reschedules, job_evidence, entity_events, conversations, messages, charges, refunds,
  payouts, ledger_entries, payment_events, disputes, dispute_messages, reviews, notifications, audit_log, outbox,
  policy_acceptances, conversation_reads TO fixy_app;

ALTER TABLE policy_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY policy_acceptances_own ON policy_acceptances FOR SELECT TO fixy_app USING (user_id = app.uid() OR app.is_staff(app.uid()));
ALTER TABLE conversation_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversation_reads_own ON conversation_reads FOR SELECT TO fixy_app USING (user_id = app.uid());

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO fixy_app;

INSERT INTO schema_migrations (name) VALUES ('0003_access.sql');

-- ===== 0004_public_views.sql =====
-- Verificaciones públicas: credenciales aprobadas y vigentes (sin el documento ni datos personales).
CREATE VIEW provider_credentials_public AS
  SELECT DISTINCT d.provider_id, d.credential_type_id, max(d.expires_on) OVER (PARTITION BY d.provider_id, d.credential_type_id) AS expires_on
  FROM provider_documents d
  WHERE d.kind = 'credential' AND d.status = 'approved' AND (d.expires_on IS NULL OR d.expires_on >= current_date);
GRANT SELECT ON provider_credentials_public TO fixy_app;

-- Historial de reclamos visible para las partes del trabajo.
DROP POLICY entity_events_access ON entity_events;
CREATE POLICY entity_events_access ON entity_events FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid())
         OR (entity_type = 'request' AND app.can_see_request(app.uid(), entity_id))
         OR (entity_type = 'job' AND app.can_see_job(app.uid(), entity_id))
         OR (entity_type = 'dispute' AND EXISTS (SELECT 1 FROM disputes d WHERE d.id = entity_id AND app.can_see_job(app.uid(), d.job_id)))
         OR (entity_type = 'provider' AND app.provider_role(app.uid(), entity_id) = 'admin'));

INSERT INTO schema_migrations (name) VALUES ('0004_public_views.sql');

-- ===== 0005_supabase_hardening.sql =====
-- Endurecimiento para Supabase: la app se conecta por Postgres directo (rol propietario + fixy_app con RLS)
-- y NO usa la API REST (PostgREST) ni la anon key. Supabase otorga por defecto privilegios a anon/authenticated
-- sobre el esquema public: los revocamos para que nada quede expuesto por la API REST.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON SCHEMA app FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;

-- Defensa en profundidad: RLS también en tablas internas sin acceso desde la app (sin políticas = invisibles para fixy_app).
ALTER TABLE delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_gateway_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_gateway_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE mock_gateway_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (name) VALUES ('0005_supabase_hardening.sql');

-- ===== 0006_password_resets.sql =====
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

INSERT INTO schema_migrations (name) VALUES ('0006_password_resets.sql');

-- ===== 0007_reviews_privacy.sql =====
-- Reseñas: obligatorias para liberar la liquidación y publicadas con demora variable para
-- que el profesional no pueda asociar una reseña a un cliente.

ALTER TABLE reviews ADD COLUMN visible_at timestamptz;
UPDATE reviews SET visible_at = created_at;               -- reseñas existentes: ya visibles
ALTER TABLE reviews ALTER COLUMN visible_at SET NOT NULL;
ALTER TABLE reviews ADD COLUMN publish_notified boolean NOT NULL DEFAULT false;
UPDATE reviews SET publish_notified = true;
CREATE INDEX reviews_visible_idx ON reviews (provider_id, visible_at);
CREATE INDEX reviews_publish_pending_idx ON reviews (visible_at) WHERE NOT publish_notified;

-- La fila completa (trabajo, cliente, fecha exacta) solo la ven el propio cliente y el equipo.
DROP POLICY reviews_public ON reviews;
CREATE POLICY reviews_private ON reviews FOR SELECT TO fixy_app
  USING (client_user_id = app.uid() OR app.is_staff(app.uid()));

-- Vista pública y para proveedores: solo reseñas ya publicadas, sin trabajo, sin cliente y sin fecha exacta.
-- El orden sugerido (sort_key) no es cronológico dentro del mes.
CREATE VIEW reviews_published AS
  SELECT id, provider_id, rating, comment, provider_reply, is_demo,
         date_trunc('month', visible_at)::date AS published_month,
         md5(id::text) AS sort_key
  FROM reviews
  WHERE hidden_at IS NULL AND visible_at <= now();
GRANT SELECT ON reviews_published TO fixy_app;

-- Liquidaciones: sin reseña del cliente no se liberan (salvo excepción de operación, auditada).
ALTER TABLE payouts ADD COLUMN awaiting_review boolean NOT NULL DEFAULT false;
ALTER TABLE payouts ADD COLUMN review_override_reason text;
UPDATE payouts p SET awaiting_review = true
  WHERE p.status IN ('pending','scheduled','failed') AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.job_id = p.job_id);

-- Recordatorios al cliente para calificar.
ALTER TABLE jobs ADD COLUMN review_reminders integer NOT NULL DEFAULT 0;

INSERT INTO platform_settings (key, value) VALUES
  ('reviews.publish_delay_hours', '[48, 72, 168]'::jsonb),
  ('reviews.publish_jitter_hours', '12'::jsonb),
  ('reviews.reminder_days', '[1, 3, 7]'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0007_reviews_privacy.sql');

-- ===== 0008_provider_signup_source.sql =====
-- Origen del alta de proveedores (campañas /sumate y referidos), para medir de dónde llegan.
ALTER TABLE providers ADD COLUMN signup_source text CHECK (signup_source IS NULL OR length(signup_source) <= 120);
ALTER TABLE providers ADD COLUMN referred_by_provider_id uuid REFERENCES providers(id);
CREATE INDEX providers_signup_source_idx ON providers (signup_source);

INSERT INTO schema_migrations (name) VALUES ('0008_provider_signup_source.sql');

-- ===== 0009_review_disputes.sql =====
-- Impugnación de reseñas: el proveedor cuestiona una reseña publicada (sin saber quién la escribió);
-- una IA consulta al cliente y evalúa; si no se resuelve, pasa a revisión humana.

CREATE TABLE review_disputes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id           uuid NOT NULL REFERENCES reviews(id),
  provider_id         uuid NOT NULL REFERENCES providers(id),
  opened_by           uuid NOT NULL REFERENCES users(id),
  reason_code         text NOT NULL CHECK (reason_code IN ('false_facts','not_my_job','offensive','personal_data','extortion','other')),
  provider_statement  text NOT NULL CHECK (length(provider_statement) BETWEEN 20 AND 3000),
  status              text NOT NULL DEFAULT 'awaiting_client'
                      CHECK (status IN ('awaiting_client','ai_review','escalated','resolved','closed')),
  resolution          text CHECK (resolution IN ('kept','edited','withdrawn','hidden','other')),
  resolved_by_ai      boolean NOT NULL DEFAULT false,
  resolved_by         uuid REFERENCES users(id),
  ai_rounds           integer NOT NULL DEFAULT 0,
  ai_last_decision    jsonb,
  internal_summary    text,          -- análisis para operación (puede identificar a las partes)
  provider_summary    text,          -- resumen para el proveedor (nunca identifica al cliente)
  escalation_reason   text,
  client_deadline     timestamptz NOT NULL DEFAULT now() + interval '5 days',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz
);
-- Una impugnación por reseña (la decisión final no se puede re-impugnar desde el panel).
CREATE UNIQUE INDEX review_disputes_one_per_review ON review_disputes (review_id);
CREATE INDEX review_disputes_status_idx ON review_disputes (status, created_at);
CREATE TRIGGER review_disputes_touch BEFORE UPDATE ON review_disputes FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

INSERT INTO app.allowed_transitions (entity, from_state, to_state) VALUES
  ('review_dispute','awaiting_client','ai_review'), ('review_dispute','awaiting_client','escalated'), ('review_dispute','awaiting_client','resolved'),
  ('review_dispute','ai_review','awaiting_client'), ('review_dispute','ai_review','resolved'), ('review_dispute','ai_review','escalated'),
  ('review_dispute','escalated','resolved'), ('review_dispute','escalated','awaiting_client'),
  ('review_dispute','resolved','closed');
CREATE TRIGGER review_disputes_transition BEFORE UPDATE OF status ON review_disputes
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('review_dispute');

-- Conversación de la consulta: cliente ↔ asistente (IA) ↔ operación. El proveedor no la ve.
CREATE TABLE review_dispute_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispute_id  uuid NOT NULL REFERENCES review_disputes(id),
  author      text NOT NULL CHECK (author IN ('client','ai','admin','system')),
  author_id   uuid REFERENCES users(id),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_dispute_messages_idx ON review_dispute_messages (dispute_id, created_at);
CREATE TRIGGER review_dispute_messages_immutable BEFORE UPDATE OR DELETE ON review_dispute_messages
  FOR EACH ROW EXECUTE FUNCTION app.forbid_change();

-- Historial de versiones de reseñas (ediciones del cliente), y retiro voluntario.
CREATE TABLE review_revisions (
  id         bigserial PRIMARY KEY,
  review_id  uuid NOT NULL REFERENCES reviews(id),
  rating     integer NOT NULL,
  comment    text NOT NULL,
  reason     text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reviews ADD COLUMN edited_at timestamptz;
ALTER TABLE reviews ADD COLUMN withdrawn_at timestamptz;

-- RLS
ALTER TABLE review_disputes ENABLE ROW LEVEL SECURITY;
-- La fila completa (con el análisis interno) solo la ve operación. Proveedor y cliente usan vistas acotadas.
CREATE POLICY review_disputes_staff ON review_disputes FOR SELECT TO fixy_app USING (app.is_staff(app.uid()));
ALTER TABLE review_dispute_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_dispute_messages_access ON review_dispute_messages FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid())
         OR EXISTS (SELECT 1 FROM review_disputes d JOIN reviews r ON r.id = d.review_id WHERE d.id = dispute_id AND r.client_user_id = app.uid()));
ALTER TABLE review_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY review_revisions_access ON review_revisions FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid()) OR EXISTS (SELECT 1 FROM reviews r WHERE r.id = review_id AND r.client_user_id = app.uid()));
GRANT SELECT ON review_disputes, review_dispute_messages, review_revisions TO fixy_app;

-- Vista del proveedor: estado y resumen no identificatorio de SUS impugnaciones.
CREATE VIEW review_disputes_provider AS
  SELECT d.id, d.review_id, d.provider_id, d.reason_code, d.status, d.resolution, d.provider_summary, d.created_at, d.resolved_at
  FROM review_disputes d
  WHERE app.provider_role(app.uid(), d.provider_id) = 'admin' OR app.is_staff(app.uid());
-- Vista del cliente autor de la reseña: estado de la consulta (sin el descargo literal ni el análisis interno).
CREATE VIEW review_disputes_client AS
  SELECT d.id, d.review_id, d.reason_code, d.status, d.resolution, d.client_deadline, d.created_at, d.resolved_at
  FROM review_disputes d JOIN reviews r ON r.id = d.review_id
  WHERE r.client_user_id = app.uid();
GRANT SELECT ON review_disputes_provider, review_disputes_client TO fixy_app;

INSERT INTO platform_settings (key, value) VALUES
  ('reviews.dispute_window_days', '30'::jsonb),
  ('reviews.dispute_client_days', '5'::jsonb),
  ('reviews.dispute_max_ai_rounds', '2'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0009_review_disputes.sql');

-- ===== 0010_review_dispute_client_access.sql =====
-- El cliente autor de la reseña debe ver la conversación de la revisión (la tabla review_disputes es solo de operación).
CREATE FUNCTION app.is_review_dispute_client(u uuid, dispute uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM review_disputes d JOIN reviews r ON r.id = d.review_id WHERE d.id = dispute AND r.client_user_id = u)
$$;
GRANT EXECUTE ON FUNCTION app.is_review_dispute_client(uuid, uuid) TO fixy_app;

DROP POLICY review_dispute_messages_access ON review_dispute_messages;
CREATE POLICY review_dispute_messages_access ON review_dispute_messages FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid()) OR app.is_review_dispute_client(app.uid(), dispute_id));

INSERT INTO schema_migrations (name) VALUES ('0010_review_dispute_client_access.sql');

-- ===== 0011_direct_booking.sql =====
-- Modelo "elegí a tu profesional": el cliente elige un profesional, reserva la visita (con o sin cargo,
-- según defina cada profesional), el profesional ve el problema y cotiza el arreglo en el lugar dentro de Fixy.

-- Visita definida por cada profesional (0 = sin cargo) y si se descuenta del trabajo si el cliente lo contrata.
ALTER TABLE providers ADD COLUMN visit_fee_minor bigint NOT NULL DEFAULT 0 CHECK (visit_fee_minor >= 0 AND visit_fee_minor <= 100000000);
ALTER TABLE providers ADD COLUMN visit_fee_credited boolean NOT NULL DEFAULT true;

-- Precios de referencia "desde" por servicio (información pública del perfil).
CREATE TABLE provider_price_refs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id),
  title       text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  from_minor  bigint NOT NULL CHECK (from_minor > 0),
  note        text NOT NULL DEFAULT '' CHECK (length(note) <= 300),
  sort        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_price_refs_idx ON provider_price_refs (provider_id, category_id);
GRANT SELECT ON provider_price_refs TO fixy_app;

-- Modo de la solicitud: reserva directa a un profesional elegido, o presupuestos de varios (opción secundaria).
ALTER TABLE service_requests ADD COLUMN request_mode text NOT NULL DEFAULT 'quotes' CHECK (request_mode IN ('direct','quotes'));
-- Plazo para que el profesional responda una reserva directa.
ALTER TABLE request_invitations ADD COLUMN respond_by timestamptz;
CREATE INDEX request_invitations_respond_by_idx ON request_invitations (respond_by) WHERE status IN ('invited','viewed');

-- Visitas sin cargo: el presupuesto de visita y el trabajo pueden valer $0 (no se crea cobro).
ALTER TABLE quotes DROP CONSTRAINT quotes_subtotal_minor_check, DROP CONSTRAINT quotes_total_minor_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_subtotal_minor_check CHECK (subtotal_minor >= 0),
                   ADD CONSTRAINT quotes_total_minor_check CHECK (total_minor >= 0),
                   ADD CONSTRAINT quotes_zero_only_visit CHECK (total_minor > 0 OR mode = 'diagnostic');
ALTER TABLE jobs DROP CONSTRAINT jobs_total_minor_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_total_minor_check CHECK (total_minor >= 0);

-- Código de visita: el cliente se lo da al profesional al llegar; registra que la visita ocurrió.
ALTER TABLE jobs ADD COLUMN visit_code text CHECK (visit_code IS NULL OR visit_code ~ '^[0-9]{4}$');
ALTER TABLE jobs ADD COLUMN checked_in_at timestamptz;

-- Presupuesto del arreglo en el lugar (adicional) con descuento de la visita ya pagada, si corresponde.
ALTER TABLE job_extras ADD COLUMN discount_minor bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0);
ALTER TABLE job_extras ADD COLUMN is_main_quote boolean NOT NULL DEFAULT false;
ALTER TABLE job_extras DROP CONSTRAINT job_extras_check, DROP CONSTRAINT job_extras_subtotal_minor_check, DROP CONSTRAINT job_extras_total_minor_check;
ALTER TABLE job_extras ADD CONSTRAINT job_extras_subtotal_minor_check CHECK (subtotal_minor >= 0), ADD CONSTRAINT job_extras_total_minor_check CHECK (total_minor >= 0);
ALTER TABLE job_extras ADD CONSTRAINT job_extras_check CHECK (subtotal_minor = labor_minor + materials_minor - discount_minor);

-- Revelado de dirección y acceso: profesional elegido con la visita confirmada (pagada, o sin cargo).
CREATE OR REPLACE FUNCTION app.is_revealed_provider(u uuid, req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM jobs j
    WHERE j.request_id = req AND j.status <> 'cancelled'
      AND (app.provider_role(u, j.provider_id) = 'admin' OR (j.assigned_user_id = u AND app.provider_role(u, j.provider_id) IS NOT NULL))
      AND (
        EXISTS (SELECT 1 FROM charges c WHERE c.job_id = j.id AND c.kind IN ('visit','job_total','deposit') AND c.status IN ('approved','partially_refunded','refunded'))
        OR (j.total_minor = 0 AND j.status <> 'pending_confirmation')
      )
  )
$$;

INSERT INTO platform_settings (key, value) VALUES
  ('booking.respond_hours', '4'::jsonb),
  ('booking.respond_hours_urgent', '2'::jsonb)
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0011_direct_booking.sql');

-- ===== 0012_provider_visit_public.sql =====
-- Datos públicos de la visita del profesional (para mostrar al cliente), sin exponer columnas privadas.
CREATE VIEW providers_visit_public AS SELECT id, visit_fee_minor, visit_fee_credited FROM providers WHERE status = 'approved';
GRANT SELECT ON providers_visit_public TO fixy_app;

INSERT INTO schema_migrations (name) VALUES ('0012_provider_visit_public.sql');

-- ===== 0013_geolocation.sql =====
-- Ubicación con Google: coordenadas y dirección normalizada por propiedad, y nombres de barrios/partidos
-- que corresponden a cada zona de cobertura (para asignar la zona automáticamente desde la dirección).

ALTER TABLE properties ADD COLUMN lat double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90);
ALTER TABLE properties ADD COLUMN lng double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180);
ALTER TABLE properties ADD COLUMN place_id text CHECK (place_id IS NULL OR length(place_id) <= 300);
ALTER TABLE properties ADD COLUMN formatted_address text CHECK (formatted_address IS NULL OR length(formatted_address) <= 300);

ALTER TABLE zones ADD COLUMN match_names text[] NOT NULL DEFAULT '{}';

UPDATE zones SET match_names = v.names FROM (VALUES
  ('caba-palermo',     ARRAY['palermo','colegiales','chacarita','villa crespo']),
  ('caba-belgrano',    ARRAY['belgrano','nunez','coghlan']),
  ('caba-recoleta',    ARRAY['recoleta','retiro']),
  ('caba-centro',      ARRAY['san nicolas','monserrat','montserrat','balvanera','puerto madero','san cristobal']),
  ('caba-caballito',   ARRAY['caballito','almagro','boedo','parque chacabuco']),
  ('caba-urquiza',     ARRAY['villa urquiza','saavedra','villa pueyrredon','villa ortuzar','parque chas','agronomia','villa devoto','villa del parque','villa general mitre','villa santa rita','la paternal','paternal']),
  ('caba-flores',      ARRAY['flores','floresta','velez sarsfield','villa luro','liniers','mataderos','parque avellaneda','villa real','monte castro','versalles','villa lugano','villa riachuelo','villa soldati']),
  ('caba-sur',         ARRAY['san telmo','barracas','la boca','boca','constitucion','parque patricios','nueva pompeya']),
  ('gba-vicente-lopez',ARRAY['vicente lopez','olivos','florida','florida oeste','munro','la lucila','villa martelli','carapachay','villa adelina']),
  ('gba-san-isidro',   ARRAY['san isidro','martinez','acassuso','beccar','boulogne','boulogne sur mer','villa adelina']),
  ('gba-tigre',        ARRAY['tigre','don torcuato','general pacheco','benavidez','nordelta','el talar','rincon de milberg','troncos del talar']),
  ('gba-moron',        ARRAY['moron','castelar','haedo','el palomar','villa sarmiento']),
  ('gba-la-matanza',   ARRAY['la matanza','san justo','ramos mejia','isidro casanova','gonzalez catan','lomas del mirador','villa luzuriaga','tapiales','la tablada','gregorio de laferrere','ciudad evita','rafael castillo']),
  ('gba-avellaneda',   ARRAY['avellaneda','wilde','sarandi','dock sud','villa dominico','gerli','pineyro']),
  ('gba-lanus',        ARRAY['lanus','remedios de escalada','monte chingolo','valentin alsina','gerli']),
  ('gba-lomas',        ARRAY['lomas de zamora','banfield','temperley','turdera','llavallol','villa fiorito','ingeniero budge']),
  ('gba-quilmes',      ARRAY['quilmes','bernal','ezpeleta','don bosco','san francisco solano'])
) AS v(code, names) WHERE zones.code = v.code;

INSERT INTO schema_migrations (name) VALUES ('0013_geolocation.sql');

-- ===== 0014_gated_communities.sql =====
-- Barrios cerrados / countries: requisitos de ingreso interpretados con IA.
-- Privacidad: el nombre del barrio y el reglamento original son tan sensibles como la dirección
-- (los ve el cliente, la operación y el profesional recién con la visita confirmada).
-- Los REQUISITOS extraídos (sin nombre, lote ni contactos) los ve cualquier profesional invitado al pedido,
-- para que sepa antes de aceptar qué necesita para entrar.

ALTER TABLE properties ADD COLUMN gated_community boolean NOT NULL DEFAULT false;
ALTER TABLE properties ADD COLUMN gated_name text CHECK (gated_name IS NULL OR length(gated_name) <= 120);
ALTER TABLE properties ADD COLUMN gated_rules_url text CHECK (gated_rules_url IS NULL OR (length(gated_rules_url) <= 500 AND gated_rules_url ~ '^https://'));
ALTER TABLE properties ADD COLUMN gated_rules_text text CHECK (gated_rules_text IS NULL OR length(gated_rules_text) <= 20000);
ALTER TABLE properties ADD COLUMN gated_rules_file_id uuid REFERENCES files(id);
ALTER TABLE properties ADD COLUMN gated_requirements jsonb;
ALTER TABLE properties ADD COLUMN gated_requirements_status text NOT NULL DEFAULT 'none'
  CHECK (gated_requirements_status IN ('none','ready','failed'));
ALTER TABLE properties ADD COLUMN gated_client_notes text CHECK (gated_client_notes IS NULL OR length(gated_client_notes) <= 2000);
ALTER TABLE properties ADD COLUMN gated_requirements_updated_at timestamptz;

-- Archivos de reglamento: dueño = propiedad.
ALTER TABLE files DROP CONSTRAINT files_purpose_check;
ALTER TABLE files ADD CONSTRAINT files_purpose_check CHECK (purpose IN ('provider_document','portfolio','request_photo','job_evidence','message_attachment','dispute_evidence','property_document'));
ALTER TABLE files DROP CONSTRAINT files_owner_type_check;
ALTER TABLE files ADD CONSTRAINT files_owner_type_check CHECK (owner_type IN ('provider','request','job','conversation','dispute','property'));

DROP POLICY files_access ON files;
CREATE POLICY files_access ON files FOR SELECT TO fixy_app
  USING (
    visibility = 'public'
    OR uploaded_by = app.uid()
    OR app.is_staff(app.uid())
    OR (owner_type = 'provider' AND app.provider_role(app.uid(), owner_id) = 'admin')
    OR (owner_type = 'request' AND app.can_see_request(app.uid(), owner_id))
    OR (owner_type = 'job' AND app.can_see_job(app.uid(), owner_id))
    OR (owner_type = 'conversation' AND app.can_see_conversation(app.uid(), owner_id))
    OR (owner_type = 'dispute' AND EXISTS (SELECT 1 FROM disputes d WHERE d.id = owner_id AND app.can_see_job(app.uid(), d.job_id)))
    OR (owner_type = 'property' AND app.can_see_property(app.uid(), owner_id))
  );

-- Requisitos de ingreso por pedido, sin datos que ubiquen la propiedad.
CREATE VIEW request_access_requirements AS
  SELECT r.id AS request_id, p.gated_community, p.gated_requirements, p.gated_client_notes, p.gated_requirements_updated_at
  FROM service_requests r JOIN properties p ON p.id = r.property_id
  WHERE p.gated_community AND app.can_see_request(app.uid(), r.id);
GRANT SELECT ON request_access_requirements TO fixy_app;

INSERT INTO schema_migrations (name) VALUES ('0014_gated_communities.sql');

-- ===== 0015_provider_quickstart.sql =====
-- Alta simple de profesionales: borrador asistido por IA y "fuerza del perfil" que pesa en el ranking.
ALTER TABLE providers ADD COLUMN visit_configured_at timestamptz;
ALTER TABLE providers ADD COLUMN profile_ai_assisted boolean NOT NULL DEFAULT false;
-- Los perfiles que ya tenían visita con cargo cuentan como configurados.
UPDATE providers SET visit_configured_at = now() WHERE visit_fee_minor > 0;

INSERT INTO schema_migrations (name) VALUES ('0015_provider_quickstart.sql');

-- ===== Datos base =====
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('c6fa884a-d418-499b-8913-b2ed017d09f3', 'electricidad', 'Electricidad', 'Enchufes, térmicas, cortes, luminarias y tableros.', 'zap', 0, true, false, 'Si ves chispas, olor a quemado o cables expuestos, no los toques y cortá la luz desde la térmica general si podés hacerlo sin riesgo.') ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('70120849-f4f3-407a-ba86-e916a9d939bd', 'plomeria', 'Plomería', 'Pérdidas, canillas, inodoros, desagües y cañerías.', 'droplets', 1, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('4cfcf278-2d69-4e5e-9464-c0ee96585de7', 'gas', 'Gas', 'Artefactos a gas, calefones, estufas y cocinas. Solo profesionales con matrícula.', 'flame', 2, true, false, 'Si sentís olor a gas: no prendas ni apagues luces, ventilá, salí del lugar y llamá a la emergencia de tu distribuidora o al 911.') ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('a7f6c419-b86e-4954-b994-e0ac30989a60', 'climatizacion', 'Aire acondicionado y climatización', 'Instalación, mantenimiento y reparación de equipos.', 'snowflake', 3, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('589e17ca-73f6-45ee-bfb2-e647cf5e0169', 'electrodomesticos', 'Electrodomésticos', 'Heladeras, lavarropas, hornos y otros equipos.', 'washing-machine', 4, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('8d3cdafd-86ab-4dfc-a6e6-c7b5e1ddbb61', 'cerrajeria', 'Cerrajería', 'Cerraduras, aperturas, cambios de combinación.', 'key-round', 5, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('177f8bac-25b2-49fd-9d32-8e0faa14924f', 'pintura', 'Pintura', 'Interiores, exteriores, retoques y preparación de superficies.', 'paint-roller', 6, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('bf91f935-56bc-4451-ae83-a59aa2bd3692', 'albanileria', 'Albañilería', 'Revoques, grietas, humedad, cerámicos y pequeñas obras.', 'brick-wall', 7, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('f5306542-dae3-40a9-966f-a1b50f98cf04', 'carpinteria', 'Carpintería', 'Muebles, puertas, placares y armado.', 'hammer', 8, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('49d2e2f6-1c41-4c8c-8bb0-d5b39b43a913', 'limpieza', 'Limpieza', 'Limpieza profunda, final de obra y oficinas.', 'sparkles', 9, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('1a869859-24b0-442f-ac09-883068c3f057', 'informatica', 'Informática y redes', 'Wi-Fi, redes, computadoras e impresoras.', 'wifi', 10, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('dbae58b2-2e7e-45fb-a34a-e73c058c50ca', 'mantenimiento', 'Mantenimiento general', 'Arreglos varios: colgar, ajustar, instalar y reparar.', 'wrench', 11, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('fa94a4ad-130b-49fd-ae60-9e1652a902dc', 'otro', 'Otro problema / no sé qué profesional necesito', 'Describilo con tus palabras: una persona del equipo lo revisa y lo deriva.', 'circle-help', 12, true, true, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.credential_types (id, code, name, description, expires) VALUES ('75e38792-3ad0-4143-bb11-fd1a67cf70f3', 'matricula_gasista', 'Matrícula de gasista', 'Matrícula vigente habilitante para trabajos en instalaciones de gas.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.credential_types (id, code, name, description, expires) VALUES ('59668aa8-042e-408f-a052-9ce4584c7bbd', 'matricula_electricista', 'Matrícula de electricista', 'Matrícula o habilitación vigente como instalador electricista.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.credential_types (id, code, name, description, expires) VALUES ('0ea0346f-984e-46b6-8910-08c4531625df', 'seguro_ap', 'Seguro de accidentes personales', 'Póliza vigente de accidentes personales o ART.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.category_required_credentials (category_id, credential_type_id) VALUES ('4cfcf278-2d69-4e5e-9464-c0ee96585de7', '75e38792-3ad0-4143-bb11-fd1a67cf70f3') ON CONFLICT DO NOTHING;
INSERT INTO public.commission_rules (id, category_id, provider_rate_bps, client_rate_bps, client_fee_tax_bps, active, created_by, created_at) VALUES ('904a0ee2-b92c-4082-a094-ebe2d6966517', NULL, 1000, 500, 0, true, NULL, '2026-10-08 23:44:37.25984+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.publish_delay_hours', '[48, 72, 168]', NULL, '2026-10-08 23:44:36.716733+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.publish_jitter_hours', '12', NULL, '2026-10-08 23:44:36.716733+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.reminder_days', '[1, 3, 7]', NULL, '2026-10-08 23:44:36.716733+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.dispute_window_days', '30', NULL, '2026-10-08 23:44:36.7248+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.dispute_client_days', '5', NULL, '2026-10-08 23:44:36.7248+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.dispute_max_ai_rounds', '2', NULL, '2026-10-08 23:44:36.7248+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('booking.respond_hours', '4', NULL, '2026-10-08 23:44:36.741752+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('booking.respond_hours_urgent', '2', NULL, '2026-10-08 23:44:36.741752+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('matching.invite_limit', '4', NULL, '2026-10-08 23:44:37.260421+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('coverage.regions', '["CABA", "GBA_NORTE", "GBA_OESTE", "GBA_SUR"]', NULL, '2026-10-08 23:44:37.261372+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('quotes.default_valid_days', '7', NULL, '2026-10-08 23:44:37.261689+00') ON CONFLICT DO NOTHING;
INSERT INTO public.policy_documents (id, kind, version, title, is_draft, published_at) VALUES ('e3980d80-21e9-48ec-951a-c548ab232f72', 'terms', '0.1-borrador', 'Términos y condiciones (borrador)', true, '2026-10-08 23:44:37.261986+00') ON CONFLICT DO NOTHING;
INSERT INTO public.policy_documents (id, kind, version, title, is_draft, published_at) VALUES ('5aa2ba45-94fc-4169-98fa-7d4ba43f84a7', 'privacy', '0.1-borrador', 'Política de privacidad (borrador)', true, '2026-10-08 23:44:37.262724+00') ON CONFLICT DO NOTHING;
INSERT INTO public.policy_documents (id, kind, version, title, is_draft, published_at) VALUES ('1292035a-2b12-4904-99f9-68b976537b7e', 'provider_terms', '0.1-borrador', 'Condiciones para proveedores (borrador)', true, '2026-10-08 23:44:37.263014+00') ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('b319402c-19e8-494a-9bfb-f729d5db7913', 'c6fa884a-d418-499b-8913-b2ed017d09f3', 'afecta_toda_casa', '¿Afecta a todo el lugar o a un sector?', 'select', '["Todo el lugar", "Un ambiente o sector", "Un solo enchufe o luz", "No sé"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('aa4d10d1-8af6-4aa1-8e06-3cab503236bc', 'c6fa884a-d418-499b-8913-b2ed017d09f3', 'salta_termica', '¿Salta la térmica o el disyuntor?', 'select', '["Sí", "No", "No sé"]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('11772bdc-69bd-4676-877d-d0557db4970c', '70120849-f4f3-407a-ba86-e916a9d939bd', 'hay_perdida_activa', '¿Hay una pérdida de agua activa ahora?', 'select', '["Sí, constante", "Gotea", "No"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('d16b5c3c-3006-4083-803b-fea04056af68', '70120849-f4f3-407a-ba86-e916a9d939bd', 'pudo_cerrar_llave', '¿Pudiste cerrar la llave de paso?', 'select', '["Sí", "No", "No sé dónde está"]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('872b4a40-0fcc-4122-91b7-545eb5313a70', '4cfcf278-2d69-4e5e-9464-c0ee96585de7', 'artefacto', '¿Qué artefacto es?', 'select', '["Calefón", "Termotanque", "Estufa", "Cocina / horno", "Caldera", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('8b4608f4-a4db-4d74-a1ae-92864d95938d', '4cfcf278-2d69-4e5e-9464-c0ee96585de7', 'olor_gas', '¿Sentís olor a gas?', 'select', '["Sí", "No"]', true, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('372f2b7b-02f5-4891-8e81-bd79f7fd2070', 'a7f6c419-b86e-4954-b994-e0ac30989a60', 'tipo_equipo', 'Tipo de equipo', 'select', '["Split", "Ventana", "Portátil", "Central", "No sé"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('9873e1f0-17a4-44bb-8335-da21be16565d', 'a7f6c419-b86e-4954-b994-e0ac30989a60', 'frigorias', 'Frigorías aproximadas (si las sabés)', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('4af8f00f-91ef-4ef4-aaa2-e5a643d057c2', 'a7f6c419-b86e-4954-b994-e0ac30989a60', 'necesita_instalacion', '¿Es una instalación nueva?', 'boolean', '[]', false, 2) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('d739fe1f-e533-4667-b28d-5e4224ee9f70', '589e17ca-73f6-45ee-bfb2-e647cf5e0169', 'equipo', '¿Qué equipo es?', 'text', '[]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('e3c65efa-cfb0-4d40-9b3e-c90b3f79ee53', '589e17ca-73f6-45ee-bfb2-e647cf5e0169', 'marca_modelo', 'Marca y modelo (si los tenés)', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('0f3b7c50-7767-4965-ab38-6a8068097bf5', '589e17ca-73f6-45ee-bfb2-e647cf5e0169', 'en_garantia', '¿Está en garantía de fábrica?', 'select', '["Sí", "No", "No sé"]', false, 2) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('5d7a0097-11dd-468c-8f0a-53fe6db624c8', '8d3cdafd-86ab-4dfc-a6e6-c7b5e1ddbb61', 'situacion', '¿Cuál es la situación?', 'select', '["Me quedé afuera", "Cambio de cerradura", "Cambio de combinación", "Cerradura trabada", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('ba89e029-817a-464e-8afd-55c113aef5e8', '177f8bac-25b2-49fd-9d32-8e0faa14924f', 'superficie', 'Superficie aproximada (m² o ambientes)', 'text', '[]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('cb73d33b-ecbd-4c80-a7c6-a27c1ea05a97', '177f8bac-25b2-49fd-9d32-8e0faa14924f', 'incluye_materiales', '¿Querés que el profesional provea la pintura?', 'boolean', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('a45ec4e1-325f-4e4e-9ef3-b133967f141d', 'bf91f935-56bc-4451-ae83-a59aa2bd3692', 'tipo_trabajo', '¿Qué tipo de trabajo es?', 'select', '["Reparación", "Humedad", "Revestimiento", "Pequeña obra", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('aff97a9b-72a9-42c7-9174-9ec383ecbffa', 'f5306542-dae3-40a9-966f-a1b50f98cf04', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Reparar", "Armar", "Fabricar a medida", "Ajustar puertas"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('c9059cd1-8705-4212-9270-6c1523e6bb7d', '49d2e2f6-1c41-4c8c-8bb0-d5b39b43a913', 'tipo_limpieza', 'Tipo de limpieza', 'select', '["General profunda", "Final de obra", "Oficina", "Vidrios"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('76d827d3-dd9f-413c-a658-c15b3615d554', '49d2e2f6-1c41-4c8c-8bb0-d5b39b43a913', 'superficie', 'Superficie o ambientes', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('333e865a-bfc8-4e01-ba96-7bc3e1e3cc39', '1a869859-24b0-442f-ac09-883068c3f057', 'equipos', '¿Cuántos equipos o puestos involucra?', 'text', '[]', false, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('07a1d72b-40a6-462d-a74f-5a0c2ab91729', 'dbae58b2-2e7e-45fb-a34a-e73c058c50ca', 'lista', 'Contanos la lista de tareas', 'text', '[]', false, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('acfe65be-c6f2-4a71-af20-74922daf5051', 'c6fa884a-d418-499b-8913-b2ed017d09f3', 'instalacion-luminaria', 'Instalación de luminaria (hasta 1 punto)', '', 'fixed', 2800000, NULL, 'ARS', 'Instalación de una luminaria en un punto existente, con prueba de funcionamiento.', 'No incluye la luminaria ni tendido de cables nuevos.', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('3bf80b88-33ff-471c-a0be-d09c03604c4a', 'c6fa884a-d418-499b-8913-b2ed017d09f3', 'cambio-tomacorriente', 'Cambio de tomacorriente o llave', '', 'fixed', 1900000, NULL, 'ARS', 'Reemplazo de un tomacorriente o llave de luz existente.', 'No incluye materiales ni reparación de cableado.', true, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('f2ed9be5-f063-4012-9855-c03d5453b431', '70120849-f4f3-407a-ba86-e916a9d939bd', 'destapacion-pileta', 'Destapación simple de pileta o bacha', '', 'fixed', 3500000, NULL, 'ARS', 'Destapación manual de pileta de cocina o bacha de baño.', 'No incluye destapación de cloacas ni rotura de cañerías.', true, 2) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('a858cbd9-5444-4bc3-bede-cac9f04cb745', '8d3cdafd-86ab-4dfc-a6e6-c7b5e1ddbb61', 'cambio-cerradura', 'Cambio de cerradura (mano de obra)', '', 'fixed', 3000000, NULL, 'ARS', 'Reemplazo de cerradura de puerta interior o exterior estándar.', 'No incluye la cerradura nueva.', true, 3) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('01b9fafa-30bc-4217-a59a-46d8e973d8ef', '589e17ca-73f6-45ee-bfb2-e647cf5e0169', 'diagnostico-electrodomesticos', 'Visita de diagnóstico de electrodoméstico', '', 'diagnostic', NULL, 1800000, 'ARS', 'Revisión del equipo y presupuesto de reparación.', 'La reparación se cotiza aparte después de la visita.', true, 4) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('d67cf93b-7d09-4b3f-bc8d-74742f2faefd', 'a7f6c419-b86e-4954-b994-e0ac30989a60', 'diagnostico-aire', 'Visita de diagnóstico de aire acondicionado', '', 'diagnostic', NULL, 2000000, 'ARS', 'Revisión del equipo y presupuesto de reparación o carga.', 'La reparación se cotiza aparte después de la visita.', true, 5) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('bff9b8bc-691b-416c-997e-f50232a8e9bf', '70120849-f4f3-407a-ba86-e916a9d939bd', 'reparacion-perdida', 'Reparación de pérdida', '', 'quote', NULL, NULL, 'ARS', '', '', true, 6) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('393b3647-7502-47cd-bf61-02dc55cb8e1a', '177f8bac-25b2-49fd-9d32-8e0faa14924f', 'pintura-ambiente', 'Pintura de ambientes', '', 'quote', NULL, NULL, 'ARS', '', '', true, 7) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('17150633-f317-44c4-82f3-4b54d2b64248', 'caba-palermo', 'Palermo', 'CABA', true, 0, '{palermo,colegiales,chacarita,"villa crespo"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('7270ae38-24dd-4ddf-b676-a23aa1087f5c', 'caba-belgrano', 'Belgrano / Núñez', 'CABA', true, 1, '{belgrano,nunez,coghlan}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('55131df3-6de3-4ff2-8b86-c77449794065', 'caba-recoleta', 'Recoleta / Retiro', 'CABA', true, 2, '{recoleta,retiro}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('98fecf2b-42d2-4d0b-aa8a-4a7cde2e5241', 'caba-centro', 'Microcentro / San Nicolás', 'CABA', true, 3, '{"san nicolas",monserrat,montserrat,balvanera,"puerto madero","san cristobal"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('6ed6906c-a2d4-4c26-8bc3-e6afb4c6aeec', 'caba-caballito', 'Caballito / Almagro', 'CABA', true, 4, '{caballito,almagro,boedo,"parque chacabuco"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('3806b4a3-76e3-4f98-bf61-3da123f67e36', 'caba-urquiza', 'Villa Urquiza / Saavedra', 'CABA', true, 5, '{"villa urquiza",saavedra,"villa pueyrredon","villa ortuzar","parque chas",agronomia,"villa devoto","villa del parque","villa general mitre","villa santa rita","la paternal",paternal}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('345a7ee9-f202-4d37-930d-66f5fe05350e', 'caba-flores', 'Flores / Floresta', 'CABA', true, 6, '{flores,floresta,"velez sarsfield","villa luro",liniers,mataderos,"parque avellaneda","villa real","monte castro",versalles,"villa lugano","villa riachuelo","villa soldati"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('c1aa4fae-b13f-40d3-acc9-a8c2db590de6', 'caba-sur', 'San Telmo / Barracas / La Boca', 'CABA', true, 7, '{"san telmo",barracas,"la boca",boca,constitucion,"parque patricios","nueva pompeya"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('31aadc8c-667e-4a98-8308-70e35865aad5', 'gba-vicente-lopez', 'Vicente López', 'GBA_NORTE', true, 8, '{"vicente lopez",olivos,florida,"florida oeste",munro,"la lucila","villa martelli",carapachay,"villa adelina"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('ced1e121-91fd-4d47-ada5-7e17bce741f6', 'gba-san-isidro', 'San Isidro', 'GBA_NORTE', true, 9, '{"san isidro",martinez,acassuso,beccar,boulogne,"boulogne sur mer","villa adelina"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('1349c5ca-d441-4a30-945d-db67c6091940', 'gba-tigre', 'Tigre', 'GBA_NORTE', true, 10, '{tigre,"don torcuato","general pacheco",benavidez,nordelta,"el talar","rincon de milberg","troncos del talar"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('b6180d88-1610-4bce-ae87-bb3417cdc25e', 'gba-moron', 'Morón', 'GBA_OESTE', true, 11, '{moron,castelar,haedo,"el palomar","villa sarmiento"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('66d31dc2-a872-4e1b-91c8-11a2515a984a', 'gba-la-matanza', 'La Matanza', 'GBA_OESTE', true, 12, '{"la matanza","san justo","ramos mejia","isidro casanova","gonzalez catan","lomas del mirador","villa luzuriaga",tapiales,"la tablada","gregorio de laferrere","ciudad evita","rafael castillo"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('93cdb6c9-74b2-4002-8af0-b3707a3c864c', 'gba-avellaneda', 'Avellaneda', 'GBA_SUR', true, 13, '{avellaneda,wilde,sarandi,"dock sud","villa dominico",gerli,pineyro}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('c54af475-6ab2-4c12-9801-d7efeb2cee48', 'gba-lanus', 'Lanús', 'GBA_SUR', true, 14, '{lanus,"remedios de escalada","monte chingolo","valentin alsina",gerli}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('74ae4d49-258f-4fcc-a62b-4a48fabbcd0b', 'gba-lomas', 'Lomas de Zamora', 'GBA_SUR', true, 15, '{"lomas de zamora",banfield,temperley,turdera,llavallol,"villa fiorito","ingeniero budge"}') ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names) VALUES ('7fdcb354-d57c-452e-aae6-ec612644a83a', 'gba-quilmes', 'Quilmes', 'GBA_SUR', true, 16, '{quilmes,bernal,ezpeleta,"don bosco","san francisco solano"}') ON CONFLICT DO NOTHING;
COMMIT;
SELECT (SELECT count(*) FROM categories) AS categorias, (SELECT count(*) FROM zones) AS zonas, (SELECT count(*) FROM schema_migrations) AS migraciones;
