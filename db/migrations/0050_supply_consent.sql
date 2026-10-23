-- Bases de contactos con consentimiento para recibir WhatsApp de Fixy: se registra en cada contacto cuándo y de
-- dónde sale (base oficial, formulario, convenio…), y las campañas pueden tomar solo a esos contactos.

ALTER TABLE supply_leads ADD COLUMN wa_consent_at timestamptz;
ALTER TABLE supply_leads ADD COLUMN wa_consent_source text CHECK (length(wa_consent_source) <= 300);
CREATE INDEX supply_leads_consent_idx ON supply_leads (wa_consent_at) WHERE wa_consent_at IS NOT NULL;

ALTER TABLE supply_campaigns ADD COLUMN only_consented boolean NOT NULL DEFAULT false;

ALTER TABLE supply_lead_events DROP CONSTRAINT supply_lead_events_kind_check;
ALTER TABLE supply_lead_events ADD CONSTRAINT supply_lead_events_kind_check
  CHECK (kind IN ('import','sync_update','stage','contact','note','link','opt_out','assign','click','campaign','consent'));
