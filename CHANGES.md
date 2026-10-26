# Cambios — informe VibeScan sobre `juanmcampos14/fixy` (25-10-2026)

Cada hallazgo se verificó contra el código antes de tocarlo. De los 130, **1 era real** (dependencia de la app móvil)
y se corrigió; los otros 129 son **falsos positivos** del escáner, explicados abajo con la evidencia y con el control
automático que impide que el problema real aparezca.

## P2 (real) — `uuid@7.0.3` (GHSA-w5hq-g745-h8pq / CVE-2026-41907)

- **Dónde de verdad:** `mobile/package-lock.json`, dependencia transitiva de desarrollo: `@capacitor/cli` → `xcode` → `uuid@7.0.3`.
  No viaja dentro de las apps ni del sitio; la usa la herramienta que edita el proyecto de Xcode.
- **Corrección:** `overrides: { "uuid": "^11.1.1" }` en `mobile/package.json` y lockfile regenerado. `npm audit` en `mobile/`: 0 vulnerabilidades.
  `npm audit fix --force` proponía bajar `@capacitor/cli` a 8.4.3 (cambio que rompe); no se aplicó.
- **Prueba:** la herramienta `xcode` lee el proyecto real `ios/App/App.xcodeproj` y genera identificadores con uuid 11.
- **Para que no vuelva:** el CI ahora también corre `npm audit --prefix mobile --audit-level=moderate`.

## P0.1 — `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (falso positivo, con acción manual)

Es la clave **de navegador** de Google Maps JavaScript / Places: Google la diseña para ir en el cliente y se protege
**restringiéndola**, no ocultándola (no hay forma de cargar el mapa sin exponerla). Las llamadas del servidor usan
otra clave, `GOOGLE_MAPS_SERVER_KEY`, que nunca va al cliente. La regla de semgrep `fixy-env-no-publico-en-cliente`
(ERROR en CI) impide que otra variable secreta llegue al navegador.

**Acción manual:** en Google Cloud › Credenciales, confirmar que esa clave tenga
restricción de **sitios web** (`https://www.fixy.solutions/*`, `https://fixy.solutions/*`) y de **APIs** (solo Maps
JavaScript API, Places API (New) y Geocoding API). Si no la tiene, agregarla; no hace falta rotarla.

## P1.1–P1.125 — «inyección SQL por concatenación» (falsos positivos)

Todas las líneas marcadas usan plantillas etiquetadas de `postgres.js` (`` sql`… ${valor} …` ``): el driver manda
cada `${valor}` como **parámetro** (`$1`, `$2`…), nunca pegado en el texto. Ejemplo marcado, `scripts/create-admin.ts:16`:
`` sql`select id from users where lower(email) = ${email}` `` → `select id from users where lower(email) = $1`.

Los únicos usos de SQL con texto (`.unsafe`) son: `scripts/migrate.ts` (ejecuta los archivos de `db/migrations`, no
datos de usuarios), `scripts/smoke.ts` (consultas fijas escritas en el script) y `tests/integration/helpers.ts`
(con parámetros `$1`). La regla `fixy-sql-unsafe` (ERROR en CI) prohíbe `.unsafe` en el código de la aplicación.
Además, el acceso a datos de usuarios corre con RLS (`asUser`) y las reglas `fixy-escritura-sql-fuera-del-servidor`
y `fixy-accion-sin-autenticacion` bloquean escrituras desde el cliente y acciones sin sesión.

## P1.6 — `eval()` en `scripts/store-screenshots.mjs:21` (falso positivo)

Es `page.$$eval(...)` de Playwright (lee atributos de la página en el navegador de prueba), no `eval` de JavaScript.
Es un script local para generar capturas de las tiendas.

## P1.126 — secreto en `src/server/payments/mercadopago.ts:19` (falso positivo)

La línea lee el token de `env()` (`MERCADOPAGO_TEST_ACCESS_TOKEN` / `MERCADOPAGO_ACCESS_TOKEN`, variables del
servidor). No hay ninguna clave escrita en el código. Nada que rotar.

## P1.127–P1.128 — contraseñas en pruebas (falsos positivos)

`clave-segura-123` es la contraseña de usuarios ficticios que las pruebas crean en la base de pruebas (`fixy_test`),
que se borra y recrea en cada corrida. No existe en producción. Nada que rotar.

## Verificación final

- `npm ci`, typecheck, lint (0 errores), pruebas, build de producción, `npm audit` (raíz y `mobile/`): ver la entrega.
- Secretos: gitleaks corre en el CI en cada push (`.github/workflows/ci.yml`).

## Decisiones

- No se reescribieron 125 consultas ya parametrizadas: cambiarlas no mejora la seguridad y agrega riesgo de regresión.
- No se forzó la actualización de `@capacitor/cli` (el «fix» automático bajaba de versión).
