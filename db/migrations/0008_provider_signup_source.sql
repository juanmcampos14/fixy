-- Origen del alta de proveedores (campañas /sumate y referidos), para medir de dónde llegan.
ALTER TABLE providers ADD COLUMN signup_source text CHECK (signup_source IS NULL OR length(signup_source) <= 120);
ALTER TABLE providers ADD COLUMN referred_by_provider_id uuid REFERENCES providers(id);
CREATE INDEX providers_signup_source_idx ON providers (signup_source);
