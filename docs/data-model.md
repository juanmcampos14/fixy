# Modelo de datos

Migraciones: `db/migrations/0001_schema.sql` (tablas, FKs, CHECKs, índices), `0002_integrity.sql` (transiciones, inmutabilidad, balance contable), `0003_access.sql` (rol `fixy_app`, funciones de acceso, RLS), `0004_public_views.sql`, `0005_supabase_hardening.sql`.

## Entidades por módulo
| Módulo | Tablas | Notas |
|---|---|---|
| Identidad | `users`, `sessions`, `rate_limits`, `policy_documents`, `policy_acceptances` | Email único sin distinguir mayúsculas. `platform_role` solo `operator`/`admin`, nunca desde el registro. Políticas versionadas (borradores). |
| Organizaciones y propiedades | `organizations`, `organization_members`, `properties` | Propiedad pertenece a un usuario **o** a una organización (CHECK). `approval_limit_minor` preparado para aprobaciones por monto. |
| Catálogo y cobertura | `zones`, `categories`, `services`, `service_questions`, `credential_types`, `category_required_credentials`, `commission_rules`, `platform_settings` | Todo administrable. `services.pricing_mode` fixed/quote/diagnostic con precios de referencia. Una regla de comisión activa por alcance (índice único parcial). |
| Proveedores | `providers`, `provider_members`, `provider_categories`, `provider_zones`, `provider_availability`, `provider_portfolio`, `provider_documents` | Estados separados: `status`, `identity_status`, `payouts_status`, documentos con `status` y `expires_on`. CUIT/facturación/cuenta de cobro privados (vista `provider_public` para terceros). |
| Archivos | `files` | `visibility` private/public, `purpose`, `owner_type/owner_id` para autorizar, `sha256`, tamaño ≤ 10 MB (CHECK). |
| Solicitudes y matching | `request_drafts`, `service_requests`, `request_private`, `request_attachments`, `request_invitations` | Código legible `S-1001`. Datos de acceso en `request_private`. Invitaciones con `rank_position`, `rank_score`, `rank_reasons`, origen (matching/cliente/operador) y respuesta. |
| Presupuestos | `quotes`, `quote_items` | Importes desglosados + tasas aplicadas; CHECKs de coherencia (subtotal, total, neto). Índices: un presupuesto vigente por proveedor y solicitud; uno aceptado por solicitud. |
| Trabajos | `jobs`, `job_extras`, `job_reschedules`, `job_evidence`, `entity_events` | `jobs.request_id` y `jobs.quote_id` únicos (una orden por solicitud). `contract_snapshot` inmutable. Una reprogramación abierta por trabajo. `entity_events`: línea de tiempo e historial de estados de todas las entidades (append-only). |
| Mensajería | `conversations`, `messages`, `conversation_reads` | Una conversación por (solicitud, proveedor) que continúa en el trabajo. Mensajes inmutables, adjuntos privados. |
| Pagos | `charges`, `payment_events`, `refunds`, `payouts`, `ledger_entries`, `mock_gateway_*` | Cobro único vivo por concepto; `status_rank` para orden; eventos únicos por id externo; reembolsos con idempotency key; una liquidación por trabajo con `amount = gross − fee + adjustments` (CHECK); registro de doble entrada balanceado e inmutable. |
| Reclamos y reseñas | `disputes`, `dispute_messages`, `reviews` | Un reclamo abierto por trabajo; notas internas; reseña única por trabajo completado (trigger). |
| Notificaciones | `notifications`, `outbox`, `delivery_attempts` | Outbox con reintentos/backoff y estado `dead` tras 6 intentos. |
| Auditoría | `audit_log` | Append-only: actor, rol, acción, entidad, motivo, datos (sin PII sensible). |

## Aislamiento
- Por organización: `app.org_role(uid, org)`; miembros comunes solo ven lo que crearon o tienen como responsables (`app.is_request_client`).
- Por proveedor: `app.provider_role(uid, provider)`; técnicos solo trabajos asignados (`app.is_job_provider`); finanzas solo administradores (`app.can_see_provider_finance`).
- Revelado de datos sensibles: `app.is_revealed_provider(uid, request)` (contratado + cobro inicial aprobado).
- Pruebas de políticas: `tests/integration/rules.test.ts` ("aislamiento y permisos").

## Índices principales
Búsquedas por estado (`service_requests_status_idx`, `jobs_provider_idx (provider_id,status)`, `providers_status_idx`), por dueño (`properties_owner_idx`, `service_requests_creator_idx`), invitaciones por proveedor y estado, mensajes por conversación y fecha, eventos por entidad, notificaciones por usuario y fecha, outbox pendiente (parcial), ledger por trabajo/proveedor/transacción.

## Preparado para evolucionar
Anticipos/saldos (`charges.kind`), aprobaciones por monto (`approval_limit_minor`), centros de costo (agregar `cost_center_id` a `service_requests`), mantenimiento recurrente (nueva tabla de planes que genere solicitudes), varias monedas (columna `currency` en todos los importes), nuevas pasarelas (`gateway` en cobros y liquidaciones).
