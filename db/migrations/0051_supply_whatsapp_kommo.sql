-- Captación por WhatsApp automático: plantillas aprobadas por Meta desde el número comercial (API oficial) y
-- Kommo como bandeja (cada envío deja al profesional como lead en el embudo «Captación Fixy»).

ALTER TABLE supply_campaigns DROP CONSTRAINT supply_campaigns_channel_check;
ALTER TABLE supply_campaigns ADD CONSTRAINT supply_campaigns_channel_check CHECK (channel IN ('whatsapp','whatsapp_api','email'));

-- Lead de Kommo de cada candidato (para mover de etapa en vez de duplicar) y el id del mensaje de Meta.
ALTER TABLE supply_leads ADD COLUMN kommo_lead_id bigint;
ALTER TABLE supply_campaign_leads ADD COLUMN last_message_id text CHECK (length(last_message_id) <= 200);
