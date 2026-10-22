# Arquitectura

## Decisiones
| Decisión | Elección | Motivo |
|---|---|---|
| Framework | Next.js 16 (App Router, server components, server actions), React 19, TypeScript estricto | Monolito full-stack simple de desplegar (Vercel u otro host Node). |
| Estilos | Tailwind CSS v4 con tokens de marca en `src/app/globals.css` | Consistencia con el manual de marca. |
| Base de datos | PostgreSQL 16. Local: Docker. Producción: **Supabase Postgres** | Requisito del brief; RLS nativo. |
| Acceso a datos | `postgres` (postgres.js) con SQL explícito; migraciones SQL versionadas en `db/migrations` | Control total de RLS, triggers y transacciones; sin capa ORM que oculte reglas. |
| Autenticación | Sesiones propias (cookie httpOnly, token aleatorio guardado como hash SHA-256, scrypt para contraseñas) | Ver "Desvío respecto del brief" abajo. |
| Archivos | Adaptador de almacenamiento: disco local (dev) / **Supabase Storage bucket privado** (prod). Descarga solo por URL firmada propia y temporal. | Archivos privados por defecto. |
| Validación | Zod en servicios de dominio | Mensajes en español, fuente única. |
| Pagos | Interfaz `PaymentGateway` con adaptador simulado y esqueleto de Mercado Pago | Ver `docs/payments.md`. |
| Notificaciones | Tabla `notifications` (internas) + **outbox persistente** (email, WhatsApp, celular) con lease, reintentos con backoff y jitter, y reintento manual | No se pierden eventos si falla un envío y nunca se espera a la red con filas bloqueadas (`src/server/outbox/lease.ts`). |
| Asistente | Reglas locales + adaptador opcional de Claude (servidor, salida validada) | Funciona sin servicios externos. |
| Pruebas | Vitest: unitarias + integración contra Postgres real | Reglas de negocio, concurrencia, RLS, webhooks. |

### Desvío respecto del brief: Supabase Auth
El brief sugiere Supabase Auth. El MVP usa **sesiones propias** sobre la misma base porque:
1. El recorrido completo se puede ejecutar y probar localmente sin la pila de Supabase (GoTrue) ni credenciales.
2. La autorización vive en el servidor y en funciones SQL (`app.*`) que reciben el id de usuario; migrar a Supabase Auth implica mapear `auth.uid()` → `app.uid()` (una función) y reemplazar `src/server/auth/session.ts`.
3. No se almacenan contraseñas en claro, los tokens de sesión se guardan hasheados y el login tiene límite de frecuencia persistente.
Pasos para migrar a Supabase Auth: ver `docs/implementation-plan.md` → Pendientes.

## Monolito modular
```
src/
  app/                    Rutas (UI + server actions + route handlers)
    (public)/             Landing, ofrecé tus servicios, perfiles públicos, legales
    (auth)/               Ingresar, registro
    solicitar/            Asistente de pedido (sin cuenta)
    app/                  Panel cliente y organizaciones
    proveedor/            Panel proveedor
    admin/                Panel de operación y administración
    pagos/prueba/         Checkout simulado (solo modo de prueba)
    api/                  files, webhooks de pagos, cron, export CSV
  server/
    db/client.ts          Conexión; systemTx (servidor) y asUser (rol fixy_app + RLS)
    auth/                 Sesiones, actor, contraseñas
    domain/               Dinero, máquinas de estado, errores, etiquetas (sin dependencias de UI)
    modules/              Servicios: providers, properties, requests (+matching), quotes, jobs, payments, messaging, disputes, users, admin, catalog, authz
    payments/             Interfaz de pasarela + adaptadores (mock, mercadopago)
    notifications/        Notificaciones internas, outbox, adaptador de email
    storage/              Archivos privados + URLs firmadas
    assistant/            Reglas + adaptador Claude
    queries/              Lecturas para paneles (bajo RLS)
    seed/                 Datos base y de demostración
  components/             UI accesible + componentes de dominio
db/migrations/            0001 esquema · 0002 integridad · 0003 acceso/RLS · 0004 vistas públicas · 0005 endurecimiento Supabase
tests/                    unit/ + integration/
```
Las reglas de negocio están en `src/server/modules` y `src/server/domain`, nunca en componentes visuales.

