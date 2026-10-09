-- Términos 1.1: el profesional cobra el neto (costos de procesamiento del pago e impuestos) y recomendación entre colegas (10 %).
INSERT INTO policy_documents (kind, version, title, is_draft, published_at) VALUES
  ('terms', '1.1', 'Términos y condiciones', false, now()),
  ('provider_terms', '1.1', 'Condiciones para profesionales', false, now())
ON CONFLICT (kind, version) DO NOTHING;
