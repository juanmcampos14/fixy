# Operación: guías, objetivos de servicio y recuperación

Todo se ve en **Operación → Salud del sistema** (tareas, colas, avisos sin enviar, alertas) y, para pagos, en
**Finanzas → Conciliación** (`docs/payments-runbooks.md`). Las alertas le llegan al equipo (admin y operación) en la
campanita y por email, como máximo cada 6 horas mientras sigan abiertas.

## Objetivos de servicio (iniciales)
| Qué | Objetivo | Cómo se mide |
|---|---|---|
| Disponibilidad de la web | 99,5 % mensual | Monitor externo sobre `/api/health` cada 1 min |
| Páginas públicas | p95 < 800 ms | Prueba de carga (`scripts/load/run.mjs`) y Vercel Analytics |
| Avisos (email, WhatsApp, celular) | 95 % enviados en < 10 min | Salud → "Más viejo" < 30 min; alerta `outbox_backlog` |
| Avisos de pago (webhooks) | aplicados en < 1 min | Último aviso de pago recibido; conciliación cada 10 min |
| Tareas programadas | sin 3 fallas seguidas | Alerta `cron_<tarea>` |
| Diferencias de pagos | 0 críticas abiertas > 1 día hábil | Finanzas → Conciliación |

## Alertas y qué hacer
### Avisos demorados (`outbox_backlog`)
El aviso más viejo espera más de 30 min. Mirá en Salud qué canal tiene "Esperando"/"Reintentando".
- **Email:** estado de Resend (resend.com/status) y que `RESEND_API_KEY` siga vigente.
- **WhatsApp:** Meta caído o token vencido (WhatsApp → Plantillas muestra el error); revisá `WHATSAPP_ACCESS_TOKEN`.
- **Celular:** FCM/APNs; revisá `FIREBASE_SERVICE_ACCOUNT`.
Cuando el proveedor vuelve, la cola se vacía sola (por tandas, hasta ~70 s por canal en cada corrida).

### Avisos que no se pudieron enviar (`outbox_dead`)
Fallaron todos sus intentos. En Salud → "Avisos que no se pudieron enviar" está el error de cada uno. Resolvé la causa
(número sin WhatsApp, email rebotado, plantilla rechazada) y usá **Reintentar**. Si no se puede, avisale a la persona por
otro medio: el aviso también quedó en su campanita.

### Tarea con fallas (`cron_<tarea>`)
Tres corridas seguidas fallaron o hace mucho que no termina bien. El error está en Salud → Tareas y en los logs de Vercel
(buscá `"event":"cron.failed"`). Probá **Ejecutar ahora**. Si depende de un servicio externo caído, esperá; si es un
error de código, revertí el último despliegue (Vercel → Deployments → Promote del anterior).

### Diferencias de pagos (`payment_incidents`)
Ver `docs/payments-runbooks.md`.

## Monitoreo externo (pendiente de configurar)
1. Crear un monitor HTTP gratis (UptimeRobot o Better Stack) sobre `https://www.fixy.solutions/api/health`, cada 1 min,
   que avise por email/WhatsApp si responde distinto de 200.
2. Errores de código: conectar Sentry (o el log drain de Vercel a Better Stack/Axiom). Los logs ya son JSON de una línea
   (`src/server/ops/log.ts`), sin datos personales; los ids de usuario van seudonimizados.

## Copias de seguridad y restauración
- **Base de datos (Supabase):** el plan Pro hace copias diarias (7 días). Para recuperar a un minuto exacto hace falta
  el agregado PITR. Recomendado antes de operar con volumen: PITR de 7 días.
- **Archivos (Supabase Storage):** no entran en las copias de la base. Copia semanal del bucket `fixy-private` a otro
  proveedor (por ejemplo, con `rclone` a un bucket S3/R2 con versionado).
- **Ensayo de restauración (cada 3 meses y antes de crecer):**
  1. En Supabase, restaurar la copia más reciente en un proyecto **de staging** (nunca sobre producción).
  2. Apuntar un despliegue de staging a esa base y correr `npm run db:migrate` (no debería aplicar nada).
  3. Verificar: ingresar, ver un trabajo con pagos, Finanzas → Conciliación sin incidencias nuevas.
  4. Anotar el RPO (cuántos datos se perdieron: hora de la copia) y el RTO (cuánto tardó todo). Objetivo inicial:
     RPO ≤ 24 h (≤ 5 min con PITR) y RTO ≤ 4 h.

## Entorno de prueba (staging), pendiente de crear
1. Nuevo proyecto en Supabase (`fixy-staging`), aplicar `db/supabase-init.sql`.
2. En Vercel, entorno **Preview** con sus propias variables: base de staging, `MERCADOPAGO_MODE=test` con credenciales de
   prueba, `EMAIL_ADAPTER=console`, sin token de WhatsApp (modo simulado), `MFA_ENCRYPTION_KEY` distinta.
3. Cada pull request se despliega como preview contra staging; a `main` solo se mergea con CI en verde.
4. Protección de rama en GitHub: Settings → Branches → `main` → "Require status checks to pass" (CI) y "Require a pull
   request before merging".

## Capacidad (medición del 22 oct 2026, build local)
Ver `docs/capacity.md`.
