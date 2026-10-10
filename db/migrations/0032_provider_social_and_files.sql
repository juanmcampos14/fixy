-- Redes sociales públicas del profesional (opcionales) y archivos en el portfolio (PDF: catálogos, trabajos).
ALTER TABLE providers ADD COLUMN social_links jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(social_links) = 'object');

CREATE OR REPLACE VIEW provider_public AS
  SELECT id, slug, kind, display_name, description, years_experience, base_zone_id, status,
         identity_status, accepting_jobs, is_demo, created_at, approved_at, avatar_file_id, social_links
  FROM providers;
