-- Oficios que los profesionales escriben porque no están en la lista ("No está mi oficio"). El equipo los revisa
-- para sumarlos al catálogo; mientras tanto el profesional queda en el rubro más parecido (o mantenimiento general).
CREATE TABLE trade_suggestions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  text        text NOT NULL CHECK (length(text) BETWEEN 2 AND 80),
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','added','dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX trade_suggestions_open_key ON trade_suggestions (provider_id, lower(text)) WHERE status = 'open';
ALTER TABLE trade_suggestions ENABLE ROW LEVEL SECURITY;