## Autorización en dos capas
1. **Servidor**: cada servicio recibe el `Actor` autenticado (de la cookie de sesión; nunca de parámetros del navegador) y verifica permisos llamando a funciones SQL `app.is_request_client(uid, id)`, `app.is_job_provider(uid, id)`, `app.provider_role(uid, pid)`, `app.org_role(uid, org)`, etc. También valida el estado previo con las máquinas de estado.
2. **Base de datos**:
   - **RLS** en todas las tablas con datos de usuarios. Las lecturas de los paneles corren con `asUser(userId)`: transacción de solo lectura, `SET LOCAL ROLE fixy_app` y `app.user_id` en la sesión; las políticas usan las mismas funciones `app.*` con `app.uid()`.
   - **Triggers** que hacen cumplir transiciones válidas (`app.allowed_transitions`), inmutabilidad del contrato y de importes, append-only del registro financiero/auditoría/mensajes, balance contable por transacción, proveedor aprobado para invitaciones y trabajos, reseña solo de trabajo completado.
   - **Restricciones**: una orden por solicitud, un presupuesto aceptado por solicitud, un cobro vivo por concepto, una reseña por trabajo, un reclamo abierto por trabajo, una reprogramación abierta por trabajo, montos coherentes (CHECK).
Las escrituras se hacen con el rol propietario (equivalente a service role) **solo dentro de servicios que ya autorizaron al actor**. El rol `fixy_app` no tiene privilegios de escritura.

## Flujo de una acción
`Formulario (client)` → `server action` (`act()` traduce errores) → `requireActor()` → `servicio(actor, input)` → Zod → autorización (`app.*`) → `systemTx` con `SELECT … FOR UPDATE` → transición validada → escrituras + `entity_events` + `audit_log` + `notifications`/`outbox` en la **misma transacción** → `revalidatePath`.

## Concurrencia
- Aceptar presupuesto: bloqueo de la fila de la solicitud (`FOR UPDATE`) + índice único `jobs.request_id` + índice parcial de presupuesto aceptado. Doble clic sobre el mismo presupuesto es idempotente (devuelve el trabajo existente).
- Webhooks: `payment_events (gateway, external_event_id)` único; el cobro se bloquea al aplicar; `status_rank` descarta eventos fuera de orden.
- Outbox: `FOR UPDATE SKIP LOCKED`.

## Seguridad y privacidad
- Contraseñas con scrypt; sesiones con token aleatorio (hash en BD), cookie httpOnly/SameSite=Lax/Secure en producción.
- Límites de frecuencia persistentes (login, registro, asistente).
- Archivos: tipo validado por contenido (magic bytes), máx. 8 MB, JPG/PNG/WEBP/PDF, nombres saneados, privados por defecto, descarga con URL firmada HMAC de 5–15 min emitida solo después de verificar acceso bajo RLS. Documentos de proveedores nunca públicos.
- Redirecciones solo internas (`safeNext`). Exportación CSV protegida contra inyección de fórmulas.
- Encabezados: `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`; CSP estricta en descargas.
- Logs sin datos personales (emails enmascarados; no se loguean documentos ni payloads completos).
- Datos sensibles separados: `request_private` (acceso), `properties` (dirección) con RLS de revelado; vistas `provider_public` y `user_names` sin datos privados.
- Secretos solo en variables de entorno; `.env*` ignorado por git; `.env.example` sin valores reales.
- Selector de cuentas demo deshabilitado siempre en `NODE_ENV=production`.
- En Supabase, la migración 0005 revoca los privilegios por defecto de `anon`/`authenticated` (la app no usa la API REST).

## Respaldo y restauración
- Producción en Supabase: backups diarios del plan (verificar plan contratado) + recomendación de PITR para datos financieros.
- Procedimiento manual: `pg_dump --format=custom "$DATABASE_URL" > fixy-$(date +%F).dump`; restauración en una base nueva con `pg_restore --no-owner -d "$NEW_DATABASE_URL" fixy-YYYY-MM-DD.dump` y luego `npm run db:migrate`.
- Storage: el bucket privado se respalda aparte (Supabase no lo incluye en el dump SQL).
- Probar la restauración en un proyecto de staging antes del lanzamiento.

## Entornos
- `development`: Docker local, pagos simulados, accesos demo.
- `test`: base `fixy_test` recreada en cada corrida de pruebas.
- `staging`/`production`: proyectos Supabase separados, variables separadas, `DEMO_MODE=false`. Nunca compartir base ni bucket entre entornos.
