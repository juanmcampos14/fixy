# Máquinas de estado

Fuente: `src/server/domain/state-machines.ts` (actores) y `db/migrations/0002_integrity.sql` (`app.allowed_transitions`, aplicado por triggers). Cada transición registra un evento en `entity_events` (actor, rol, motivo, fecha). Toda transición valida actor, permisos y estado previo.

## Solicitud (`service_requests.status`)
| Desde | Hacia | Actor | Cuándo |
|---|---|---|---|
| draft | submitted | cliente | Envío del pedido |
| draft | cancelled | cliente | |
| submitted | searching | sistema / operación | Matching invitó al menos un proveedor |
| submitted | no_coverage | sistema / operación | Sin candidatos elegibles |
| submitted | cancelled | cliente / operación | |
| searching | with_quotes | sistema | Llegó el primer presupuesto |
| searching | no_coverage | sistema / operación | Todos declinaron y no hay más candidatos |
| searching | cancelled | cliente / operación | |
| no_coverage | searching | operación / sistema | Invitación manual o nuevo matching |
| no_coverage | cancelled | cliente / operación | |
| with_quotes | converted | cliente | Aceptación de un presupuesto |
| with_quotes | searching | sistema / operación | No quedan presupuestos vigentes |
| with_quotes | cancelled | cliente / operación | |
`needs_review` (flag) marca pedidos en revisión humana ("otro", categoría no identificada, proveedor elegido no elegible).

## Presupuesto (`quotes.status`)
| Desde | Hacia | Actor |
|---|---|---|
| draft | sent | proveedor (admin) |
| draft | withdrawn | proveedor |
| sent | accepted | cliente (atómico, crea la orden) |
| sent | rejected | cliente / sistema (se eligió otro, solicitud cancelada) |
| sent | expired | sistema (vigencia vencida; job periódico o al intentar aceptar) |
| sent | withdrawn | proveedor / operación |
Un presupuesto enviado no puede cambiar importes, alcance, exclusiones, modo ni vigencia (trigger).

## Trabajo (`jobs.status`)
| Desde | Hacia | Actor | Condiciones |
|---|---|---|---|
| pending_confirmation | confirmed | proveedor (admin) | Cobro inicial aprobado; proveedor aprobado |
| pending_confirmation | cancelled | cliente / proveedor / operación | Reintegro total automático de lo cobrado (cliente/proveedor) |
| confirmed | on_the_way | proveedor / técnico asignado | |
| confirmed, on_the_way | in_progress | proveedor / técnico asignado | |
| in_progress | pending_approval | proveedor / técnico | Sin adicionales pendientes de respuesta |
| pending_approval | completed | cliente / operación | Sin reclamo abierto (cliente), adicionales aceptados pagados. Genera liquidación pendiente |
| pending_approval | in_progress | operación | Ej.: resolución de reclamo "rehacer trabajo" |
| confirmed…pending_approval | cancelled | operación | Con motivo; reembolso opcional y auditado |
El contrato (`contract_snapshot`, totales, partes) es inmutable (trigger). Adicionales (`job_extras`: proposed → accepted/rejected/withdrawn) y reprogramaciones (`job_reschedules`: proposed → accepted/rejected/withdrawn; acepta la otra parte) conservan historial.

## Cobro (`charges.status`)
| Desde | Hacia | Actor |
|---|---|---|
| pending | processing / approved / failed | sistema (webhook + consulta verificada) |
| processing | approved / failed | sistema |
| approved | partially_refunded / refunded | sistema (reembolso iniciado por operación) |
| partially_refunded | refunded | sistema |
`status_rank` (pending 0 < processing 1 < failed 2 < approved 3 < partially_refunded 4 < refunded 5) descarta eventos fuera de orden. Un cobro fallido no se reactiva: se crea un nuevo cobro (reintento).

## Liquidación (`payouts.status`)
| Desde | Hacia | Actor |
|---|---|---|
| pending | scheduled | operación / sistema |
| scheduled | processing | sistema / operación |
| scheduled | pending | operación |
| processing | paid / failed | sistema (resultado de la transferencia) |
| failed | scheduled | operación (reintento) |
| paid | reversed | operación (solo si la pasarela lo permite) |
`on_hold` (pausa) es independiente del estado: se activa al abrir un reclamo y se libera al resolverlo (salvo reembolso total).

## Reclamo (`disputes.status`)
| Desde | Hacia | Actor |
|---|---|---|
| open | in_review / awaiting_response / resolved / closed | operación |
| in_review | awaiting_response / resolved / closed | operación |
| awaiting_response | in_review | operación / sistema (respuesta de una parte) |
| awaiting_response | resolved / closed | operación |
| resolved | closed / in_review | operación |
Resoluciones: sin acción, reembolso parcial/total (vinculado a los cobros originales), rehacer trabajo, a favor del profesional, otra.

## Proveedor (`providers.status`) — estado operativo
| Desde | Hacia | Actor |
|---|---|---|
| pending | in_review | proveedor (envía con checklist completo) |
| in_review | approved | operación (identidad verificada + credenciales obligatorias aprobadas y vigentes) |
| in_review | pending | operación (observaciones) |
| in_review | rejected | operación |
| approved | suspended | operación |
| suspended | approved | operación |
| rejected | pending | proveedor (corrige y reenvía) |
Estados separados: `identity_status` (unverified/pending/verified/rejected), credenciales por documento (`provider_documents.status` + `expires_on`), `payouts_status` (not_started/pending/enabled/disabled). Para recibir oportunidades: aprobado + identidad verificada + cobros habilitados + credenciales requeridas vigentes + acepta trabajos + disponibilidad declarada + categoría y zona.

## Reglas transversales
- Aceptar presupuesto es atómico; doble clic/concurrencia → una sola orden.
- Un cobro aprobado no significa trabajo completado; un trabajo completado no significa liquidación realizada.
- Reseña: una por trabajo completado, solo del cliente.
- Proveedores suspendidos no reciben invitaciones ni trabajos nuevos (también por trigger).
