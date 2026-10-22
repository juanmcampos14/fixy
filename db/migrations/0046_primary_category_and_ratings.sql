-- Rubro principal y calificación por rubro.
-- Cada profesional tiene exactamente un rubro principal: ahí aparece con prioridad; en los demás (secundarios) también
-- recibe pedidos, pero más abajo. Las reseñas cuentan para el rubro del trabajo reseñado.

ALTER TABLE provider_categories ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX provider_categories_one_primary ON provider_categories (provider_id) WHERE is_primary;

-- Perfiles existentes: el rubro con más trabajos; si no hay, el primero del catálogo.
UPDATE provider_categories pc SET is_primary = true
FROM (
  SELECT DISTINCT ON (x.provider_id) x.provider_id, x.category_id
  FROM provider_categories x JOIN categories c ON c.id = x.category_id
  ORDER BY x.provider_id,
    (SELECT count(*) FROM jobs j WHERE j.provider_id = x.provider_id AND j.category_id = x.category_id) DESC,
    c.sort, c.name
) f
WHERE pc.provider_id = f.provider_id AND pc.category_id = f.category_id;

-- Reseñas publicadas con el rubro del trabajo (columna nueva al final: la vista mantiene las anteriores).
CREATE OR REPLACE VIEW reviews_published AS
  SELECT id, provider_id, rating, comment, provider_reply, is_demo,
         date_trunc('month', visible_at)::date AS published_month,
         md5(id::text) AS sort_key,
         (SELECT j.category_id FROM jobs j WHERE j.id = reviews.job_id) AS category_id
  FROM reviews
  WHERE hidden_at IS NULL AND visible_at <= now();
