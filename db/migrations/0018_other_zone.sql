-- Nunca rechazar un pedido por ubicación: las direcciones fuera de las zonas de cobertura van a "Otra zona".
-- Esos pedidos quedan sin profesionales elegibles (estado no_coverage) y los revisa el equipo a mano.
ALTER TABLE zones DROP CONSTRAINT zones_region_check;
ALTER TABLE zones ADD CONSTRAINT zones_region_check CHECK (region IN ('CABA','GBA_NORTE','GBA_OESTE','GBA_SUR','OTRA'));
INSERT INTO zones (code, name, region, active, sort) VALUES ('otra-zona', 'Otra zona', 'OTRA', true, 999)
ON CONFLICT (code) DO NOTHING;
