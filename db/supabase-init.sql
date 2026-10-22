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

-- ===== 0016_withdrawals.sql =====
-- Profesionales: 0% de comisión, balance acumulado y retiros mensuales.
--  * Fixy no cobra comisión a los profesionales: solo el cargo de servicio al cliente. Queda garantizado por la base.
--  * Lo ganado en cada trabajo (liquidación) se acumula como saldo cuando el trabajo está completado, con reseña y sin reclamos.
--  * Una vez por mes calendario (hora de Buenos Aires) el profesional pide retirar todo su saldo; se transfiere a los 20 días
--    a la cuenta bancaria que cargó. La transferencia la registra la operación con su referencia.

-- 1) Cero comisión a profesionales (las cotizaciones ya emitidas guardan su propia tasa).
UPDATE commission_rules SET provider_rate_bps = 0;
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_provider_zero CHECK (provider_rate_bps = 0);

-- 2) Datos bancarios (privados: solo administradores del perfil y la operación).
CREATE TABLE provider_bank_accounts (
  provider_id   uuid PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  holder_name   text NOT NULL CHECK (length(holder_name) BETWEEN 2 AND 160),
  holder_tax_id text NOT NULL CHECK (holder_tax_id ~ '^\d{11}$'),
  cbu           text CHECK (cbu IS NULL OR cbu ~ '^\d{22}$'),
  alias         text CHECK (alias IS NULL OR alias ~ '^[A-Za-z0-9.-]{6,20}$'),
  bank_name     text CHECK (bank_name IS NULL OR length(bank_name) <= 80),
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (cbu IS NOT NULL OR alias IS NOT NULL)
);
ALTER TABLE provider_bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_bank_accounts_access ON provider_bank_accounts FOR SELECT TO fixy_app
  USING (app.can_see_provider_finance(app.uid(), provider_id));
GRANT SELECT ON provider_bank_accounts TO fixy_app;

-- 3) Retiros.
CREATE TABLE withdrawals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    uuid NOT NULL REFERENCES providers(id),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  status         text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','paid','rejected')),
  period         text NOT NULL CHECK (period ~ '^\d{4}-\d{2}$'),     -- mes calendario del pedido (AR)
  scheduled_for  date NOT NULL,                                        -- pedido + 20 días
  bank_snapshot  jsonb NOT NULL,                                       -- cuenta destino al momento del pedido
  is_test        boolean NOT NULL,
  requested_by   uuid NOT NULL REFERENCES users(id),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  processed_by   uuid REFERENCES users(id),
  paid_at        timestamptz,
  external_ref   text,
  reject_reason  text,
  CHECK (status <> 'paid' OR (paid_at IS NOT NULL AND external_ref IS NOT NULL)),
  CHECK (status <> 'rejected' OR reject_reason IS NOT NULL)
);
-- Un retiro por mes (uno rechazado no cuenta).
CREATE UNIQUE INDEX withdrawals_one_per_month ON withdrawals (provider_id, period) WHERE status <> 'rejected';
CREATE INDEX withdrawals_status_idx ON withdrawals (status, scheduled_for);

INSERT INTO app.allowed_transitions (entity, from_state, to_state) VALUES
  ('withdrawal','requested','paid'), ('withdrawal','requested','rejected');
CREATE TRIGGER withdrawals_transition BEFORE UPDATE OF status ON withdrawals
  FOR EACH ROW EXECUTE FUNCTION app.check_transition('withdrawal');

ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY withdrawals_access ON withdrawals FOR SELECT TO fixy_app
  USING (app.can_see_provider_finance(app.uid(), provider_id));
GRANT SELECT ON withdrawals TO fixy_app;

ALTER TABLE payouts ADD COLUMN withdrawal_id uuid REFERENCES withdrawals(id);
CREATE INDEX payouts_withdrawal_idx ON payouts (withdrawal_id);

INSERT INTO platform_settings (key, value) VALUES ('withdrawals.delay_days', '20'::jsonb) ON CONFLICT (key) DO NOTHING;

ALTER TABLE entity_events DROP CONSTRAINT entity_events_entity_type_check;
ALTER TABLE entity_events ADD CONSTRAINT entity_events_entity_type_check
  CHECK (entity_type IN ('request','quote','job','charge','payout','dispute','provider','refund','withdrawal'));

INSERT INTO schema_migrations (name) VALUES ('0016_withdrawals.sql');

-- ===== 0017_legal_v1.sql =====
-- Documentos legales vigentes (v1.0, ya no borradores) y pedidos de arrepentimiento (Res. 424/2020).
INSERT INTO policy_documents (kind, version, title, is_draft, published_at) VALUES
  ('terms', '1.0', 'Términos y condiciones', false, now()),
  ('privacy', '1.0', 'Política de privacidad', false, now()),
  ('provider_terms', '1.0', 'Condiciones para profesionales', false, now())
ON CONFLICT (kind, version) DO NOTHING;

CREATE SEQUENCE revocation_code_seq START 1001;
CREATE TABLE revocation_requests (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE DEFAULT ('ARR-' || nextval('revocation_code_seq')),
  user_id     uuid REFERENCES users(id),
  full_name   text NOT NULL CHECK (length(full_name) BETWEEN 2 AND 160),
  email       text NOT NULL CHECK (length(email) BETWEEN 5 AND 200),
  reference   text CHECK (reference IS NULL OR length(reference) <= 120),
  details     text CHECK (details IS NULL OR length(details) <= 2000),
  status      text NOT NULL DEFAULT 'received' CHECK (status IN ('received','resolved')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  resolution  text
);
ALTER TABLE revocation_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY revocation_requests_access ON revocation_requests FOR SELECT TO fixy_app
  USING (user_id = app.uid() OR app.is_staff(app.uid()));
GRANT SELECT ON revocation_requests TO fixy_app;

INSERT INTO schema_migrations (name) VALUES ('0017_legal_v1.sql');

-- ===== 0018_other_zone.sql =====
-- Nunca rechazar un pedido por ubicación: las direcciones fuera de las zonas de cobertura van a "Otra zona".
-- Esos pedidos quedan sin profesionales elegibles (estado no_coverage) y los revisa el equipo a mano.
ALTER TABLE zones DROP CONSTRAINT zones_region_check;
ALTER TABLE zones ADD CONSTRAINT zones_region_check CHECK (region IN ('CABA','GBA_NORTE','GBA_OESTE','GBA_SUR','OTRA'));
INSERT INTO zones (code, name, region, active, sort) VALUES ('otra-zona', 'Otra zona', 'OTRA', true, 999)
ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0018_other_zone.sql');

-- ===== 0019_gba_norte_zones.sql =====
-- Nuevas zonas de GBA Norte (Escobar, Pilar, San Fernando) y más localidades para Tigre / Nordelta.
-- Mismo orden que src/server/seed/base.ts; los nombres de localidades replican src/lib/zone-match.ts.
INSERT INTO zones (code, name, region, sort, match_names) VALUES ('gba-san-fernando', 'San Fernando', 'GBA_NORTE', 0, ARRAY['san fernando','victoria','virreyes','islas san fernando'])
  ON CONFLICT (code) DO UPDATE SET name = excluded.name, match_names = excluded.match_names;
INSERT INTO zones (code, name, region, sort, match_names) VALUES ('gba-tigre', 'Tigre / Nordelta', 'GBA_NORTE', 0, ARRAY['tigre','don torcuato','general pacheco','benavidez','nordelta','el talar','rincon de milberg','troncos del talar','ricardo rojas','dique lujan','villa la nueva'])
  ON CONFLICT (code) DO UPDATE SET name = excluded.name, match_names = excluded.match_names;
INSERT INTO zones (code, name, region, sort, match_names) VALUES ('gba-escobar', 'Escobar', 'GBA_NORTE', 0, ARRAY['escobar','belen escobar','ingeniero maschwitz','maschwitz','garin','matheu','maquinista savio','loma verde','puertos'])
  ON CONFLICT (code) DO UPDATE SET name = excluded.name, match_names = excluded.match_names;
INSERT INTO zones (code, name, region, sort, match_names) VALUES ('gba-pilar', 'Pilar', 'GBA_NORTE', 0, ARRAY['pilar','del viso','presidente derqui','villa rosa','manzanares','fatima','la lonja','manuel alberti','villa astolfi','lagomarsino','zelaya','pilar centro'])
  ON CONFLICT (code) DO UPDATE SET name = excluded.name, match_names = excluded.match_names;
UPDATE zones SET sort = v.sort FROM (VALUES ('caba-palermo', 0), ('caba-belgrano', 1), ('caba-recoleta', 2), ('caba-centro', 3), ('caba-caballito', 4), ('caba-urquiza', 5), ('caba-flores', 6), ('caba-sur', 7), ('gba-vicente-lopez', 8), ('gba-san-isidro', 9), ('gba-san-fernando', 10), ('gba-tigre', 11), ('gba-escobar', 12), ('gba-pilar', 13), ('gba-moron', 14), ('gba-la-matanza', 15), ('gba-avellaneda', 16), ('gba-lanus', 17), ('gba-lomas', 18), ('gba-quilmes', 19)) AS v(code, sort) WHERE zones.code = v.code;

INSERT INTO schema_migrations (name) VALUES ('0019_gba_norte_zones.sql');

-- ===== 0020_whatsapp.sql =====
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

INSERT INTO schema_migrations (name) VALUES ('0020_whatsapp.sql');

-- ===== 0021_whatsapp_media_notices.sql =====
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

INSERT INTO schema_migrations (name) VALUES ('0021_whatsapp_media_notices.sql');

-- ===== 0022_admin_team.sql =====
-- Equipo del panel de administración: invitaciones y permisos por sección.
--  admin    → dueño/administración total (incluye gestionar el equipo).
--  operator → operación (permisos predefinidos en el código).
--  team     → permisos a medida por sección (admin_permissions): 'view' (solo ve) o 'manage' (ve y gestiona).
-- La lectura de datos (RLS) es la misma para todo el equipo; qué secciones y acciones ve cada uno lo controla el servidor.

ALTER TABLE users DROP CONSTRAINT users_platform_role_check;
ALTER TABLE users ADD CONSTRAINT users_platform_role_check CHECK (platform_role IN ('operator','admin','team'));

CREATE OR REPLACE FUNCTION app.is_staff(u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = u AND platform_role IN ('operator','admin','team') AND disabled_at IS NULL)
$$;

CREATE TABLE admin_permissions (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section    text NOT NULL CHECK (section ~ '^[a-z_]{2,32}$'),
  level      text NOT NULL CHECK (level IN ('view','manage')),
  granted_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, section)
);
ALTER TABLE admin_permissions ENABLE ROW LEVEL SECURITY;

CREATE TABLE admin_invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash  text NOT NULL UNIQUE,
  email       text NOT NULL CHECK (length(email) BETWEEN 5 AND 200),
  label       text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),   -- "Socio", "Operación", "Personalizado"
  permissions jsonb NOT NULL,                                          -- {"socios":"view",...} o {"role":"operator"}
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid REFERENCES users(id),
  revoked_at  timestamptz
);
ALTER TABLE admin_invitations ENABLE ROW LEVEL SECURITY;

-- Canal por el que llegó cada pedido (para el panel de socios).
ALTER TABLE service_requests ADD COLUMN channel text NOT NULL DEFAULT 'web' CHECK (channel IN ('web','whatsapp'));

INSERT INTO schema_migrations (name) VALUES ('0022_admin_team.sql');

-- ===== 0023_provider_avatar.sql =====
-- Foto de perfil de profesionales (pública: genera confianza al elegir).
ALTER TABLE files DROP CONSTRAINT files_purpose_check;
ALTER TABLE files ADD CONSTRAINT files_purpose_check CHECK (purpose IN ('provider_document','portfolio','request_photo','job_evidence','message_attachment','dispute_evidence','property_document','provider_avatar'));

ALTER TABLE providers ADD COLUMN avatar_file_id uuid REFERENCES files(id);

-- Vista pública: se agrega la foto al final (CREATE OR REPLACE solo permite sumar columnas al final).
CREATE OR REPLACE VIEW provider_public AS
  SELECT id, slug, kind, display_name, description, years_experience, base_zone_id, status,
         identity_status, accepting_jobs, is_demo, created_at, approved_at, avatar_file_id
  FROM providers;

INSERT INTO schema_migrations (name) VALUES ('0023_provider_avatar.sql');

-- ===== 0024_google_login.sql =====
-- Ingreso con Google (OpenID Connect). Las cuentas creadas con Google pueden no tener contraseña.
ALTER TABLE users ADD COLUMN google_sub text CHECK (google_sub IS NULL OR length(google_sub) <= 255);
CREATE UNIQUE INDEX users_google_sub_key ON users (google_sub) WHERE google_sub IS NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

INSERT INTO schema_migrations (name) VALUES ('0024_google_login.sql');

-- ===== 0025_invite_unverified.sql =====
-- Los clientes pueden pedirle trabajo a profesionales que todavía no se verificaron (alta en curso o en revisión):
-- reciben la invitación, pero deben verificarse para aceptarla. Un TRABAJO sigue exigiendo profesional aprobado
-- (trigger jobs_provider_active). Rechazados y suspendidos no reciben invitaciones.
CREATE FUNCTION app.check_invitation_provider() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM providers WHERE id = NEW.provider_id;
  IF st IS NULL OR st NOT IN ('pending','in_review','approved') THEN
    RAISE EXCEPTION 'provider_not_eligible: estado %', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER invitations_provider_active ON request_invitations;
CREATE TRIGGER invitations_provider_active BEFORE INSERT ON request_invitations
  FOR EACH ROW EXECUTE FUNCTION app.check_invitation_provider();

INSERT INTO platform_settings (key, value) VALUES ('booking.respond_hours_unverified', '48'::jsonb) ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0025_invite_unverified.sql');

-- ===== 0026_referrals_and_fees.sql =====
-- Nuevos números del negocio y recomendación entre colegas.
--  * Cliente: cargo de servicio del 10 %.
--  * Profesional: 0 % de comisión de Fixy; cobra el neto de los costos de cobro de Mercado Pago e impuestos del pago
--    (charges.gateway_fee_minor), que se descuentan de su liquidación (payouts.processing_minor).
--  * Recomendación: si un profesional no puede tomar un pedido, recomienda a un colega; si el cliente acepta y el colega
--    hace el trabajo, quien recomendó recibe el 10 % del neto del colega (payouts.kind = 'referral').

-- 1) Cargo de servicio al cliente: 10 % (nueva regla vigente; la anterior queda en el historial).
UPDATE commission_rules SET active = false WHERE active AND category_id IS NULL;
INSERT INTO commission_rules (category_id, provider_rate_bps, client_rate_bps, client_fee_tax_bps, active)
  VALUES (NULL, 0, 1000, 0, true);

