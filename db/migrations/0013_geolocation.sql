-- Ubicación con Google: coordenadas y dirección normalizada por propiedad, y nombres de barrios/partidos
-- que corresponden a cada zona de cobertura (para asignar la zona automáticamente desde la dirección).

ALTER TABLE properties ADD COLUMN lat double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90);
ALTER TABLE properties ADD COLUMN lng double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180);
ALTER TABLE properties ADD COLUMN place_id text CHECK (place_id IS NULL OR length(place_id) <= 300);
ALTER TABLE properties ADD COLUMN formatted_address text CHECK (formatted_address IS NULL OR length(formatted_address) <= 300);

ALTER TABLE zones ADD COLUMN match_names text[] NOT NULL DEFAULT '{}';

UPDATE zones SET match_names = v.names FROM (VALUES
  ('caba-palermo',     ARRAY['palermo','colegiales','chacarita','villa crespo']),
  ('caba-belgrano',    ARRAY['belgrano','nunez','coghlan']),
  ('caba-recoleta',    ARRAY['recoleta','retiro']),
  ('caba-centro',      ARRAY['san nicolas','monserrat','montserrat','balvanera','puerto madero','san cristobal']),
  ('caba-caballito',   ARRAY['caballito','almagro','boedo','parque chacabuco']),
  ('caba-urquiza',     ARRAY['villa urquiza','saavedra','villa pueyrredon','villa ortuzar','parque chas','agronomia','villa devoto','villa del parque','villa general mitre','villa santa rita','la paternal','paternal']),
  ('caba-flores',      ARRAY['flores','floresta','velez sarsfield','villa luro','liniers','mataderos','parque avellaneda','villa real','monte castro','versalles','villa lugano','villa riachuelo','villa soldati']),
  ('caba-sur',         ARRAY['san telmo','barracas','la boca','boca','constitucion','parque patricios','nueva pompeya']),
  ('gba-vicente-lopez',ARRAY['vicente lopez','olivos','florida','florida oeste','munro','la lucila','villa martelli','carapachay','villa adelina']),
  ('gba-san-isidro',   ARRAY['san isidro','martinez','acassuso','beccar','boulogne','boulogne sur mer','villa adelina']),
  ('gba-tigre',        ARRAY['tigre','don torcuato','general pacheco','benavidez','nordelta','el talar','rincon de milberg','troncos del talar']),
  ('gba-moron',        ARRAY['moron','castelar','haedo','el palomar','villa sarmiento']),
  ('gba-la-matanza',   ARRAY['la matanza','san justo','ramos mejia','isidro casanova','gonzalez catan','lomas del mirador','villa luzuriaga','tapiales','la tablada','gregorio de laferrere','ciudad evita','rafael castillo']),
  ('gba-avellaneda',   ARRAY['avellaneda','wilde','sarandi','dock sud','villa dominico','gerli','pineyro']),
  ('gba-lanus',        ARRAY['lanus','remedios de escalada','monte chingolo','valentin alsina','gerli']),
  ('gba-lomas',        ARRAY['lomas de zamora','banfield','temperley','turdera','llavallol','villa fiorito','ingeniero budge']),
  ('gba-quilmes',      ARRAY['quilmes','bernal','ezpeleta','don bosco','san francisco solano'])
) AS v(code, names) WHERE zones.code = v.code;
