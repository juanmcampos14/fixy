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
