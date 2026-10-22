---
name: fixy-scale-operations
description: Preparar Fixy para crecer con operación fiable sin reescribir el monolito. Usar al desacoplar outboxes y cron, implantar workers con leases, CI/CD, observabilidad, SLO, límites de módulos, repositorios RLS, pruebas de carga, backups, archivos seguros y hardening de las apps Capacitor.
---

# Preparar Fixy para escalar

Evolucionar el monolito modular existente. No crear microservicios por defecto. Primero mejorar límites internos, colas, observabilidad, despliegue y recuperación; extraer un servicio sólo si las mediciones demuestran una necesidad independiente de escala o aislamiento.

## Resultado obligatorio

Entregar una plataforma donde:

- las tareas lentas y externas no bloqueen transacciones ni peticiones web;
- cada proceso programado se pueda observar, reintentar y escalar por separado;
- ningún cambio llegue a producción sin controles automáticos;
- el equipo pueda detectar, diagnosticar y reparar incidentes;
- las lecturas sensibles usen límites de datos coherentes;
- exista evidencia de capacidad, backup y recuperación.

## Principios

- Medir antes de optimizar.
- Mantener PostgreSQL como fuente de verdad.
- Usar transacciones cortas y efectos externos asíncronos.
- Diseñar todos los jobs como idempotentes y recuperables.
- Tratar backlog, edad de cola y dead letters como métricas de negocio.
- Preservar compatibilidad durante migraciones y despliegues graduales.
- No introducir Kafka, Kubernetes o microservicios sin un problema medido que lo justifique.
- No ocultar fallos con `catch` genéricos; clasificar, registrar y alertar.

## Contexto que se debe inspeccionar

Leer antes de modificar:

- `AGENTS.md`, `docs/architecture.md`, `docs/deployment.md` y `docs/state-machines.md`.
- `src/app/api/cron/outbox/route.ts`.
- `src/server/notifications/`, `src/server/whatsapp/outbox.ts` y `src/server/push/`.
- `src/server/db/client.ts`, `src/server/queries/` y rutas que importen `sql()`.
- Módulos grandes: `payments.ts`, `requests.ts`, `providers.ts`, `jobs.ts`, `quotes.ts` y el bot de WhatsApp.
- `next.config.ts`, `vercel.json`, `mobile/`, configuración de pruebas y Semgrep.
- Migraciones de outbox, delivery attempts, RLS, audit log y entity events.

Medir líneas, dependencias entre módulos, tiempos de jobs, tamaños de lote, consultas lentas, conexiones y backlog antes de elegir cambios.

## Flujo de trabajo

### 1. Crear una línea base medible

- Ejecutar typecheck, lint, unitarias, integración y reglas estáticas.
- Registrar tiempos de endpoints críticos y jobs con datos de prueba representativos.
- Medir pool de conexiones, duración de transacciones, locks, backlog y edad del elemento más antiguo.
- Definir SLO iniciales para disponibilidad, latencia, errores, webhooks y procesamiento de colas.
- Crear un inventario de tareas cron y su dependencia de servicios externos.

### 2. Rediseñar los workers de notificaciones

Sustituir el patrón “lock + llamada de red” por:

```text
transacción corta: reclamar filas + lease + estado processing
-> commit
-> enviar fuera de la transacción
-> transacción corta: sent, retryable o dead
```

Requisitos:

- lease con expiración y recuperación de workers caídos;
- backoff exponencial con jitter;
- límite de intentos y dead-letter visible;
- deduplicación por mensaje/canal/destinatario;
- timeouts y límites de concurrencia por proveedor;
- replay seguro con auditoría;
- métricas de throughput, error, backlog y antigüedad.

Aplicar a email, WhatsApp y push sin cambiar su semántica de negocio.

### 3. Separar el cron monolítico

- Dividir matching, vencimientos, reseñas, plantillas, email, WhatsApp, push y conciliación en tareas independientes.
- Permitir que una tarea falle sin impedir las demás.
- Autenticar cada entrada programada con secreto rotatorio o mecanismo nativo del proveedor.
- Añadir ejecución manual segura para operación y pruebas.
- Evitar solapamientos con advisory locks, leases o claves de ejecución.
- Configurar lotes y concurrencia mediante entorno, con límites conservadores.

