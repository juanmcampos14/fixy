-- Alta simple de profesionales: borrador asistido por IA y "fuerza del perfil" que pesa en el ranking.
ALTER TABLE providers ADD COLUMN visit_configured_at timestamptz;
ALTER TABLE providers ADD COLUMN profile_ai_assisted boolean NOT NULL DEFAULT false;
-- Los perfiles que ya tenían visita con cargo cuentan como configurados.
UPDATE providers SET visit_configured_at = now() WHERE visit_fee_minor > 0;