-- 2) Costos de cobro de la pasarela por pago (comisión de Mercado Pago + impuestos/retenciones).
ALTER TABLE charges ADD COLUMN gateway_fee_minor bigint NOT NULL DEFAULT 0 CHECK (gateway_fee_minor >= 0);

-- 3) Liquidaciones: una por trabajo y tipo (la del profesional y, si hubo recomendación, la de quien recomendó).
ALTER TABLE payouts ADD COLUMN kind text NOT NULL DEFAULT 'job' CHECK (kind IN ('job','referral'));
ALTER TABLE payouts ADD COLUMN processing_minor bigint NOT NULL DEFAULT 0 CHECK (processing_minor >= 0);
ALTER TABLE payouts ADD COLUMN referral_minor bigint NOT NULL DEFAULT 0 CHECK (referral_minor >= 0);
ALTER TABLE payouts DROP CONSTRAINT payouts_job_id_key;
CREATE UNIQUE INDEX payouts_job_kind_key ON payouts (job_id, kind);

-- 4) Recomendaciones entre colegas.
CREATE TABLE provider_referrals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  from_provider_id uuid NOT NULL REFERENCES providers(id),
  to_provider_id   uuid NOT NULL REFERENCES providers(id),
  note             text CHECK (note IS NULL OR length(note) <= 500),
  fee_bps          integer NOT NULL DEFAULT 1000 CHECK (fee_bps BETWEEN 0 AND 5000),
  status           text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','declined')),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  CHECK (from_provider_id <> to_provider_id),
  UNIQUE (request_id, from_provider_id)
);
CREATE INDEX provider_referrals_to_idx ON provider_referrals (to_provider_id);
ALTER TABLE request_invitations ADD COLUMN referral_id uuid REFERENCES provider_referrals(id);

ALTER TABLE provider_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY provider_referrals_access ON provider_referrals FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid()) OR app.is_request_client(app.uid(), request_id)
    OR app.provider_role(app.uid(), from_provider_id) = 'admin' OR app.provider_role(app.uid(), to_provider_id) = 'admin');
GRANT SELECT ON provider_referrals TO fixy_app;

INSERT INTO platform_settings (key, value) VALUES ('referrals.fee_bps', '1000'::jsonb) ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0026_referrals_and_fees.sql');

-- ===== 0027_legal_v1_1.sql =====
-- Términos 1.1: el profesional cobra el neto (costos de procesamiento del pago e impuestos) y recomendación entre colegas (10 %).
INSERT INTO policy_documents (kind, version, title, is_draft, published_at) VALUES
  ('terms', '1.1', 'Términos y condiciones', false, now()),
  ('provider_terms', '1.1', 'Condiciones para profesionales', false, now())
ON CONFLICT (kind, version) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0027_legal_v1_1.sql');

-- ===== 0028_tenant_hardening.sql =====
-- Revisión de seguridad (aislamiento entre clientes, organizaciones y profesionales).

-- 1) Quien deja una organización pierde el acceso a sus pedidos: crear o ser responsable
--    de un pedido de la organización solo cuenta mientras siga siendo miembro.
CREATE OR REPLACE FUNCTION app.is_request_client(u uuid, req uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM service_requests r
    WHERE r.id = req AND (
      (r.organization_id IS NULL AND (r.created_by = u OR r.responsible_user_id = u))
      OR (r.organization_id IS NOT NULL AND (
        app.org_role(u, r.organization_id) = 'admin'
        OR (app.org_role(u, r.organization_id) IS NOT NULL AND (r.created_by = u OR r.responsible_user_id = u))
      ))
    )
  )
$$;

-- 2) Las notas del cliente sobre el ingreso al barrio ("avisame 24 h antes") las ve el profesional invitado,
--    salvo que nombren el barrio o la calle: esas, recién cuando se le revela la dirección (visita confirmada).
CREATE OR REPLACE FUNCTION app.mentions_place(notes text, gated_name text, address_line text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (length(trim(coalesce(gated_name, ''))) >= 3 AND position(lower(trim(gated_name)) IN lower(notes)) > 0)
      OR (length(trim(split_part(coalesce(address_line, ''), ',', 1))) >= 4
          AND position(lower(regexp_replace(trim(split_part(address_line, ',', 1)), '\s*\d+\s*$', '')) IN lower(notes)) > 0)
$$;

CREATE OR REPLACE VIEW request_access_requirements AS
  SELECT r.id AS request_id, p.gated_community, p.gated_requirements,
         CASE WHEN app.is_staff(app.uid()) OR app.is_request_client(app.uid(), r.id) OR app.is_revealed_provider(app.uid(), r.id)
                   OR NOT app.mentions_place(coalesce(p.gated_client_notes, ''), p.gated_name, p.address_line)
              THEN p.gated_client_notes END AS gated_client_notes,
         p.gated_requirements_updated_at
  FROM service_requests r JOIN properties p ON p.id = r.property_id
  WHERE p.gated_community AND app.can_see_request(app.uid(), r.id);

-- 3) El historial de un pedido (quién fue invitado, quién rechazó, recomendaciones) es del cliente y de la operación,
--    no de los profesionales invitados que compiten por el trabajo.
DROP POLICY IF EXISTS entity_events_access ON entity_events;
-- 4) Reseñas anónimas: el profesional no ve cuándo calificó el cliente (anularía la demora aleatoria de publicación).
CREATE POLICY entity_events_access ON entity_events FOR SELECT TO fixy_app
  USING (app.is_staff(app.uid())
         OR (entity_type = 'request' AND app.is_request_client(app.uid(), entity_id))
         OR (entity_type = 'job' AND app.is_job_client(app.uid(), entity_id))
         OR (entity_type = 'job' AND action <> 'review_submitted' AND app.is_job_provider(app.uid(), entity_id))
         OR (entity_type = 'provider' AND app.provider_role(app.uid(), entity_id) = 'admin'));

-- 5) Quien sale de una organización deja de ser responsable de sus pedidos.
CREATE OR REPLACE FUNCTION app.clear_responsible_on_member_removed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE service_requests SET responsible_user_id = NULL
  WHERE organization_id = OLD.organization_id AND responsible_user_id = OLD.user_id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS organization_member_removed ON organization_members;
CREATE TRIGGER organization_member_removed AFTER DELETE ON organization_members
  FOR EACH ROW EXECUTE FUNCTION app.clear_responsible_on_member_removed();

INSERT INTO schema_migrations (name) VALUES ('0028_tenant_hardening.sql');

-- ===== 0029_recoveries_chargebacks.sql =====
-- Recuperos, contracargos y reembolsos hechos desde la pasarela.
--  * Si un reembolso o contracargo llega cuando la liquidación ya se pagó (o la deja en negativo), lo que el profesional
--    cobró de más queda como "recupero" y se descuenta de su próximo retiro.
--  * Los reembolsos pueden venir de la plataforma, de la pasarela (hechos desde el panel de Mercado Pago) o de un contracargo.

CREATE TABLE provider_recoveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES providers(id),
  job_id        uuid REFERENCES jobs(id),
  payout_kind   text NOT NULL DEFAULT 'job' CHECK (payout_kind IN ('job','referral')),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','settled','waived')),
  withdrawal_id uuid REFERENCES withdrawals(id),
  is_test       boolean NOT NULL DEFAULT false,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  settled_at    timestamptz
);
CREATE INDEX provider_recoveries_provider_idx ON provider_recoveries (provider_id, status);

ALTER TABLE provider_recoveries ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON provider_recoveries TO fixy_app;
CREATE POLICY provider_recoveries_access ON provider_recoveries FOR SELECT TO fixy_app
  USING (app.can_see_provider_finance(app.uid(), provider_id));

-- Reembolsos sin una persona detrás (contracargo, devolución hecha en la pasarela, pago duplicado devuelto).
ALTER TABLE refunds ALTER COLUMN requested_by DROP NOT NULL;
ALTER TABLE refunds ADD COLUMN source text NOT NULL DEFAULT 'platform' CHECK (source IN ('platform','gateway','chargeback'));

-- La pasarela simulada también puede informar mediaciones y contracargos (para probar el circuito).
ALTER TABLE mock_gateway_payments DROP CONSTRAINT IF EXISTS mock_gateway_payments_status_check;
ALTER TABLE mock_gateway_payments ADD CONSTRAINT mock_gateway_payments_status_check
  CHECK (status IN ('pending','approved','rejected','refunded','partially_refunded','in_mediation','charged_back'));

INSERT INTO schema_migrations (name) VALUES ('0029_recoveries_chargebacks.sql');

-- ===== 0030_budget_requests.sql =====
-- Pedido con presupuesto del cliente ("puja inversa"): el cliente dice cuánto quiere pagar por el trabajo,
-- los profesionales de la zona se anotan por ese precio u ofrecen menos, y el cliente elige.
ALTER TABLE service_requests DROP CONSTRAINT IF EXISTS service_requests_request_mode_check;
ALTER TABLE service_requests ADD CONSTRAINT service_requests_request_mode_check CHECK (request_mode IN ('direct','quotes','budget'));
ALTER TABLE service_requests ADD COLUMN budget_minor bigint CHECK (budget_minor IS NULL OR budget_minor > 0);

-- Ofertas: la mejor oferta vigente (sin nombres) la ven los profesionales invitados para poder mejorarla.
CREATE OR REPLACE FUNCTION app.best_offer_minor(req uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN app.can_see_request(app.uid(), req)
    THEN (SELECT min(subtotal_minor) FROM quotes WHERE request_id = req AND status = 'sent') END
$$;
GRANT EXECUTE ON FUNCTION app.best_offer_minor(uuid) TO fixy_app;

INSERT INTO platform_settings (key, value) VALUES ('matching.budget_invite_limit', '15') ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0030_budget_requests.sql');

-- ===== 0031_provider_whatsapp_alerts.sql =====
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

INSERT INTO schema_migrations (name) VALUES ('0031_provider_whatsapp_alerts.sql');

-- ===== 0032_provider_social_and_files.sql =====
-- Redes sociales públicas del profesional (opcionales) y archivos en el portfolio (PDF: catálogos, trabajos).
ALTER TABLE providers ADD COLUMN social_links jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(social_links) = 'object');

CREATE OR REPLACE VIEW provider_public AS
  SELECT id, slug, kind, display_name, description, years_experience, base_zone_id, status,
         identity_status, accepting_jobs, is_demo, created_at, approved_at, avatar_file_id, social_links
  FROM providers;

INSERT INTO schema_migrations (name) VALUES ('0032_provider_social_and_files.sql');

-- ===== 0033_account_deletion.sql =====
-- Baja de cuenta autoservicio (Ley 25.326, App Store 5.1.1(v) y Google Play).
-- La cuenta se anonimiza: se borran datos personales y de contacto; se conservan, sin identificar a la persona,
-- los registros que la ley exige (pagos, facturación, registro financiero) y las reseñas ya publicadas (anónimas).
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE providers ADD COLUMN closed_at timestamptz;

-- Un perfil profesional se puede cerrar (suspender) desde cualquier estado cuando su titular da de baja la cuenta.
INSERT INTO app.allowed_transitions (entity, from_state, to_state) VALUES
  ('provider', 'pending', 'suspended'), ('provider', 'in_review', 'suspended'), ('provider', 'rejected', 'suspended')
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0033_account_deletion.sql');

-- ===== 0034_push_devices.sql =====
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

INSERT INTO schema_migrations (name) VALUES ('0034_push_devices.sql');

-- ===== 0035_store_review_sandbox.sql =====
-- Cuentas para la revisión de App Store y Google Play ("cajón de arena"): un cliente y un profesional de prueba
-- que solo se ven entre sí. Sus pedidos nunca llegan a profesionales reales y el profesional de prueba nunca
-- se le ofrece a un cliente real.
ALTER TABLE users ADD COLUMN sandbox boolean NOT NULL DEFAULT false;
ALTER TABLE providers ADD COLUMN sandbox boolean NOT NULL DEFAULT false;

INSERT INTO schema_migrations (name) VALUES ('0035_store_review_sandbox.sql');

-- ===== 0036_more_trades.sql =====
-- Rubros nuevos del catálogo (jardinería, piletas, fumigación, volquetes, obras, arquitectura, decoración y más).
-- Generado desde src/server/seed/base.ts. No pisa lo que ya exista: si un rubro fue editado desde Operación, queda como está.

INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('jardineria', 'Jardinería y paisajismo', 'Corte de césped, poda, mantenimiento, diseño de jardines y riego.', 'trees', 11, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Mantenimiento periódico","Corte de césped","Poda de árboles o cercos","Diseño o armado de jardín","Riego automático","Otro"]'::jsonb, true, 0 FROM categories WHERE slug = 'jardineria' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'superficie', 'Tamaño aproximado del jardín o cantidad de plantas', 'text', '[]'::jsonb, false, 1 FROM categories WHERE slug = 'jardineria' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('piletas', 'Piletas', 'Mantenimiento, limpieza, puesta a punto, bombas, filtros y pintura de piletas.', 'waves', 12, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Mantenimiento periódico","Puesta a punto de temporada","Recuperar agua verde","Bomba o filtro","Pintura o reparación","Construcción","Otro"]'::jsonb, true, 0 FROM categories WHERE slug = 'piletas' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'medidas', 'Medidas o litros aproximados (si los sabés)', 'text', '[]'::jsonb, false, 1 FROM categories WHERE slug = 'piletas' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('fumigacion', 'Fumigación y control de plagas', 'Cucarachas, roedores, mosquitos, hormigas y desinfección. También limpieza de tanques de agua.', 'bug', 13, false, 'Antes de una fumigación avisá si hay chicos, personas embarazadas, mascotas o peceras: el profesional te indica cuánto tiempo hay que ventilar.') ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'plaga', '¿Qué necesitás tratar?', 'select', '["Cucarachas","Roedores","Mosquitos","Hormigas","Chinches o pulgas","Murciélagos o palomas","Limpieza de tanque de agua","No sé"]'::jsonb, true, 0 FROM categories WHERE slug = 'fumigacion' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'certificado', '¿Necesitás certificado (consorcio, comercio u oficina)?', 'boolean', '[]'::jsonb, false, 1 FROM categories WHERE slug = 'fumigacion' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('volquetes', 'Volquetes y retiro de escombros', 'Alquiler de volquetes, retiro de escombros, muebles viejos, poda y residuos de obra.', 'truck', 14, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'que_retirar', '¿Qué hay que retirar?', 'select', '["Escombros de obra","Muebles o electrodomésticos","Restos de poda","Tierra","Varios"]'::jsonb, true, 0 FROM categories WHERE slug = 'volquetes' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'espacio_volquete', '¿Hay lugar en la calle o en la vereda para dejar un volquete?', 'select', '["Sí","No","No sé"]'::jsonb, false, 1 FROM categories WHERE slug = 'volquetes' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('mudanzas', 'Mudanzas y fletes', 'Mudanzas, fletes, traslado de muebles y embalaje.', 'package', 15, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo', '¿Qué necesitás?', 'select', '["Mudanza completa","Flete de pocos muebles","Solo embalaje","Guardamuebles"]'::jsonb, true, 0 FROM categories WHERE slug = 'mudanzas' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'destino', '¿A qué barrio o localidad va?', 'text', '[]'::jsonb, true, 1 FROM categories WHERE slug = 'mudanzas' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'ascensor', '¿Hay ascensor o hay que subir por escalera?', 'text', '[]'::jsonb, false, 2 FROM categories WHERE slug = 'mudanzas' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('reformas', 'Reformas y obras', 'Reformas de baño y cocina, ampliaciones, construcción y obras completas con un solo responsable.', 'hard-hat', 16, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_obra', '¿Qué tipo de obra es?', 'select', '["Reforma de baño","Reforma de cocina","Reforma integral","Ampliación","Construcción desde cero","Local u oficina","Otro"]'::jsonb, true, 0 FROM categories WHERE slug = 'reformas' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tiene_planos', '¿Tenés planos o proyecto?', 'select', '["Sí","No","Necesito que me lo armen"]'::jsonb, false, 1 FROM categories WHERE slug = 'reformas' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('arquitectura', 'Arquitectura e ingeniería', 'Proyectos, planos, dirección de obra, regularizaciones, habilitaciones e informes técnicos.', 'drafting-compass', 17, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'necesidad', '¿Qué necesitás?', 'select', '["Proyecto y planos","Dirección de obra","Regularizar o aprobar planos","Habilitación comercial","Informe técnico o cálculo estructural","Asesoramiento"]'::jsonb, true, 0 FROM categories WHERE slug = 'arquitectura' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'superficie', 'Superficie aproximada (m²)', 'text', '[]'::jsonb, false, 1 FROM categories WHERE slug = 'arquitectura' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('decoracion', 'Decoración e interiorismo', 'Diseño de interiores, asesoramiento, ambientación y elección de muebles y colores.', 'lamp', 18, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'alcance', '¿Qué estás buscando?', 'select', '["Asesoramiento por única vez","Proyecto de un ambiente","Proyecto de toda la casa","Local u oficina","Ambientación para vender o alquilar"]'::jsonb, true, 0 FROM categories WHERE slug = 'decoracion' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'ambientes', '¿Qué ambientes?', 'text', '[]'::jsonb, false, 1 FROM categories WHERE slug = 'decoracion' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('techos', 'Techos e impermeabilización', 'Goteras, filtraciones, membranas, zinguería, canaletas y tejas.', 'umbrella', 19, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_techo', '¿Qué tipo de techo es?', 'select', '["Losa o terraza","Chapa","Tejas","No sé"]'::jsonb, true, 0 FROM categories WHERE slug = 'techos' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'hay_filtracion', '¿Hay goteras o filtraciones ahora?', 'select', '["Sí","No, es preventivo"]'::jsonb, false, 1 FROM categories WHERE slug = 'techos' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('pisos', 'Pisos y revestimientos', 'Colocación de cerámicos y porcelanato, pisos flotantes y vinílicos, pulido y plastificado.', 'layout-grid', 20, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Colocar cerámicos o porcelanato","Piso flotante o vinílico","Pulido y plastificado de madera","Microcemento","Reparar piezas sueltas","Otro"]'::jsonb, true, 0 FROM categories WHERE slug = 'pisos' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'superficie', 'Superficie aproximada (m²)', 'text', '[]'::jsonb, false, 1 FROM categories WHERE slug = 'pisos' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('durlock', 'Durlock y construcción en seco', 'Tabiques, cielorrasos, revestimientos, muebles y aislaciones en placa de yeso.', 'layers', 21, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Dividir un ambiente","Cielorraso","Revestir una pared","Mueble o nicho","Reparación","Otro"]'::jsonb, true, 0 FROM categories WHERE slug = 'durlock' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('herreria', 'Herrería y portones', 'Rejas, portones, escaleras, estructuras, soldaduras y automatización de portones.', 'fence', 22, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Rejas","Portón nuevo","Automatizar o reparar un portón","Escalera o baranda","Estructura o techo","Soldadura o reparación"]'::jsonb, true, 0 FROM categories WHERE slug = 'herreria' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('vidrieria', 'Vidriería y aberturas', 'Vidrios, espejos, mamparas, ventanas y puertas de aluminio o PVC, y mosquiteros.', 'app-window', 23, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Reponer un vidrio roto","Espejo a medida","Mampara de baño","Ventana o puerta nueva","Reparar una abertura","Mosquiteros","Cerramiento"]'::jsonb, true, 0 FROM categories WHERE slug = 'vidrieria' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'medidas', 'Medidas aproximadas (si las tenés)', 'text', '[]'::jsonb, false, 1 FROM categories WHERE slug = 'vidrieria' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('marmoleria', 'Marmolería y mesadas', 'Mesadas de cocina y baño, granito, mármol, cuarzo y pulido.', 'gem', 24, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Mesada nueva","Cambiar o agrandar una mesada","Pulido o reparación","Otro"]'::jsonb, true, 0 FROM categories WHERE slug = 'marmoleria' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('seguridad', 'Alarmas, cámaras y porteros', 'Cámaras de seguridad, alarmas, porteros eléctricos, cercos eléctricos y control de acceso.', 'cctv', 25, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'sistema', '¿Qué sistema es?', 'select', '["Cámaras","Alarma","Portero eléctrico o visor","Cerco eléctrico","Control de acceso","Varios"]'::jsonb, true, 0 FROM categories WHERE slug = 'seguridad' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('energia-solar', 'Energía solar', 'Paneles solares, termotanques solares y climatización solar de piletas.', 'sun', 26, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'sistema', '¿Qué te interesa?', 'select', '["Paneles para generar electricidad","Termotanque solar","Climatizar la pileta","Reparar o mantener un equipo","Asesoramiento"]'::jsonb, true, 0 FROM categories WHERE slug = 'energia-solar' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('cortinas', 'Cortinas, persianas y toldos', 'Cortinas roller y de tela, persianas, cortinas de enrollar y toldos: colocación y reparación.', 'blinds', 27, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Cortinas nuevas a medida","Reparar una persiana o cortina de enrollar","Motorizar","Toldo","Solo colocación"]'::jsonb, true, 0 FROM categories WHERE slug = 'cortinas' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('tapiceria', 'Tapicería y restauración de muebles', 'Retapizado de sillones y sillas, restauración, laqueado y lustre de muebles.', 'armchair', 28, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'mueble', '¿Qué mueble es y cuántos son?', 'text', '[]'::jsonb, true, 0 FROM categories WHERE slug = 'tapiceria' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('tv-audio', 'TV, audio y electrónica', 'Instalación de televisores y soportes, sonido, proyectores y reparación de equipos electrónicos.', 'tv', 29, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Colgar un televisor","Instalar sonido o proyector","Reparar un equipo","Antena o cableado","Otro"]'::jsonb, true, 0 FROM categories WHERE slug = 'tv-audio' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('domotica', 'Casa inteligente', 'Luces, enchufes, cerraduras y climatización controlados desde el celular.', 'house-wifi', 30, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'alcance', '¿Qué querés automatizar?', 'text', '[]'::jsonb, true, 0 FROM categories WHERE slug = 'domotica' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('calefaccion', 'Calefacción y calderas', 'Calderas, radiadores, losa radiante y sistemas de calefacción central.', 'heater', 31, false, 'Si sentís olor a gas o el artefacto tiene llama amarilla: no lo uses, ventilá y llamá a la emergencia de tu distribuidora o al 911.') ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'sistema', '¿Qué sistema tenés?', 'select', '["Caldera con radiadores","Losa radiante","Calefacción central por aire","Quiero instalar uno","No sé"]'::jsonb, true, 0 FROM categories WHERE slug = 'calefaccion' ON CONFLICT (category_id, key) DO NOTHING;
INSERT INTO categories (slug, name, description, icon, sort, requires_review, safety_note) VALUES ('ascensores', 'Ascensores y montacargas', 'Mantenimiento, reparación y modernización para edificios, comercios y casas.', 'arrow-up-down', 32, false, NULL) ON CONFLICT (slug) DO NOTHING;
INSERT INTO service_questions (category_id, key, label, kind, options, required, sort) SELECT id, 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Mantenimiento mensual","Reparación","Instalación o modernización","Inspección o libro de conservación"]'::jsonb, true, 0 FROM categories WHERE slug = 'ascensores' ON CONFLICT (category_id, key) DO NOTHING;

-- «Mantenimiento general» y «Otro» siguen al final de la lista.
UPDATE categories SET sort = 33 WHERE slug = 'mantenimiento';
UPDATE categories SET sort = 34 WHERE slug = 'otro';

INSERT INTO credential_types (code, name, description, expires) VALUES ('matricula_profesional', 'Matrícula profesional', 'Matrícula vigente de arquitecto/a, ingeniero/a o maestro mayor de obras.', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO credential_types (code, name, description, expires) VALUES ('habilitacion_plagas', 'Habilitación para control de plagas', 'Inscripción vigente como empresa de control de plagas, con director técnico.', true) ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0036_more_trades.sql');

-- ===== 0037_national_zones.sql =====
-- Cobertura nacional: partidos del conurbano que faltaban, principales ciudades del país y una zona "Resto de …" por provincia.
-- `province` acota la búsqueda de una dirección a su provincia (hay localidades homónimas); `catch_all` marca la zona comodín.
-- Generado desde src/lib/zones-national.ts.
ALTER TABLE zones ADD COLUMN province text;
ALTER TABLE zones ADD COLUMN catch_all boolean NOT NULL DEFAULT false;
ALTER TABLE zones DROP CONSTRAINT zones_region_check;
ALTER TABLE zones ADD CONSTRAINT zones_region_check CHECK (region IN ('CABA','GBA_NORTE','GBA_OESTE','GBA_SUR','PBA','CENTRO','CUYO','NOA','NEA','PATAGONIA','OTRA'));
UPDATE zones SET province = 'Ciudad de Buenos Aires' WHERE region = 'CABA';
UPDATE zones SET province = 'Buenos Aires' WHERE region LIKE 'GBA%';

INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-san-martin', 'San Martín', 'GBA_NORTE', 100, ARRAY['general san martin','san martin','villa ballester','jose leon suarez','san andres','villa maipu','villa lynch']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-tres-de-febrero', 'Tres de Febrero', 'GBA_NORTE', 101, ARRAY['tres de febrero','caseros','ciudadela','santos lugares','saenz pena','martin coronado','villa bosch','el palomar norte','loma hermosa']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-san-miguel', 'San Miguel / José C. Paz', 'GBA_NORTE', 102, ARRAY['san miguel','bella vista','muniz','jose c paz','jose clemente paz']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-malvinas', 'Malvinas Argentinas', 'GBA_NORTE', 103, ARRAY['malvinas argentinas','los polvorines','grand bourg','tortuguitas','pablo nogues','villa de mayo']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-hurlingham', 'Hurlingham / Ituzaingó', 'GBA_OESTE', 104, ARRAY['hurlingham','villa tesei','william morris','ituzaingo','villa udaondo']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-merlo', 'Merlo', 'GBA_OESTE', 105, ARRAY['merlo','san antonio de padua','libertad','parque san martin','mariano acosta','pontevedra']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-moreno', 'Moreno / General Rodríguez', 'GBA_OESTE', 106, ARRAY['moreno','paso del rey','francisco alvarez','la reja','trujui','general rodriguez']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-almirante-brown', 'Almirante Brown', 'GBA_SUR', 107, ARRAY['almirante brown','adrogue','burzaco','longchamps','rafael calzada','claypole','glew','jose marmol','san jose']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-esteban-echeverria', 'Esteban Echeverría / Ezeiza', 'GBA_SUR', 108, ARRAY['esteban echeverria','monte grande','luis guillon','el jaguel','canning','9 de abril','ezeiza','tristan suarez','la union']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('gba-berazategui', 'Berazategui / Florencio Varela', 'GBA_SUR', 109, ARRAY['berazategui','hudson','ranelagh','platanos','villa espana','florencio varela','bosques','zeballos']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-la-plata', 'La Plata, Berisso y Ensenada', 'PBA', 110, ARRAY['la plata','berisso','ensenada','city bell','gonnet','manuel b gonnet','villa elisa','tolosa','los hornos']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-mar-del-plata', 'Mar del Plata', 'PBA', 111, ARRAY['mar del plata','general pueyrredon','batan','sierra de los padres']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-bahia-blanca', 'Bahía Blanca', 'PBA', 112, ARRAY['bahia blanca','ingeniero white','punta alta','coronel de marina leonardo rosales']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-zarate-campana', 'Zárate y Campana', 'PBA', 113, ARRAY['zarate','campana','lima','exaltacion de la cruz','capilla del senor','los cardales']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-lujan', 'Luján', 'PBA', 114, ARRAY['lujan','open door','jauregui']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-tandil', 'Tandil', 'PBA', 115, ARRAY['tandil']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-olavarria', 'Olavarría y Azul', 'PBA', 116, ARRAY['olavarria','azul']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-san-nicolas', 'San Nicolás y Pergamino', 'PBA', 117, ARRAY['san nicolas de los arroyos','san nicolas','pergamino','ramallo','san pedro']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-junin', 'Junín', 'PBA', 118, ARRAY['junin','chacabuco','chivilcoy']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-costa', 'Costa Atlántica', 'PBA', 119, ARRAY['pinamar','villa gesell','la costa','san clemente del tuyu','santa teresita','mar de ajo','san bernardo','carilo','mar de las pampas','necochea','miramar','general alvarado']::text[], 'Buenos Aires', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('pba-resto', 'Resto de Buenos Aires', 'PBA', 120, ARRAY[]::text[], 'Buenos Aires', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cba-capital', 'Córdoba capital', 'CENTRO', 121, ARRAY['cordoba','capital']::text[], 'Córdoba', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cba-sierras', 'Carlos Paz y Sierras Chicas', 'CENTRO', 122, ARRAY['villa carlos paz','punilla','colon','villa allende','rio ceballos','unquillo','mendiolaza','la calera','cosquin','la falda','alta gracia','santa maria']::text[], 'Córdoba', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cba-rio-cuarto', 'Río Cuarto', 'CENTRO', 123, ARRAY['rio cuarto','las higueras']::text[], 'Córdoba', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cba-villa-maria', 'Villa María y San Francisco', 'CENTRO', 124, ARRAY['villa maria','general san martin','villa nueva','san francisco','san justo']::text[], 'Córdoba', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cba-resto', 'Resto de Córdoba', 'CENTRO', 125, ARRAY[]::text[], 'Córdoba', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sfe-rosario', 'Rosario y alrededores', 'CENTRO', 126, ARRAY['rosario','funes','roldan','villa gobernador galvez','granadero baigorria','perez','san lorenzo','capitan bermudez','fray luis beltran']::text[], 'Santa Fe', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sfe-capital', 'Santa Fe capital', 'CENTRO', 127, ARRAY['santa fe','la capital','santo tome','recreo','sauce viejo','san jose del rincon']::text[], 'Santa Fe', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sfe-rafaela', 'Rafaela y Venado Tuerto', 'CENTRO', 128, ARRAY['rafaela','castellanos','venado tuerto','general lopez','reconquista']::text[], 'Santa Fe', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sfe-resto', 'Resto de Santa Fe', 'CENTRO', 129, ARRAY[]::text[], 'Santa Fe', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('er-parana', 'Paraná', 'CENTRO', 130, ARRAY['parana','oro verde','san benito','colonia avellaneda']::text[], 'Entre Ríos', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('er-costa-uruguay', 'Concordia y Gualeguaychú', 'CENTRO', 131, ARRAY['concordia','gualeguaychu','concepcion del uruguay','uruguay','colon']::text[], 'Entre Ríos', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('er-resto', 'Resto de Entre Ríos', 'CENTRO', 132, ARRAY[]::text[], 'Entre Ríos', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('lp-santa-rosa', 'Santa Rosa y General Pico', 'CENTRO', 133, ARRAY['santa rosa','capital','toay','general pico','maraco']::text[], 'La Pampa', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('lp-resto', 'Resto de La Pampa', 'CENTRO', 134, ARRAY[]::text[], 'La Pampa', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('mza-gran-mendoza', 'Gran Mendoza', 'CUYO', 135, ARRAY['mendoza','capital','godoy cruz','guaymallen','las heras','lujan de cuyo','maipu','chacras de coria','dorrego','villa nueva']::text[], 'Mendoza', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('mza-san-rafael', 'San Rafael', 'CUYO', 136, ARRAY['san rafael','general alvear','malargue']::text[], 'Mendoza', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('mza-resto', 'Resto de Mendoza', 'CUYO', 137, ARRAY[]::text[], 'Mendoza', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sj-gran-san-juan', 'Gran San Juan', 'CUYO', 138, ARRAY['san juan','capital','rawson','rivadavia','chimbas','santa lucia','pocito']::text[], 'San Juan', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sj-resto', 'Resto de San Juan', 'CUYO', 139, ARRAY[]::text[], 'San Juan', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sl-san-luis', 'San Luis y Villa Mercedes', 'CUYO', 140, ARRAY['san luis','juan martin de pueyrredon','la punta','juana koslay','villa mercedes','general pedernera','merlo','junin']::text[], 'San Luis', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sl-resto', 'Resto de San Luis', 'CUYO', 141, ARRAY[]::text[], 'San Luis', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('tuc-gran-tucuman', 'Gran San Miguel de Tucumán', 'NOA', 142, ARRAY['san miguel de tucuman','capital','yerba buena','tafi viejo','banda del rio sali','cruz alta','las talitas','alderetes','lules']::text[], 'Tucumán', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('tuc-resto', 'Resto de Tucumán', 'NOA', 143, ARRAY[]::text[], 'Tucumán', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sal-capital', 'Salta capital', 'NOA', 144, ARRAY['salta','capital','cerrillos','vaqueros','san lorenzo','la caldera']::text[], 'Salta', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sal-resto', 'Resto de Salta', 'NOA', 145, ARRAY[]::text[], 'Salta', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('juj-capital', 'San Salvador de Jujuy', 'NOA', 146, ARRAY['san salvador de jujuy','doctor manuel belgrano','dr manuel belgrano','palpala','yala']::text[], 'Jujuy', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('juj-resto', 'Resto de Jujuy', 'NOA', 147, ARRAY[]::text[], 'Jujuy', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sde-capital', 'Santiago del Estero y La Banda', 'NOA', 148, ARRAY['santiago del estero','capital','juan francisco borges','la banda','banda','termas de rio hondo','rio hondo']::text[], 'Santiago del Estero', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('sde-resto', 'Resto de Santiago del Estero', 'NOA', 149, ARRAY[]::text[], 'Santiago del Estero', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cat-capital', 'Catamarca capital', 'NOA', 150, ARRAY['san fernando del valle de catamarca','catamarca','capital','valle viejo','fray mamerto esquiu']::text[], 'Catamarca', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cat-resto', 'Resto de Catamarca', 'NOA', 151, ARRAY[]::text[], 'Catamarca', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('lr-capital', 'La Rioja capital', 'NOA', 152, ARRAY['la rioja','capital','chilecito']::text[], 'La Rioja', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('lr-resto', 'Resto de La Rioja', 'NOA', 153, ARRAY[]::text[], 'La Rioja', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cor-capital', 'Corrientes capital', 'NEA', 154, ARRAY['corrientes','capital']::text[], 'Corrientes', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cor-resto', 'Resto de Corrientes', 'NEA', 155, ARRAY[]::text[], 'Corrientes', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cha-resistencia', 'Resistencia', 'NEA', 156, ARRAY['resistencia','san fernando','barranqueras','fontana','puerto vilelas']::text[], 'Chaco', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('cha-resto', 'Resto de Chaco', 'NEA', 157, ARRAY[]::text[], 'Chaco', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('mis-posadas', 'Posadas', 'NEA', 158, ARRAY['posadas','capital','garupa','candelaria']::text[], 'Misiones', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('mis-resto', 'Resto de Misiones', 'NEA', 159, ARRAY[]::text[], 'Misiones', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('for-capital', 'Formosa capital', 'NEA', 160, ARRAY['formosa']::text[], 'Formosa', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('for-resto', 'Resto de Formosa', 'NEA', 161, ARRAY[]::text[], 'Formosa', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('nqn-capital', 'Neuquén y Alto Valle', 'PATAGONIA', 162, ARRAY['neuquen','confluencia','plottier','centenario','cutral co','plaza huincul']::text[], 'Neuquén', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('nqn-cordillera', 'San Martín de los Andes y Villa La Angostura', 'PATAGONIA', 163, ARRAY['san martin de los andes','lacar','junin de los andes','villa la angostura','los lagos']::text[], 'Neuquén', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('nqn-resto', 'Resto de Neuquén', 'PATAGONIA', 164, ARRAY[]::text[], 'Neuquén', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('rn-bariloche', 'Bariloche', 'PATAGONIA', 165, ARRAY['san carlos de bariloche','bariloche','dina huapi','el bolson']::text[], 'Río Negro', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('rn-alto-valle', 'Cipolletti, General Roca y Viedma', 'PATAGONIA', 166, ARRAY['cipolletti','general roca','villa regina','allen','cinco saltos','viedma','adolfo alsina']::text[], 'Río Negro', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('rn-resto', 'Resto de Río Negro', 'PATAGONIA', 167, ARRAY[]::text[], 'Río Negro', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('chu-comodoro', 'Comodoro Rivadavia', 'PATAGONIA', 168, ARRAY['comodoro rivadavia','escalante','rada tilly']::text[], 'Chubut', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('chu-trelew-madryn', 'Trelew, Rawson y Puerto Madryn', 'PATAGONIA', 169, ARRAY['trelew','rawson','puerto madryn','biedma','playa union','esquel','futaleufu']::text[], 'Chubut', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('chu-resto', 'Resto de Chubut', 'PATAGONIA', 170, ARRAY[]::text[], 'Chubut', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('scz-rio-gallegos', 'Río Gallegos y Caleta Olivia', 'PATAGONIA', 171, ARRAY['rio gallegos','guer aike','caleta olivia','deseado','el calafate','lago argentino']::text[], 'Santa Cruz', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('scz-resto', 'Resto de Santa Cruz', 'PATAGONIA', 172, ARRAY[]::text[], 'Santa Cruz', true) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('tdf-ushuaia', 'Ushuaia', 'PATAGONIA', 173, ARRAY['ushuaia']::text[], 'Tierra del Fuego', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('tdf-rio-grande', 'Río Grande y Tolhuin', 'PATAGONIA', 174, ARRAY['rio grande','tolhuin']::text[], 'Tierra del Fuego', false) ON CONFLICT (code) DO NOTHING;
INSERT INTO zones (code, name, region, sort, match_names, province, catch_all) VALUES ('tdf-resto', 'Resto de Tierra del Fuego', 'PATAGONIA', 175, ARRAY[]::text[], 'Tierra del Fuego', true) ON CONFLICT (code) DO NOTHING;

INSERT INTO schema_migrations (name) VALUES ('0037_national_zones.sql');

-- ===== 0038_app_login_handoff.sql =====
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

INSERT INTO schema_migrations (name) VALUES ('0038_app_login_handoff.sql');

-- ===== 0039_whatsapp_signup.sql =====
-- Alta de profesionales por WhatsApp: cuentas identificadas por el número, sin email ni contraseña.
-- `email_placeholder`: el email guardado es interno (la columna es obligatoria y única) y nunca se le escribe.
ALTER TABLE users ADD COLUMN email_placeholder boolean NOT NULL DEFAULT false;

-- Link para entrar al panel sin contraseña: se pide escribiendo "entrar" al WhatsApp de Fixy.
-- Un solo uso y 15 minutos; se canjea con un toque en la página (no al abrir el link, que WhatsApp previsualiza).
CREATE TABLE whatsapp_login_links (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_login_links_user_idx ON whatsapp_login_links (user_id);
ALTER TABLE whatsapp_login_links ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (name) VALUES ('0039_whatsapp_signup.sql');

-- ===== 0040_email_unverified.sql =====
-- Quien se anotó por WhatsApp puede sumar después un email y una clave para entrar también de la forma clásica.
-- Ese email no se verifica: por eso no se le mandan correos ni enlaces para restablecer la clave (si alguien lo
-- escribió mal, un tercero no puede quedarse con la cuenta). Los avisos siguen por WhatsApp y la clave se cambia
-- entrando con el link de WhatsApp.
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT true;

INSERT INTO schema_migrations (name) VALUES ('0040_email_unverified.sql');

-- ===== 0041_email_verification.sql =====
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

INSERT INTO schema_migrations (name) VALUES ('0041_email_verification.sql');

-- ===== 0042_push_device_session.sql =====
-- Auditoría M-08: dar de baja un dispositivo ya no depende de que alguien presente su token sin sesión.
-- Cada dispositivo queda atado a la sesión con la que se registró: al cerrar sesión (o al revocarse las sesiones,
-- por ejemplo al cambiar la contraseña) deja de recibir avisos solo.
ALTER TABLE push_devices ADD COLUMN session_hash text REFERENCES sessions(token_hash) ON DELETE CASCADE;
CREATE INDEX push_devices_session_idx ON push_devices (session_hash) WHERE session_hash IS NOT NULL;

INSERT INTO schema_migrations (name) VALUES ('0042_push_device_session.sql');

-- ===== 0043_payment_commands.sql =====
-- Pagos fiables (auditoría H-02 / H-03). Ninguna llamada a la pasarela ocurre con una transacción abierta:
--   1) la acción de negocio guarda la intención (comando) y confirma;
--   2) un procesador la reclama con un lease corto, llama a la pasarela con una clave idempotente estable;
--   3) en una transacción breve aplica el resultado (estado, registro financiero, avisos) y cierra el comando.
-- Si el proceso se cae entre 2 y 3, el lease vence y otro procesador reintenta con la MISMA clave: la pasarela
-- devuelve la misma operación en vez de repetirla.
CREATE TABLE payment_commands (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind             text NOT NULL CHECK (kind IN ('create_checkout','refund','orphan_refund','transfer')),
  gateway          text NOT NULL CHECK (gateway IN ('mock','mercadopago')),
  idempotency_key  text NOT NULL UNIQUE,
  charge_id        uuid REFERENCES charges(id),
  refund_id        uuid REFERENCES refunds(id),
  payout_id        uuid REFERENCES payouts(id),
  payload          jsonb NOT NULL DEFAULT '{}',
  payload_version  int NOT NULL DEFAULT 1,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','succeeded','retryable','dead','cancelled')),
  attempts         int NOT NULL DEFAULT 0,
  lease_until      timestamptz,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  result           jsonb,
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_commands_due_idx ON payment_commands (next_attempt_at) WHERE status IN ('pending','retryable','leased');
CREATE INDEX payment_commands_charge_idx ON payment_commands (charge_id);
CREATE INDEX payment_commands_refund_idx ON payment_commands (refund_id);
CREATE INDEX payment_commands_payout_idx ON payment_commands (payout_id);
ALTER TABLE payment_commands ENABLE ROW LEVEL SECURITY;

-- Conciliación: diferencias entre Fixy y la pasarela que necesitan a una persona (las reparables se reparan solas
-- por la misma vía idempotente del webhook y quedan registradas como resueltas).
CREATE TABLE payment_incidents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('info','warning','critical')),
  charge_id    uuid REFERENCES charges(id),
  command_id   uuid REFERENCES payment_commands(id),
  detail       jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  detected_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users(id),
  resolution   text
);
CREATE UNIQUE INDEX payment_incidents_open_key ON payment_incidents (kind, coalesce(charge_id, command_id)) WHERE status = 'open';
ALTER TABLE payment_incidents ENABLE ROW LEVEL SECURITY;

-- Última vez que la conciliación revisó el cobro contra la pasarela (para recorrerlos por turnos).
ALTER TABLE charges ADD COLUMN reconciled_at timestamptz;

-- Pasarela simulada: devoluciones idempotentes por clave, como en la real.
CREATE TABLE mock_gateway_refunds (
  idempotency_key text PRIMARY KEY,
  id              text NOT NULL UNIQUE,
  payment_id      text NOT NULL REFERENCES mock_gateway_payments(id),
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mock_gateway_refunds ENABLE ROW LEVEL SECURITY;

INSERT INTO schema_migrations (name) VALUES ('0043_payment_commands.sql');

-- ===== 0044_identity_hardening.sql =====
-- Identidad (auditoría A-04, M-02 y skill fixy-harden-auth, Etapa 2).

-- ── Sesiones observables y revocables ──
-- Cada sesión tiene un id visible (para listarla y cerrarla sin exponer el token), última actividad para vencer por
-- inactividad, un resumen del dispositivo y cuándo se verificó el segundo factor.
ALTER TABLE sessions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sessions ADD CONSTRAINT sessions_id_key UNIQUE (id);
ALTER TABLE sessions ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sessions ADD COLUMN user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 200);
ALTER TABLE sessions ADD COLUMN ip_hint text CHECK (ip_hint IS NULL OR length(ip_hint) <= 64);
ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;

-- ── Segundo factor (TOTP) para el equipo ──
-- El secreto se guarda cifrado (AES-256-GCM con MFA_ENCRYPTION_KEY, fuera de la base); los códigos de respaldo, solo
-- como hash. last_step evita reusar el mismo código dentro de su ventana.
CREATE TABLE user_mfa (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_enc  text NOT NULL,
  enabled_at  timestamptz,
  last_step   bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE user_mfa ENABLE ROW LEVEL SECURITY;

CREATE TABLE user_mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_mfa_recovery_codes_user_idx ON user_mfa_recovery_codes (user_id);
ALTER TABLE user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

-- ── Lectura del equipo por sección (mínimo privilegio en la base) ──
-- Antes todo el equipo leía todo (app.is_staff). Ahora finanzas, documentos de identidad y auditoría solo los lee
-- quien tiene esa sección (admin y operator, que ven todas las secciones, siguen igual).
CREATE FUNCTION app.staff_can(u uuid, sections text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users us WHERE us.id = u AND us.disabled_at IS NULL AND (
      us.platform_role IN ('admin','operator')
      OR (us.platform_role = 'team' AND EXISTS (SELECT 1 FROM admin_permissions ap WHERE ap.user_id = u AND ap.section = ANY (sections)))
    ))
$$;

CREATE OR REPLACE FUNCTION app.can_see_provider_finance(u uuid, p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT app.staff_can(u, ARRAY['finanzas']) OR app.provider_role(u, p) = 'admin'
$$;

DROP POLICY charges_access ON charges;
CREATE POLICY charges_access ON charges FOR SELECT TO fixy_app
  USING (app.staff_can(app.uid(), ARRAY['finanzas','trabajos','reclamos']) OR app.is_job_client(app.uid(), job_id)
         OR EXISTS (SELECT 1 FROM jobs j WHERE j.id = job_id AND app.can_see_provider_finance(app.uid(), j.provider_id)));

DROP POLICY payouts_access ON payouts;
CREATE POLICY payouts_access ON payouts FOR SELECT TO fixy_app
  USING (app.can_see_provider_finance(app.uid(), provider_id) OR app.staff_can(app.uid(), ARRAY['trabajos','reclamos']));

DROP POLICY ledger_access ON ledger_entries;
CREATE POLICY ledger_access ON ledger_entries FOR SELECT TO fixy_app USING (app.staff_can(app.uid(), ARRAY['finanzas']));

DROP POLICY payment_events_staff ON payment_events;
CREATE POLICY payment_events_staff ON payment_events FOR SELECT TO fixy_app USING (app.staff_can(app.uid(), ARRAY['finanzas']));

DROP POLICY provider_documents_private ON provider_documents;
CREATE POLICY provider_documents_private ON provider_documents FOR SELECT TO fixy_app
  USING (app.provider_role(app.uid(), provider_id) = 'admin' OR app.staff_can(app.uid(), ARRAY['proveedores']));

DROP POLICY audit_log_staff ON audit_log;
CREATE POLICY audit_log_staff ON audit_log FOR SELECT TO fixy_app USING (app.staff_can(app.uid(), ARRAY['auditoria']));

-- Archivos de profesionales privados (DNI, matrículas): solo el equipo con la sección Profesionales.
DROP POLICY files_access ON files;
CREATE POLICY files_access ON files FOR SELECT TO fixy_app
  USING (
    visibility = 'public'
    OR uploaded_by = app.uid()
    OR (app.is_staff(app.uid()) AND (owner_type <> 'provider' OR app.staff_can(app.uid(), ARRAY['proveedores'])))
    OR (owner_type = 'provider' AND app.provider_role(app.uid(), owner_id) = 'admin')
    OR (owner_type = 'request' AND app.can_see_request(app.uid(), owner_id))
    OR (owner_type = 'job' AND app.can_see_job(app.uid(), owner_id))
    OR (owner_type = 'conversation' AND app.can_see_conversation(app.uid(), owner_id))
    OR (owner_type = 'dispute' AND EXISTS (SELECT 1 FROM disputes d WHERE d.id = owner_id AND app.can_see_job(app.uid(), d.job_id)))
    OR (owner_type = 'property' AND app.can_see_property(app.uid(), owner_id))
  );

INSERT INTO schema_migrations (name) VALUES ('0044_identity_hardening.sql');

-- ===== Datos base =====
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('59766052-840b-40d8-8c9a-a0e6b250d5a6', 'electricidad', 'Electricidad', 'Enchufes, térmicas, cortes, luminarias y tableros.', 'zap', 0, true, false, 'Si ves chispas, olor a quemado o cables expuestos, no los toques y cortá la luz desde la térmica general si podés hacerlo sin riesgo.') ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('b3e2405f-b825-4f48-b204-524f84da9bda', 'plomeria', 'Plomería', 'Pérdidas, canillas, inodoros, desagües y cañerías.', 'droplets', 1, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('11bd0c60-28ef-42fc-9fef-a37a1d87f3d3', 'gas', 'Gas', 'Artefactos a gas, calefones, estufas y cocinas. Solo profesionales con matrícula.', 'flame', 2, true, false, 'Si sentís olor a gas: no prendas ni apagues luces, ventilá, salí del lugar y llamá a la emergencia de tu distribuidora o al 911.') ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('44e4f85f-4f3a-47d8-8592-947a8be92404', 'climatizacion', 'Aire acondicionado y climatización', 'Instalación, mantenimiento y reparación de equipos.', 'snowflake', 3, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('6452e9cb-f031-4ea5-9590-007807ef30bf', 'electrodomesticos', 'Electrodomésticos', 'Heladeras, lavarropas, hornos y otros equipos.', 'washing-machine', 4, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('eb7a8057-a686-4b00-bf07-771b52d03b65', 'cerrajeria', 'Cerrajería', 'Cerraduras, aperturas, cambios de combinación.', 'key-round', 5, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('8c37c818-fb0e-440e-affa-156dc440c659', 'pintura', 'Pintura', 'Interiores, exteriores, retoques y preparación de superficies.', 'paint-roller', 6, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('26b18be5-4fb4-4644-a620-626512780b97', 'albanileria', 'Albañilería', 'Revoques, grietas, humedad, cerámicos y pequeñas obras.', 'brick-wall', 7, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('6de6f80e-9923-421e-8a38-bdca3a2bbe5e', 'carpinteria', 'Carpintería', 'Muebles, puertas, placares y armado.', 'hammer', 8, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('73657a03-8cff-4abe-b015-5400e2fb1ee2', 'limpieza', 'Limpieza', 'Limpieza profunda, final de obra y oficinas.', 'sparkles', 9, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('41c440e6-277e-473e-82db-ce3ad9ef7277', 'informatica', 'Informática y redes', 'Wi-Fi, redes, computadoras e impresoras.', 'wifi', 10, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('558236d0-fed3-4d26-a49f-fb946b319c68', 'jardineria', 'Jardinería y paisajismo', 'Corte de césped, poda, mantenimiento, diseño de jardines y riego.', 'trees', 11, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('c902c07f-227c-4b63-a83b-c07134fe116f', 'piletas', 'Piletas', 'Mantenimiento, limpieza, puesta a punto, bombas, filtros y pintura de piletas.', 'waves', 12, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('c4a00061-9517-45ef-abe5-8d008f3b62ae', 'fumigacion', 'Fumigación y control de plagas', 'Cucarachas, roedores, mosquitos, hormigas y desinfección. También limpieza de tanques de agua.', 'bug', 13, true, false, 'Antes de una fumigación avisá si hay chicos, personas embarazadas, mascotas o peceras: el profesional te indica cuánto tiempo hay que ventilar.') ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('bbc1d793-6094-4a18-98a8-1c84de9f7037', 'volquetes', 'Volquetes y retiro de escombros', 'Alquiler de volquetes, retiro de escombros, muebles viejos, poda y residuos de obra.', 'truck', 14, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('83d6f07a-22f6-4bbb-b086-a71f6097cb12', 'mudanzas', 'Mudanzas y fletes', 'Mudanzas, fletes, traslado de muebles y embalaje.', 'package', 15, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('7cfbcf38-37a1-42c8-8174-2b9ef1c6d716', 'reformas', 'Reformas y obras', 'Reformas de baño y cocina, ampliaciones, construcción y obras completas con un solo responsable.', 'hard-hat', 16, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('67668c6e-1d15-400a-ad75-f6a623a6eca6', 'arquitectura', 'Arquitectura e ingeniería', 'Proyectos, planos, dirección de obra, regularizaciones, habilitaciones e informes técnicos.', 'drafting-compass', 17, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('c0024095-5822-40cf-9bd9-32a61d988116', 'decoracion', 'Decoración e interiorismo', 'Diseño de interiores, asesoramiento, ambientación y elección de muebles y colores.', 'lamp', 18, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('0b32cac5-1caa-4f8f-92e3-06328dddbce6', 'techos', 'Techos e impermeabilización', 'Goteras, filtraciones, membranas, zinguería, canaletas y tejas.', 'umbrella', 19, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('54add147-ab2f-470e-a74d-e3275fef5c8c', 'pisos', 'Pisos y revestimientos', 'Colocación de cerámicos y porcelanato, pisos flotantes y vinílicos, pulido y plastificado.', 'layout-grid', 20, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('d78a2268-c7d2-458d-b61b-1514a056c4a4', 'durlock', 'Durlock y construcción en seco', 'Tabiques, cielorrasos, revestimientos, muebles y aislaciones en placa de yeso.', 'layers', 21, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('f274ce37-8f15-459c-b4ae-70602f718e97', 'herreria', 'Herrería y portones', 'Rejas, portones, escaleras, estructuras, soldaduras y automatización de portones.', 'fence', 22, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('a4be9a39-760b-4f7c-9f21-56e3ba152e30', 'vidrieria', 'Vidriería y aberturas', 'Vidrios, espejos, mamparas, ventanas y puertas de aluminio o PVC, y mosquiteros.', 'app-window', 23, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('1ae4a4ce-ebb9-4147-8367-ed94aa295e7f', 'marmoleria', 'Marmolería y mesadas', 'Mesadas de cocina y baño, granito, mármol, cuarzo y pulido.', 'gem', 24, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('cba2d40d-5937-49f1-8a01-f57b0dc3b24d', 'seguridad', 'Alarmas, cámaras y porteros', 'Cámaras de seguridad, alarmas, porteros eléctricos, cercos eléctricos y control de acceso.', 'cctv', 25, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('82e81d80-36f3-4238-bcdc-b97b8fc6a116', 'energia-solar', 'Energía solar', 'Paneles solares, termotanques solares y climatización solar de piletas.', 'sun', 26, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('48b5d4b7-a80a-4e1d-aeb8-7a1f1d65d4bb', 'cortinas', 'Cortinas, persianas y toldos', 'Cortinas roller y de tela, persianas, cortinas de enrollar y toldos: colocación y reparación.', 'blinds', 27, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('a38f2013-1b3e-4a78-bf98-72e837ccaaf2', 'tapiceria', 'Tapicería y restauración de muebles', 'Retapizado de sillones y sillas, restauración, laqueado y lustre de muebles.', 'armchair', 28, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('e3b58203-24b7-4150-9038-8f6a3e8b0a3a', 'tv-audio', 'TV, audio y electrónica', 'Instalación de televisores y soportes, sonido, proyectores y reparación de equipos electrónicos.', 'tv', 29, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('5e6a843f-f501-4489-b854-e0d1d55383c2', 'domotica', 'Casa inteligente', 'Luces, enchufes, cerraduras y climatización controlados desde el celular.', 'house-wifi', 30, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('e4221d6a-8bb2-4083-abb7-5e915f9f296b', 'calefaccion', 'Calefacción y calderas', 'Calderas, radiadores, losa radiante y sistemas de calefacción central.', 'heater', 31, true, false, 'Si sentís olor a gas o el artefacto tiene llama amarilla: no lo uses, ventilá y llamá a la emergencia de tu distribuidora o al 911.') ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('5fa8803f-1313-4e69-bbcc-74f646998b2a', 'ascensores', 'Ascensores y montacargas', 'Mantenimiento, reparación y modernización para edificios, comercios y casas.', 'arrow-up-down', 32, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('ade1d8fc-4b2b-4150-9fa3-0067714fb496', 'mantenimiento', 'Mantenimiento general', 'Arreglos varios: colgar, ajustar, instalar y reparar.', 'wrench', 33, true, false, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.categories (id, slug, name, description, icon, sort, active, requires_review, safety_note) VALUES ('f3bf175a-d2cd-4dba-b56e-78e0bf5f4b6a', 'otro', 'Otro problema / no sé qué profesional necesito', 'Describilo con tus palabras: una persona del equipo lo revisa y lo deriva.', 'circle-help', 34, true, true, NULL) ON CONFLICT DO NOTHING;
INSERT INTO public.credential_types (id, code, name, description, expires) VALUES ('b64671f8-e1ea-40f3-95d4-c62cbf9fe682', 'matricula_gasista', 'Matrícula de gasista', 'Matrícula vigente habilitante para trabajos en instalaciones de gas.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.credential_types (id, code, name, description, expires) VALUES ('bee854e6-a2ac-4c4e-8601-e462b160af48', 'matricula_electricista', 'Matrícula de electricista', 'Matrícula o habilitación vigente como instalador electricista.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.credential_types (id, code, name, description, expires) VALUES ('fa13fe42-cfb9-4a89-9a8c-02e82df2d7cd', 'matricula_profesional', 'Matrícula profesional', 'Matrícula vigente de arquitecto/a, ingeniero/a o maestro mayor de obras.', false) ON CONFLICT DO NOTHING;
INSERT INTO public.credential_types (id, code, name, description, expires) VALUES ('7426009c-67f5-4457-92ed-e8505ecd7556', 'habilitacion_plagas', 'Habilitación para control de plagas', 'Inscripción vigente como empresa de control de plagas, con director técnico.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.credential_types (id, code, name, description, expires) VALUES ('ad51e8ab-51d0-4988-a44b-7a41f212cdd0', 'seguro_ap', 'Seguro de accidentes personales', 'Póliza vigente de accidentes personales o ART.', true) ON CONFLICT DO NOTHING;
INSERT INTO public.category_required_credentials (category_id, credential_type_id) VALUES ('11bd0c60-28ef-42fc-9fef-a37a1d87f3d3', 'b64671f8-e1ea-40f3-95d4-c62cbf9fe682') ON CONFLICT DO NOTHING;
INSERT INTO public.commission_rules (id, category_id, provider_rate_bps, client_rate_bps, client_fee_tax_bps, active, created_by, created_at) VALUES ('06d9d2db-2eec-4160-90aa-b14bb6448144', NULL, 0, 1000, 0, true, NULL, '2026-10-22 13:37:14.838438+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.publish_delay_hours', '[48, 72, 168]', NULL, '2026-10-22 13:37:14.731495+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.publish_jitter_hours', '12', NULL, '2026-10-22 13:37:14.731495+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.reminder_days', '[1, 3, 7]', NULL, '2026-10-22 13:37:14.731495+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.dispute_window_days', '30', NULL, '2026-10-22 13:37:14.740943+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.dispute_client_days', '5', NULL, '2026-10-22 13:37:14.740943+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('reviews.dispute_max_ai_rounds', '2', NULL, '2026-10-22 13:37:14.740943+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('booking.respond_hours', '4', NULL, '2026-10-22 13:37:14.75945+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('booking.respond_hours_urgent', '2', NULL, '2026-10-22 13:37:14.75945+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('withdrawals.delay_days', '20', NULL, '2026-10-22 13:37:14.781174+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('booking.respond_hours_unverified', '48', NULL, '2026-10-22 13:37:14.836873+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('referrals.fee_bps', '1000', NULL, '2026-10-22 13:37:14.838438+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('matching.budget_invite_limit', '15', NULL, '2026-10-22 13:37:14.861509+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('matching.invite_limit', '4', NULL, '2026-10-22 13:37:15.414105+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('coverage.regions', '["CABA", "GBA_NORTE", "GBA_OESTE", "GBA_SUR"]', NULL, '2026-10-22 13:37:15.414812+00') ON CONFLICT DO NOTHING;
INSERT INTO public.platform_settings (key, value, updated_by, updated_at) VALUES ('quotes.default_valid_days', '7', NULL, '2026-10-22 13:37:15.415096+00') ON CONFLICT DO NOTHING;
INSERT INTO public.policy_documents (id, kind, version, title, is_draft, published_at) VALUES ('2ae54953-af91-4ba1-95e9-4a4cf83ab6c1', 'terms', '1.0', 'Términos y condiciones', false, '2026-10-22 13:37:14.792913+00') ON CONFLICT DO NOTHING;
INSERT INTO public.policy_documents (id, kind, version, title, is_draft, published_at) VALUES ('c9b7c023-6923-40a5-9b4c-197bc53ce60f', 'privacy', '1.0', 'Política de privacidad', false, '2026-10-22 13:37:14.792913+00') ON CONFLICT DO NOTHING;
INSERT INTO public.policy_documents (id, kind, version, title, is_draft, published_at) VALUES ('f4f65c07-27ed-434b-8bad-e1f437af1549', 'provider_terms', '1.0', 'Condiciones para profesionales', false, '2026-10-22 13:37:14.792913+00') ON CONFLICT DO NOTHING;
INSERT INTO public.policy_documents (id, kind, version, title, is_draft, published_at) VALUES ('5ee09781-b0a8-4a9d-8a44-a42f634d7235', 'terms', '1.1', 'Términos y condiciones', false, '2026-10-22 13:37:14.849605+00') ON CONFLICT DO NOTHING;
INSERT INTO public.policy_documents (id, kind, version, title, is_draft, published_at) VALUES ('9038c0b8-2bb1-490a-9b10-5f6378e7e856', 'provider_terms', '1.1', 'Condiciones para profesionales', false, '2026-10-22 13:37:14.849605+00') ON CONFLICT DO NOTHING;
INSERT INTO public.policy_documents (id, kind, version, title, is_draft, published_at) VALUES ('51658a38-a013-46b3-9a55-9c56fbc32e93', 'privacy', '1.1', 'Política de privacidad', false, '2026-10-22 13:37:15.415831+00') ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('c04b6e62-2ee7-4a20-aeee-b93737453aea', '59766052-840b-40d8-8c9a-a0e6b250d5a6', 'afecta_toda_casa', '¿Afecta a todo el lugar o a un sector?', 'select', '["Todo el lugar", "Un ambiente o sector", "Un solo enchufe o luz", "No sé"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('a3eedd03-82a6-4a7d-a994-e8502df2a28f', '59766052-840b-40d8-8c9a-a0e6b250d5a6', 'salta_termica', '¿Salta la térmica o el disyuntor?', 'select', '["Sí", "No", "No sé"]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('dea8ecde-c01d-4968-b7c0-9c267eb653af', 'b3e2405f-b825-4f48-b204-524f84da9bda', 'hay_perdida_activa', '¿Hay una pérdida de agua activa ahora?', 'select', '["Sí, constante", "Gotea", "No"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('0fc13d2d-5e41-42fd-a25d-dd457d564da9', 'b3e2405f-b825-4f48-b204-524f84da9bda', 'pudo_cerrar_llave', '¿Pudiste cerrar la llave de paso?', 'select', '["Sí", "No", "No sé dónde está"]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('291b3142-5af0-4021-b3ee-8551461fe667', '11bd0c60-28ef-42fc-9fef-a37a1d87f3d3', 'artefacto', '¿Qué artefacto es?', 'select', '["Calefón", "Termotanque", "Estufa", "Cocina / horno", "Caldera", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('a43db1df-500e-47c4-b77c-84c3764773e3', '11bd0c60-28ef-42fc-9fef-a37a1d87f3d3', 'olor_gas', '¿Sentís olor a gas?', 'select', '["Sí", "No"]', true, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('2b68d3f1-2b53-4053-833f-99cb0dfb66fc', '44e4f85f-4f3a-47d8-8592-947a8be92404', 'tipo_equipo', 'Tipo de equipo', 'select', '["Split", "Ventana", "Portátil", "Central", "No sé"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('8dc5ff85-9a5f-4338-8575-b12e78ace721', '44e4f85f-4f3a-47d8-8592-947a8be92404', 'frigorias', 'Frigorías aproximadas (si las sabés)', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('56dd4596-48b8-4ffe-adcd-9a7a557679ab', '44e4f85f-4f3a-47d8-8592-947a8be92404', 'necesita_instalacion', '¿Es una instalación nueva?', 'boolean', '[]', false, 2) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('ed8170e2-17a3-41e4-853f-a95397814244', '6452e9cb-f031-4ea5-9590-007807ef30bf', 'equipo', '¿Qué equipo es?', 'text', '[]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('18d286f8-bc49-47d1-8dc6-457ee774a2e1', '558236d0-fed3-4d26-a49f-fb946b319c68', 'superficie', 'Tamaño aproximado del jardín o cantidad de plantas', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('9f64ca9e-ce65-4f9b-801b-add34ce4b931', 'c902c07f-227c-4b63-a83b-c07134fe116f', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Mantenimiento periódico", "Puesta a punto de temporada", "Recuperar agua verde", "Bomba o filtro", "Pintura o reparación", "Construcción", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('a194fa5b-3797-423b-8d7e-41a5556e2776', 'c902c07f-227c-4b63-a83b-c07134fe116f', 'medidas', 'Medidas o litros aproximados (si los sabés)', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('2c018360-c981-438f-8674-8e4ffa1a24ed', 'c4a00061-9517-45ef-abe5-8d008f3b62ae', 'plaga', '¿Qué necesitás tratar?', 'select', '["Cucarachas", "Roedores", "Mosquitos", "Hormigas", "Chinches o pulgas", "Murciélagos o palomas", "Limpieza de tanque de agua", "No sé"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('c82e33d2-bfce-42b9-8460-6f280a7c30b4', 'c4a00061-9517-45ef-abe5-8d008f3b62ae', 'certificado', '¿Necesitás certificado (consorcio, comercio u oficina)?', 'boolean', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('f305bef5-add6-4388-976b-347ed80105b8', 'bbc1d793-6094-4a18-98a8-1c84de9f7037', 'que_retirar', '¿Qué hay que retirar?', 'select', '["Escombros de obra", "Muebles o electrodomésticos", "Restos de poda", "Tierra", "Varios"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('53f14cad-626c-4ddd-a90c-a13dbcc489c2', 'bbc1d793-6094-4a18-98a8-1c84de9f7037', 'espacio_volquete', '¿Hay lugar en la calle o en la vereda para dejar un volquete?', 'select', '["Sí", "No", "No sé"]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('ec276ed8-f0bc-4da3-96cf-0f01ab69cc60', '83d6f07a-22f6-4bbb-b086-a71f6097cb12', 'tipo', '¿Qué necesitás?', 'select', '["Mudanza completa", "Flete de pocos muebles", "Solo embalaje", "Guardamuebles"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('0d816e98-3fdd-4d59-9c62-44f6bb3dcd67', '83d6f07a-22f6-4bbb-b086-a71f6097cb12', 'destino', '¿A qué barrio o localidad va?', 'text', '[]', true, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('7c29a154-ab73-4772-bdf7-6e83c3a7809c', '83d6f07a-22f6-4bbb-b086-a71f6097cb12', 'ascensor', '¿Hay ascensor o hay que subir por escalera?', 'text', '[]', false, 2) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('afa9bda0-dff6-4527-8b87-71a63eac9f6d', '7cfbcf38-37a1-42c8-8174-2b9ef1c6d716', 'tipo_obra', '¿Qué tipo de obra es?', 'select', '["Reforma de baño", "Reforma de cocina", "Reforma integral", "Ampliación", "Construcción desde cero", "Local u oficina", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('1235489e-82a8-435a-95c5-4912d28caa3a', '7cfbcf38-37a1-42c8-8174-2b9ef1c6d716', 'tiene_planos', '¿Tenés planos o proyecto?', 'select', '["Sí", "No", "Necesito que me lo armen"]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('bd1b9aab-8e33-4a61-a2c8-1ff0ae462e49', '67668c6e-1d15-400a-ad75-f6a623a6eca6', 'necesidad', '¿Qué necesitás?', 'select', '["Proyecto y planos", "Dirección de obra", "Regularizar o aprobar planos", "Habilitación comercial", "Informe técnico o cálculo estructural", "Asesoramiento"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('b66d7dde-6e53-4a90-9c7e-31526bff5847', '67668c6e-1d15-400a-ad75-f6a623a6eca6', 'superficie', 'Superficie aproximada (m²)', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('2d2d3cc2-9f53-4781-a836-ba7ef85955ce', 'c0024095-5822-40cf-9bd9-32a61d988116', 'alcance', '¿Qué estás buscando?', 'select', '["Asesoramiento por única vez", "Proyecto de un ambiente", "Proyecto de toda la casa", "Local u oficina", "Ambientación para vender o alquilar"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('719499c6-2882-4ceb-bd35-c4b50be75346', 'c0024095-5822-40cf-9bd9-32a61d988116', 'ambientes', '¿Qué ambientes?', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('a4b63c40-e743-41c1-b63c-fd9aa76e9503', '0b32cac5-1caa-4f8f-92e3-06328dddbce6', 'tipo_techo', '¿Qué tipo de techo es?', 'select', '["Losa o terraza", "Chapa", "Tejas", "No sé"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('79d7b01e-9437-425d-9019-1d0b1077faef', '0b32cac5-1caa-4f8f-92e3-06328dddbce6', 'hay_filtracion', '¿Hay goteras o filtraciones ahora?', 'select', '["Sí", "No, es preventivo"]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('3e64671b-af7a-4fa1-958f-53152cb63738', '54add147-ab2f-470e-a74d-e3275fef5c8c', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Colocar cerámicos o porcelanato", "Piso flotante o vinílico", "Pulido y plastificado de madera", "Microcemento", "Reparar piezas sueltas", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('67f25466-6b38-4042-b28a-893256a52094', '54add147-ab2f-470e-a74d-e3275fef5c8c', 'superficie', 'Superficie aproximada (m²)', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('709e6dbd-8b82-4f05-8a3b-a153c29530ba', 'd78a2268-c7d2-458d-b61b-1514a056c4a4', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Dividir un ambiente", "Cielorraso", "Revestir una pared", "Mueble o nicho", "Reparación", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('eab7352b-a05a-4620-9fb2-3fc66f7493e7', 'f274ce37-8f15-459c-b4ae-70602f718e97', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Rejas", "Portón nuevo", "Automatizar o reparar un portón", "Escalera o baranda", "Estructura o techo", "Soldadura o reparación"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('e21c9737-9b62-42ad-82b5-1d8b9be5f636', 'a4be9a39-760b-4f7c-9f21-56e3ba152e30', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Reponer un vidrio roto", "Espejo a medida", "Mampara de baño", "Ventana o puerta nueva", "Reparar una abertura", "Mosquiteros", "Cerramiento"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('7e976808-7314-46e3-a98a-54a6f9b5b8a8', 'a4be9a39-760b-4f7c-9f21-56e3ba152e30', 'medidas', 'Medidas aproximadas (si las tenés)', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('fb7faae5-24a7-4b7c-a52e-a3669b8b3091', '1ae4a4ce-ebb9-4147-8367-ed94aa295e7f', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Mesada nueva", "Cambiar o agrandar una mesada", "Pulido o reparación", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('ee362366-f290-4300-adc4-30a66b1b1bd8', 'cba2d40d-5937-49f1-8a01-f57b0dc3b24d', 'sistema', '¿Qué sistema es?', 'select', '["Cámaras", "Alarma", "Portero eléctrico o visor", "Cerco eléctrico", "Control de acceso", "Varios"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('299a493e-97f7-4ea8-8e4b-610d10cac21c', '82e81d80-36f3-4238-bcdc-b97b8fc6a116', 'sistema', '¿Qué te interesa?', 'select', '["Paneles para generar electricidad", "Termotanque solar", "Climatizar la pileta", "Reparar o mantener un equipo", "Asesoramiento"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('1d855045-2a67-4499-a040-49a7bf0dfafa', '48b5d4b7-a80a-4e1d-aeb8-7a1f1d65d4bb', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Cortinas nuevas a medida", "Reparar una persiana o cortina de enrollar", "Motorizar", "Toldo", "Solo colocación"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('1efbbd79-2aab-4f40-b45e-21a9c1d4e5e4', 'a38f2013-1b3e-4a78-bf98-72e837ccaaf2', 'mueble', '¿Qué mueble es y cuántos son?', 'text', '[]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('5890b866-69c3-4745-9938-699d81502265', 'e3b58203-24b7-4150-9038-8f6a3e8b0a3a', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Colgar un televisor", "Instalar sonido o proyector", "Reparar un equipo", "Antena o cableado", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('89a1e82a-c25f-4cbc-9909-8f1ac71e00c9', '5e6a843f-f501-4489-b854-e0d1d55383c2', 'alcance', '¿Qué querés automatizar?', 'text', '[]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('b364b3d2-049f-456f-aa57-55e2f1420473', 'e4221d6a-8bb2-4083-abb7-5e915f9f296b', 'sistema', '¿Qué sistema tenés?', 'select', '["Caldera con radiadores", "Losa radiante", "Calefacción central por aire", "Quiero instalar uno", "No sé"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('592f7a77-ec08-4e19-a3e8-bce3860d7023', '6452e9cb-f031-4ea5-9590-007807ef30bf', 'marca_modelo', 'Marca y modelo (si los tenés)', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('98914315-917a-409c-9fb1-1165decc3b21', '6452e9cb-f031-4ea5-9590-007807ef30bf', 'en_garantia', '¿Está en garantía de fábrica?', 'select', '["Sí", "No", "No sé"]', false, 2) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('247e7520-6311-4860-bedf-97763c0ea392', 'eb7a8057-a686-4b00-bf07-771b52d03b65', 'situacion', '¿Cuál es la situación?', 'select', '["Me quedé afuera", "Cambio de cerradura", "Cambio de combinación", "Cerradura trabada", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('26857771-cd46-40e8-80a1-c1a6f175b89c', '8c37c818-fb0e-440e-affa-156dc440c659', 'superficie', 'Superficie aproximada (m² o ambientes)', 'text', '[]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('3649aed9-ce70-4482-a95a-3ecc6a601c7b', '8c37c818-fb0e-440e-affa-156dc440c659', 'incluye_materiales', '¿Querés que el profesional provea la pintura?', 'boolean', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('bafdd8df-5d05-4762-a52c-c4fa81a2a166', '26b18be5-4fb4-4644-a620-626512780b97', 'tipo_trabajo', '¿Qué tipo de trabajo es?', 'select', '["Reparación", "Humedad", "Revestimiento", "Pequeña obra", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('5fddc167-b7e1-4104-891b-563d4458708a', '6de6f80e-9923-421e-8a38-bdca3a2bbe5e', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Reparar", "Armar", "Fabricar a medida", "Ajustar puertas"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('4cc14783-2aa9-4dc3-b50f-989b33e71215', '73657a03-8cff-4abe-b015-5400e2fb1ee2', 'tipo_limpieza', 'Tipo de limpieza', 'select', '["General profunda", "Final de obra", "Oficina", "Vidrios"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('b5d862e0-4f87-430d-b191-a539d4ad61f0', '73657a03-8cff-4abe-b015-5400e2fb1ee2', 'superficie', 'Superficie o ambientes', 'text', '[]', false, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('9a1a5001-5278-441c-aba4-9833c946c347', '41c440e6-277e-473e-82db-ce3ad9ef7277', 'equipos', '¿Cuántos equipos o puestos involucra?', 'text', '[]', false, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('24fb3305-5f27-409c-89ab-4c6f2255d976', '558236d0-fed3-4d26-a49f-fb946b319c68', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Mantenimiento periódico", "Corte de césped", "Poda de árboles o cercos", "Diseño o armado de jardín", "Riego automático", "Otro"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('62a58e7f-d6f9-4a2c-9b8c-1af84a83c78a', '5fa8803f-1313-4e69-bbcc-74f646998b2a', 'tipo_trabajo', '¿Qué necesitás?', 'select', '["Mantenimiento mensual", "Reparación", "Instalación o modernización", "Inspección o libro de conservación"]', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.service_questions (id, category_id, key, label, kind, options, required, sort) VALUES ('e62d98d2-097c-4177-9793-50180e40a093', 'ade1d8fc-4b2b-4150-9fa3-0067714fb496', 'lista', 'Contanos la lista de tareas', 'text', '[]', false, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('5661c19b-8996-45b5-b0da-a47da9436b71', '59766052-840b-40d8-8c9a-a0e6b250d5a6', 'instalacion-luminaria', 'Instalación de luminaria (hasta 1 punto)', '', 'fixed', 2800000, NULL, 'ARS', 'Instalación de una luminaria en un punto existente, con prueba de funcionamiento.', 'No incluye la luminaria ni tendido de cables nuevos.', true, 0) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('f762a1fc-bf78-4160-88c4-7172001571f0', '59766052-840b-40d8-8c9a-a0e6b250d5a6', 'cambio-tomacorriente', 'Cambio de tomacorriente o llave', '', 'fixed', 1900000, NULL, 'ARS', 'Reemplazo de un tomacorriente o llave de luz existente.', 'No incluye materiales ni reparación de cableado.', true, 1) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('2addc4c6-d6b6-4ee7-9327-c605a0649289', 'b3e2405f-b825-4f48-b204-524f84da9bda', 'destapacion-pileta', 'Destapación simple de pileta o bacha', '', 'fixed', 3500000, NULL, 'ARS', 'Destapación manual de pileta de cocina o bacha de baño.', 'No incluye destapación de cloacas ni rotura de cañerías.', true, 2) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('dd566213-69c8-4623-828d-db8190b111af', 'eb7a8057-a686-4b00-bf07-771b52d03b65', 'cambio-cerradura', 'Cambio de cerradura (mano de obra)', '', 'fixed', 3000000, NULL, 'ARS', 'Reemplazo de cerradura de puerta interior o exterior estándar.', 'No incluye la cerradura nueva.', true, 3) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('b36c5f6c-ac0b-4559-bf5c-a2ad2c8f0d3e', '6452e9cb-f031-4ea5-9590-007807ef30bf', 'diagnostico-electrodomesticos', 'Visita de diagnóstico de electrodoméstico', '', 'diagnostic', NULL, 1800000, 'ARS', 'Revisión del equipo y presupuesto de reparación.', 'La reparación se cotiza aparte después de la visita.', true, 4) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('342c5670-c4a9-4f51-8f32-8d6c8360936f', '44e4f85f-4f3a-47d8-8592-947a8be92404', 'diagnostico-aire', 'Visita de diagnóstico de aire acondicionado', '', 'diagnostic', NULL, 2000000, 'ARS', 'Revisión del equipo y presupuesto de reparación o carga.', 'La reparación se cotiza aparte después de la visita.', true, 5) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('40fcf118-be24-4228-be65-accea031d287', 'b3e2405f-b825-4f48-b204-524f84da9bda', 'reparacion-perdida', 'Reparación de pérdida', '', 'quote', NULL, NULL, 'ARS', '', '', true, 6) ON CONFLICT DO NOTHING;
INSERT INTO public.services (id, category_id, slug, name, description, pricing_mode, fixed_price_minor, diagnostic_price_minor, currency, scope, exclusions, active, sort) VALUES ('076c7778-6b26-4a80-9931-2602fb9af793', '8c37c818-fb0e-440e-affa-156dc440c659', 'pintura-ambiente', 'Pintura de ambientes', '', 'quote', NULL, NULL, 'ARS', '', '', true, 7) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('d5a3c48d-1955-4e1c-a166-37dc22f085cb', 'otra-zona', 'Otra zona', 'OTRA', true, 999, '{}', NULL, false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('a91e1acd-a9b1-4cf4-a5d9-8ebd89b7eaa6', 'gba-san-fernando', 'San Fernando', 'GBA_NORTE', true, 10, '{"san fernando",victoria,virreyes,"islas san fernando"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('493e4b0a-658c-4e4b-b60e-8ee3a0a855b7', 'gba-tigre', 'Tigre / Nordelta', 'GBA_NORTE', true, 11, '{tigre,"don torcuato","general pacheco",benavidez,nordelta,"el talar","rincon de milberg","troncos del talar","ricardo rojas","dique lujan","villa la nueva"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('4519d6fd-55bc-4d11-87e4-3a0788ad01b0', 'gba-escobar', 'Escobar', 'GBA_NORTE', true, 12, '{escobar,"belen escobar","ingeniero maschwitz",maschwitz,garin,matheu,"maquinista savio","loma verde",puertos}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('88749ae6-4e45-46c2-b188-4de76a0559db', 'gba-pilar', 'Pilar', 'GBA_NORTE', true, 13, '{pilar,"del viso","presidente derqui","villa rosa",manzanares,fatima,"la lonja","manuel alberti","villa astolfi",lagomarsino,zelaya,"pilar centro"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('69206766-facd-46db-b20c-555087b7a35b', 'gba-tres-de-febrero', 'Tres de Febrero', 'GBA_NORTE', true, 101, '{"tres de febrero",caseros,ciudadela,"santos lugares","saenz pena","martin coronado","villa bosch","el palomar norte","loma hermosa"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('b48559b0-d836-49d7-bb4d-dbb22de823e1', 'gba-san-miguel', 'San Miguel / José C. Paz', 'GBA_NORTE', true, 102, '{"san miguel","bella vista",muniz,"jose c paz","jose clemente paz"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('a9e46d24-8b7c-4909-a742-90274b92cca6', 'gba-malvinas', 'Malvinas Argentinas', 'GBA_NORTE', true, 103, '{"malvinas argentinas","los polvorines","grand bourg",tortuguitas,"pablo nogues","villa de mayo"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('38778697-a22d-4a3c-9961-20bdefcdd49e', 'gba-hurlingham', 'Hurlingham / Ituzaingó', 'GBA_OESTE', true, 104, '{hurlingham,"villa tesei","william morris",ituzaingo,"villa udaondo"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('072a8f3a-159f-49e7-a6cb-6386f852c7f1', 'gba-san-martin', 'San Martín', 'GBA_NORTE', true, 100, '{"general san martin","san martin","villa ballester","jose leon suarez","san andres","villa maipu","villa lynch"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('4d8938c8-ef3c-4901-bfad-5808ee637ab1', 'gba-merlo', 'Merlo', 'GBA_OESTE', true, 105, '{merlo,"san antonio de padua",libertad,"parque san martin","mariano acosta",pontevedra}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('f4a4033f-55cb-4830-820f-515f59ae08b3', 'gba-moreno', 'Moreno / General Rodríguez', 'GBA_OESTE', true, 106, '{moreno,"paso del rey","francisco alvarez","la reja",trujui,"general rodriguez"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('aa6a24fa-ff5a-45e4-9a31-26a10840786e', 'gba-almirante-brown', 'Almirante Brown', 'GBA_SUR', true, 107, '{"almirante brown",adrogue,burzaco,longchamps,"rafael calzada",claypole,glew,"jose marmol","san jose"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('88873826-6036-4103-b2bf-40a040d35e77', 'gba-esteban-echeverria', 'Esteban Echeverría / Ezeiza', 'GBA_SUR', true, 108, '{"esteban echeverria","monte grande","luis guillon","el jaguel",canning,"9 de abril",ezeiza,"tristan suarez","la union"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('d157ca00-e566-4eda-a406-36566b6e2b64', 'gba-berazategui', 'Berazategui / Florencio Varela', 'GBA_SUR', true, 109, '{berazategui,hudson,ranelagh,platanos,"villa espana","florencio varela",bosques,zeballos}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('afc1e3d2-2a83-405e-8592-18e189b60ed7', 'pba-la-plata', 'La Plata, Berisso y Ensenada', 'PBA', true, 110, '{"la plata",berisso,ensenada,"city bell",gonnet,"manuel b gonnet","villa elisa",tolosa,"los hornos"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('593bb6ab-57ed-4637-a72b-b18790cf1b83', 'pba-mar-del-plata', 'Mar del Plata', 'PBA', true, 111, '{"mar del plata","general pueyrredon",batan,"sierra de los padres"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('b302af65-f796-49fa-9bd1-d68df4d82303', 'pba-bahia-blanca', 'Bahía Blanca', 'PBA', true, 112, '{"bahia blanca","ingeniero white","punta alta","coronel de marina leonardo rosales"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('eea3384c-7fa5-43df-a825-cdd83e53100b', 'pba-zarate-campana', 'Zárate y Campana', 'PBA', true, 113, '{zarate,campana,lima,"exaltacion de la cruz","capilla del senor","los cardales"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('be83a7e9-df3d-4e17-8006-21dfa0258bd9', 'pba-lujan', 'Luján', 'PBA', true, 114, '{lujan,"open door",jauregui}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('765b9c31-0b4d-4371-88f7-30d26f50896f', 'pba-tandil', 'Tandil', 'PBA', true, 115, '{tandil}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('f050fec2-8fb4-4805-962f-770e2039fe09', 'pba-olavarria', 'Olavarría y Azul', 'PBA', true, 116, '{olavarria,azul}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('9499409e-10f2-48d8-b12a-8b948feb7a68', 'pba-san-nicolas', 'San Nicolás y Pergamino', 'PBA', true, 117, '{"san nicolas de los arroyos","san nicolas",pergamino,ramallo,"san pedro"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('4fd16ca8-2cb3-43ce-a4f8-ecb102950b79', 'pba-junin', 'Junín', 'PBA', true, 118, '{junin,chacabuco,chivilcoy}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('6dfbaae5-2264-4e78-b668-7e32283a1687', 'pba-costa', 'Costa Atlántica', 'PBA', true, 119, '{pinamar,"villa gesell","la costa","san clemente del tuyu","santa teresita","mar de ajo","san bernardo",carilo,"mar de las pampas",necochea,miramar,"general alvarado"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('d4295f57-2467-4ea2-b7d3-7f654436c5e1', 'pba-resto', 'Resto de Buenos Aires', 'PBA', true, 120, '{}', 'Buenos Aires', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('c480befd-deeb-47b7-9e47-df83585882b9', 'cba-capital', 'Córdoba capital', 'CENTRO', true, 121, '{cordoba,capital}', 'Córdoba', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('a00cb356-247d-4d20-8766-bf6677288fa0', 'cba-rio-cuarto', 'Río Cuarto', 'CENTRO', true, 123, '{"rio cuarto","las higueras"}', 'Córdoba', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('8e9439e5-fecd-4172-929f-a9bcf5f2462f', 'cba-villa-maria', 'Villa María y San Francisco', 'CENTRO', true, 124, '{"villa maria","general san martin","villa nueva","san francisco","san justo"}', 'Córdoba', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('303cd94a-f223-4cba-bc47-55128f7bb89e', 'cba-resto', 'Resto de Córdoba', 'CENTRO', true, 125, '{}', 'Córdoba', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('45f0bc3d-ac15-4c0e-a027-88fa6f832345', 'sfe-rosario', 'Rosario y alrededores', 'CENTRO', true, 126, '{rosario,funes,roldan,"villa gobernador galvez","granadero baigorria",perez,"san lorenzo","capitan bermudez","fray luis beltran"}', 'Santa Fe', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('e475cfae-0664-422b-bc51-9e8c9d134ebd', 'sfe-capital', 'Santa Fe capital', 'CENTRO', true, 127, '{"santa fe","la capital","santo tome",recreo,"sauce viejo","san jose del rincon"}', 'Santa Fe', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('f3240eb0-cbd2-4087-a096-8fd4b26015e8', 'sfe-rafaela', 'Rafaela y Venado Tuerto', 'CENTRO', true, 128, '{rafaela,castellanos,"venado tuerto","general lopez",reconquista}', 'Santa Fe', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('aab813d9-6209-4eed-9ed8-f0875d80e361', 'sfe-resto', 'Resto de Santa Fe', 'CENTRO', true, 129, '{}', 'Santa Fe', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('b713d058-451a-4799-aa40-e5b189939429', 'er-parana', 'Paraná', 'CENTRO', true, 130, '{parana,"oro verde","san benito","colonia avellaneda"}', 'Entre Ríos', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('8e05d74f-009f-4689-b24e-dc2d2eb04778', 'er-costa-uruguay', 'Concordia y Gualeguaychú', 'CENTRO', true, 131, '{concordia,gualeguaychu,"concepcion del uruguay",uruguay,colon}', 'Entre Ríos', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('3505f3cc-0a40-47d7-8635-7687171f41aa', 'er-resto', 'Resto de Entre Ríos', 'CENTRO', true, 132, '{}', 'Entre Ríos', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('0f5e7cc8-dab8-41c2-9082-520c9e9cf262', 'lp-santa-rosa', 'Santa Rosa y General Pico', 'CENTRO', true, 133, '{"santa rosa",capital,toay,"general pico",maraco}', 'La Pampa', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('432cfc44-9ad8-459a-b073-a0765034cf66', 'lp-resto', 'Resto de La Pampa', 'CENTRO', true, 134, '{}', 'La Pampa', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('ee834e07-612d-4719-ae75-3d1323c85623', 'mza-gran-mendoza', 'Gran Mendoza', 'CUYO', true, 135, '{mendoza,capital,"godoy cruz",guaymallen,"las heras","lujan de cuyo",maipu,"chacras de coria",dorrego,"villa nueva"}', 'Mendoza', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('a81f36d8-eabf-4a08-a455-1b86b0c487e4', 'mza-san-rafael', 'San Rafael', 'CUYO', true, 136, '{"san rafael","general alvear",malargue}', 'Mendoza', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('61884754-ad34-40b9-b868-d1f817aa2d60', 'mza-resto', 'Resto de Mendoza', 'CUYO', true, 137, '{}', 'Mendoza', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('79605970-908b-408b-98de-a381fe37b35c', 'sj-gran-san-juan', 'Gran San Juan', 'CUYO', true, 138, '{"san juan",capital,rawson,rivadavia,chimbas,"santa lucia",pocito}', 'San Juan', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('d4aafe13-470e-44b4-8675-281c28ed0bf7', 'sj-resto', 'Resto de San Juan', 'CUYO', true, 139, '{}', 'San Juan', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('a434d2e7-c35e-4ab1-9b28-d238985f1a6f', 'sl-san-luis', 'San Luis y Villa Mercedes', 'CUYO', true, 140, '{"san luis","juan martin de pueyrredon","la punta","juana koslay","villa mercedes","general pedernera",merlo,junin}', 'San Luis', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('cacdade3-efb3-4bd9-a109-7c32b36d676c', 'sl-resto', 'Resto de San Luis', 'CUYO', true, 141, '{}', 'San Luis', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('34bf474c-6169-4fdd-8485-cf8acc9e901e', 'tuc-resto', 'Resto de Tucumán', 'NOA', true, 143, '{}', 'Tucumán', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('a8ce3fc8-1bbf-474e-a226-a6f6c9be0e88', 'sal-capital', 'Salta capital', 'NOA', true, 144, '{salta,capital,cerrillos,vaqueros,"san lorenzo","la caldera"}', 'Salta', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('6d1c0ad4-914b-4a99-ae74-d172a256511c', 'sal-resto', 'Resto de Salta', 'NOA', true, 145, '{}', 'Salta', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('7371f94a-8a0f-4090-8081-b178bae86434', 'juj-capital', 'San Salvador de Jujuy', 'NOA', true, 146, '{"san salvador de jujuy","doctor manuel belgrano","dr manuel belgrano",palpala,yala}', 'Jujuy', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('5a3ef184-ed4a-47bb-8881-a09e4743bc9d', 'juj-resto', 'Resto de Jujuy', 'NOA', true, 147, '{}', 'Jujuy', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('07149dd3-78ea-4597-8775-accdeab2d36b', 'sde-capital', 'Santiago del Estero y La Banda', 'NOA', true, 148, '{"santiago del estero",capital,"juan francisco borges","la banda",banda,"termas de rio hondo","rio hondo"}', 'Santiago del Estero', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('625e3068-81dc-4e11-8a93-29f076416145', 'sde-resto', 'Resto de Santiago del Estero', 'NOA', true, 149, '{}', 'Santiago del Estero', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('cf26cdf0-09cc-4cc4-b080-ca299c4c3c9c', 'cat-capital', 'Catamarca capital', 'NOA', true, 150, '{"san fernando del valle de catamarca",catamarca,capital,"valle viejo","fray mamerto esquiu"}', 'Catamarca', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('55caf09b-a09a-4ca9-b803-4a6f3435cb37', 'cat-resto', 'Resto de Catamarca', 'NOA', true, 151, '{}', 'Catamarca', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('3f163e01-b713-4b23-998d-346f4a076030', 'lr-capital', 'La Rioja capital', 'NOA', true, 152, '{"la rioja",capital,chilecito}', 'La Rioja', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('9caa485d-30f1-4a03-9157-41a69e859320', 'lr-resto', 'Resto de La Rioja', 'NOA', true, 153, '{}', 'La Rioja', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('2eca3abf-889f-4d64-af13-a7ec8817106a', 'cor-capital', 'Corrientes capital', 'NEA', true, 154, '{corrientes,capital}', 'Corrientes', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('713e7669-d0f5-4072-a6e8-563db585250c', 'cor-resto', 'Resto de Corrientes', 'NEA', true, 155, '{}', 'Corrientes', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('72ef2725-3402-4a4a-bc73-8b2a692762a9', 'cha-resistencia', 'Resistencia', 'NEA', true, 156, '{resistencia,"san fernando",barranqueras,fontana,"puerto vilelas"}', 'Chaco', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('8843ac01-798a-4d7b-b04f-3cf1ed6dcaf3', 'cha-resto', 'Resto de Chaco', 'NEA', true, 157, '{}', 'Chaco', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('f64808bf-2251-4a1e-8a8b-f872a99ee006', 'mis-posadas', 'Posadas', 'NEA', true, 158, '{posadas,capital,garupa,candelaria}', 'Misiones', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('1181fabc-b760-4a12-aeae-1b7d97b5cf08', 'mis-resto', 'Resto de Misiones', 'NEA', true, 159, '{}', 'Misiones', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('8f4696b5-261b-4aa6-978a-f48dcf138da7', 'for-capital', 'Formosa capital', 'NEA', true, 160, '{formosa}', 'Formosa', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('35ca24f5-6bce-4b11-8045-bb26595a9c3b', 'for-resto', 'Resto de Formosa', 'NEA', true, 161, '{}', 'Formosa', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('121b8813-7d86-4c0f-913e-42956a0e95c1', 'nqn-capital', 'Neuquén y Alto Valle', 'PATAGONIA', true, 162, '{neuquen,confluencia,plottier,centenario,"cutral co","plaza huincul"}', 'Neuquén', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('62b382f8-e7fe-4f8b-869d-d592d1ea153e', 'nqn-cordillera', 'San Martín de los Andes y Villa La Angostura', 'PATAGONIA', true, 163, '{"san martin de los andes",lacar,"junin de los andes","villa la angostura","los lagos"}', 'Neuquén', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('c6d18083-0cec-4663-9bee-77053ebfa63f', 'nqn-resto', 'Resto de Neuquén', 'PATAGONIA', true, 164, '{}', 'Neuquén', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('e621f63d-ef38-478d-9498-7e72521cd0a4', 'rn-bariloche', 'Bariloche', 'PATAGONIA', true, 165, '{"san carlos de bariloche",bariloche,"dina huapi","el bolson"}', 'Río Negro', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('0610b57b-aac9-440c-a274-1ab4bedcf8f4', 'rn-alto-valle', 'Cipolletti, General Roca y Viedma', 'PATAGONIA', true, 166, '{cipolletti,"general roca","villa regina",allen,"cinco saltos",viedma,"adolfo alsina"}', 'Río Negro', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('f65909d7-ee4e-466b-8cc4-fc8b40cd038d', 'rn-resto', 'Resto de Río Negro', 'PATAGONIA', true, 167, '{}', 'Río Negro', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('df45305a-a082-4881-91a6-391daab7ca5a', 'chu-comodoro', 'Comodoro Rivadavia', 'PATAGONIA', true, 168, '{"comodoro rivadavia",escalante,"rada tilly"}', 'Chubut', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('9ba9aedc-5c55-4b9b-a94f-92dbce5b3755', 'caba-palermo', 'Palermo', 'CABA', true, 0, '{palermo,colegiales,chacarita,"villa crespo"}', 'Ciudad de Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('565f8851-f537-4abc-a129-15a5db77fc1d', 'caba-belgrano', 'Belgrano / Núñez', 'CABA', true, 1, '{belgrano,nunez,coghlan}', 'Ciudad de Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('d3175b6b-7452-4ef9-85dc-5ada1c8d3df9', 'caba-recoleta', 'Recoleta / Retiro', 'CABA', true, 2, '{recoleta,retiro}', 'Ciudad de Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('5dd798a1-1aab-448a-8bfe-1eda8f2748d7', 'caba-centro', 'Microcentro / San Nicolás', 'CABA', true, 3, '{"san nicolas",monserrat,montserrat,balvanera,"puerto madero","san cristobal"}', 'Ciudad de Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('8cf52d2e-6eeb-42a7-8b73-4dc729692f03', 'caba-caballito', 'Caballito / Almagro', 'CABA', true, 4, '{caballito,almagro,boedo,"parque chacabuco"}', 'Ciudad de Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('304f9e87-9047-480d-9209-e6796e331ca0', 'caba-urquiza', 'Villa Urquiza / Saavedra', 'CABA', true, 5, '{"villa urquiza",saavedra,"villa pueyrredon","villa ortuzar","parque chas",agronomia,"villa devoto","villa del parque","villa general mitre","villa santa rita","la paternal",paternal}', 'Ciudad de Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('ca1e1ffc-453c-4743-9c18-06658fb3408d', 'caba-flores', 'Flores / Floresta', 'CABA', true, 6, '{flores,floresta,"velez sarsfield","villa luro",liniers,mataderos,"parque avellaneda","villa real","monte castro",versalles,"villa lugano","villa riachuelo","villa soldati"}', 'Ciudad de Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('c767bee9-f67f-41fc-b0ce-12befa1cea20', 'caba-sur', 'San Telmo / Barracas / La Boca', 'CABA', true, 7, '{"san telmo",barracas,"la boca",boca,constitucion,"parque patricios","nueva pompeya"}', 'Ciudad de Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('e1639f51-1717-4fa1-8f88-8f3a00d5acb8', 'gba-vicente-lopez', 'Vicente López', 'GBA_NORTE', true, 8, '{"vicente lopez",olivos,florida,"florida oeste",munro,"la lucila","villa martelli",carapachay,"villa adelina"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('0101a105-56f9-47de-859b-4161974d9896', 'gba-san-isidro', 'San Isidro', 'GBA_NORTE', true, 9, '{"san isidro",martinez,acassuso,beccar,boulogne,"boulogne sur mer","villa adelina"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('b67249a0-36ab-40ac-bd56-71af755a853e', 'gba-moron', 'Morón', 'GBA_OESTE', true, 14, '{moron,castelar,haedo,"el palomar","villa sarmiento"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('a4cab7f6-7164-4d9b-a63a-df641ff42c9f', 'gba-la-matanza', 'La Matanza', 'GBA_OESTE', true, 15, '{"la matanza","san justo","ramos mejia","isidro casanova","gonzalez catan","lomas del mirador","villa luzuriaga",tapiales,"la tablada","gregorio de laferrere","ciudad evita","rafael castillo"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('63f2df64-88a6-4650-8292-509634325ad0', 'gba-avellaneda', 'Avellaneda', 'GBA_SUR', true, 16, '{avellaneda,wilde,sarandi,"dock sud","villa dominico",gerli,pineyro}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('3314072b-4d1a-40e3-9f79-b44e73d4a607', 'gba-lanus', 'Lanús', 'GBA_SUR', true, 17, '{lanus,"remedios de escalada","monte chingolo","valentin alsina",gerli}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('827560cc-1c77-4ca8-83a2-4850c21e86f0', 'gba-lomas', 'Lomas de Zamora', 'GBA_SUR', true, 18, '{"lomas de zamora",banfield,temperley,turdera,llavallol,"villa fiorito","ingeniero budge"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('c516e1d8-e3f9-46cc-a1e2-187aaf01494a', 'gba-quilmes', 'Quilmes', 'GBA_SUR', true, 19, '{quilmes,bernal,ezpeleta,"don bosco","san francisco solano"}', 'Buenos Aires', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('69b5223e-893a-4a27-b884-a42314da2931', 'cba-sierras', 'Carlos Paz y Sierras Chicas', 'CENTRO', true, 122, '{"villa carlos paz",punilla,colon,"villa allende","rio ceballos",unquillo,mendiolaza,"la calera",cosquin,"la falda","alta gracia","santa maria"}', 'Córdoba', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('2c15d5be-9228-4d2c-abda-87eccb7b90f4', 'tuc-gran-tucuman', 'Gran San Miguel de Tucumán', 'NOA', true, 142, '{"san miguel de tucuman",capital,"yerba buena","tafi viejo","banda del rio sali","cruz alta","las talitas",alderetes,lules}', 'Tucumán', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('2907054d-f527-43b6-9f0a-b2f8d10e2eb6', 'chu-trelew-madryn', 'Trelew, Rawson y Puerto Madryn', 'PATAGONIA', true, 169, '{trelew,rawson,"puerto madryn",biedma,"playa union",esquel,futaleufu}', 'Chubut', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('60e512b0-7c35-4f19-b376-f0b0568d8809', 'chu-resto', 'Resto de Chubut', 'PATAGONIA', true, 170, '{}', 'Chubut', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('f6f1849a-7f34-48fc-b643-82157e535fc0', 'scz-rio-gallegos', 'Río Gallegos y Caleta Olivia', 'PATAGONIA', true, 171, '{"rio gallegos","guer aike","caleta olivia",deseado,"el calafate","lago argentino"}', 'Santa Cruz', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('0fecb789-d2a6-4b75-84f1-2c5c3ac2cf25', 'scz-resto', 'Resto de Santa Cruz', 'PATAGONIA', true, 172, '{}', 'Santa Cruz', true) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('49a632bc-1e10-4ea5-96b6-896b77973f21', 'tdf-ushuaia', 'Ushuaia', 'PATAGONIA', true, 173, '{ushuaia}', 'Tierra del Fuego', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('1e777ca8-7b5e-458f-b18e-3115cea6f764', 'tdf-rio-grande', 'Río Grande y Tolhuin', 'PATAGONIA', true, 174, '{"rio grande",tolhuin}', 'Tierra del Fuego', false) ON CONFLICT DO NOTHING;
INSERT INTO public.zones (id, code, name, region, active, sort, match_names, province, catch_all) VALUES ('a2459a65-bcf7-4986-b2f7-b67ed699952a', 'tdf-resto', 'Resto de Tierra del Fuego', 'PATAGONIA', true, 175, '{}', 'Tierra del Fuego', true) ON CONFLICT DO NOTHING;
COMMIT;
SELECT (SELECT count(*) FROM categories) AS categorias, (SELECT count(*) FROM zones) AS zonas, (SELECT count(*) FROM schema_migrations) AS migraciones;