### 4. Implantar observabilidad útil

- Logs estructurados JSON con `request_id`, `job_id`, `user_id` seudonimizado, operación y duración.
- Propagar correlation IDs desde petición a outbox, worker, webhook y ledger.
- Integrar seguimiento de errores y trazas en servidor y jobs.
- Exponer métricas: latencia p50/p95/p99, tasa de error, saturación de pool, locks, backlog, edad de cola, dead jobs, discrepancias de pago y webhooks atrasados.
- Crear alertas accionables con umbral, responsable y runbook.
- No incluir tokens, contenido privado de mensajes, documentos ni direcciones en telemetría.

### 5. Crear CI/CD bloqueante

Configurar una pipeline que ejecute en cada pull request:

1. instalación reproducible con lockfile;
2. typecheck y lint;
3. pruebas unitarias;
4. integración contra PostgreSQL real y migraciones desde cero;
5. Semgrep de arquitectura y seguridad;
6. auditoría de dependencias runtime y desarrollo;
7. detección de secretos;
8. build de producción;
9. comprobación de migración hacia delante y compatibilidad de despliegue.

Usar staging separado para base, storage, claves y webhooks. Exigir aprobación para producción y registrar rollback.

### 6. Reforzar límites del monolito

- Dividir módulos grandes por caso de uso, no por cantidad arbitraria de archivos.
- Mantener interfaces explícitas entre solicitudes, trabajos, pagos, disputas y notificaciones.
- Centralizar cada transición de estado en un único servicio público.
- Impedir actualizaciones directas de estado fuera del servicio mediante regla estática y triggers.
- Crear repositorios por contexto; las páginas no deben consultar tablas sensibles con `sql()` propietario.
- Mantener lecturas de usuario bajo `asUser()` y RLS; documentar excepciones de sistema.
- No cambiar comportamiento y arquitectura profunda en el mismo commit sin pruebas de caracterización.

### 7. Endurecer recursos y clientes móviles

- Aplicar CSP global con nonce/hash, HSTS y cabeceras adicionales verificadas en staging.
- Rechazar o re-codificar imágenes si falla la eliminación de metadatos.
- Poner PDFs en cuarentena y escanearlos antes de exponerlos.
- Evaluar streaming o URLs firmadas del storage después de autorizar, sin volver públicos los archivos.
- En Android, definir backup rules seguras, activar R8/minify para release y retirar certificados debug de asociaciones productivas.
- En iOS, completar Team ID, entitlements y configuración de producción.
- Minimizar `allowNavigation` y revisar qué plugins nativos quedan accesibles al contenido web remoto.

### 8. Probar capacidad y recuperación

- Crear escenarios de carga para login, búsqueda, solicitud, presupuesto, webhook, mensajes y workers.
- Probar picos, degradación de proveedores externos y backlog acumulado.
- Verificar que el pool no se multiplique sin control en serverless.
- Definir presupuestos de timeout y límites de payload.
- Configurar backups/PITR según el plan contratado y respaldar storage por separado.
- Ejecutar un restore drill en staging y medir RPO/RTO reales.
- Realizar pentest del entorno desplegado antes de lanzamiento abierto.

## Criterios de aceptación

No declarar preparada para escala hasta que:

- no haya llamadas de red mientras se mantienen locks de outbox;
- cada tarea programada tenga aislamiento, idempotencia, métricas y replay;
- CI bloquee cambios con pruebas, seguridad o migraciones fallidas;
- exista dashboard para salud de web, DB, colas, webhooks y pagos;
- las alertas importantes tengan responsable y runbook probado;
- no existan transiciones de estado directas fuera de los servicios permitidos;
- rutas sensibles lean bajo RLS o una excepción revisada;
- una prueba de carga cumpla SLO acordados con margen;
- un restore drill cumpla RPO/RTO acordados;
- staging y producción estén separados y el rollback haya sido ensayado.

## Entrega al programador

Producir:

1. arquitectura objetivo y decisiones ADR breves;
2. migraciones y workers con despliegue gradual;
3. pipeline CI/CD y políticas de branch;
4. instrumentación, dashboards, alertas y runbooks;
5. pruebas de carga y reporte de capacidad;
6. evidencia de backup/restore;
7. lista priorizada de deuda que permanece, con propietario y criterio de cierre.

