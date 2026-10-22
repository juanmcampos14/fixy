---
name: fixy-reliable-payments
description: Hacer fiables y escalables los pagos, reembolsos, contracargos, liquidaciones, retiros, webhooks y conciliación de Fixy. Usar al eliminar llamadas externas dentro de transacciones, implementar saga/outbox/inbox, completar Mercado Pago, garantizar idempotencia, reparar divergencias o preparar la plataforma para dinero real.
---

# Hacer fiables los pagos de Fixy

Tratar todo movimiento de dinero como una operación distribuida: PostgreSQL y Mercado Pago nunca comparten una transacción atómica. Diseñar para timeouts, respuestas duplicadas, eventos fuera de orden, éxito remoto con fallo local y fallo remoto con estado local pendiente.

## Resultado obligatorio

Entregar un flujo financiero donde:

- ninguna llamada de red ocurra dentro de una transacción SQL;
- cada intención financiera sea durable antes de llamar a la pasarela;
- todos los comandos y eventos sean idempotentes;
- el webhook sea sólo una fuente de confirmación, no la única;
- una conciliación real detecte y permita reparar diferencias;
- el ledger permanezca inmutable, balanceado y trazable;
- activar dinero real exija un checklist explícito y verificable.

## Reglas críticas

- Nunca ejecutar cobros, reembolsos o transferencias con credenciales live durante desarrollo o pruebas.
- Usar mock, sandbox o credenciales de prueba y bloquear `MERCADOPAGO_MODE=live` en test.
- No borrar ni reescribir cargos, reembolsos, payouts, ledger, payment events o auditoría.
- No reutilizar una clave idempotente para operaciones económicas distintas.
- No considerar exitoso un pago por el retorno del navegador.
- No confiar sólo en el payload del webhook: consultar la pasarela y verificar referencia, moneda e importe.
- No liberar dinero por una excepción silenciosa; toda reparación manual debe dejar auditoría y doble control cuando corresponda.

## Contexto que se debe inspeccionar

Leer antes de modificar:

- `src/server/modules/payments.ts`, `withdrawals.ts`, `jobs.ts`, `quotes.ts` y `disputes.ts`.
- `src/server/payments/gateway.ts`, `mercadopago.ts` y `mock.ts`.
- Webhook y rutas de retorno bajo `src/app/api/webhooks/payments/` y `src/app/pagos/`.
- Migraciones de charges, refunds, payouts, ledger, payment_events, recoveries, chargebacks y withdrawals.
- `docs/payments.md`, `docs/state-machines.md`, `docs/data-model.md` y documentación de Mercado Pago vigente.
- Pruebas de pagos, webhooks, concurrencia, ledger, reembolsos y retiros.

Buscar todas las llamadas a `createCheckout`, `refund`, `transfer`, `createPayoutAccount`, `mock_gateway_payments` y cualquier `fetch` dentro de `systemTx` o `begin`.

## Arquitectura objetivo

Aplicar este patrón a checkout, refund, payout account, transferencia y sincronización:

```text
acción de negocio
  -> transacción corta: validar + guardar intención
  -> worker reclama la intención con lease
  -> llamada externa con clave idempotente
  -> guardar respuesta/inbox
  -> transacción corta: aplicar estado + ledger + eventos
  -> conciliador compara Fixy con la pasarela
```

La implementación puede reutilizar la tabla outbox o crear una cola financiera separada. Elegir el diseño que conserve límites claros y facilite auditoría, reintento y prioridad.

## Flujo de trabajo

### 1. Modelar estados y contratos

- Inventariar todos los estados internos y externos.
- Definir comandos durables: `create_checkout`, `refund`, `transfer`, `sync_payment`, `create_payout_account`.
- Definir estados de ejecución: `pending`, `leased`, `succeeded`, `retryable`, `dead`, `cancelled`.
- Guardar idempotency key, proveedor, payload mínimo, intentos, lease, próximo intento, resultado externo y último error saneado.
- Proteger con índices únicos las operaciones económicas equivalentes.
- Versionar payloads si se guardan como JSON.

### 2. Separar red y transacción

- En la petición web, validar, calcular importes del servidor, crear el charge/intención y confirmar.
- Ejecutar la llamada externa después del commit mediante worker.
- Aplicar timeout, backoff con jitter, límite de intentos y clasificación entre error transitorio y permanente.
- Evitar locks durante la red. Reclamar con lease corto; permitir que otro worker recupere tareas abandonadas.
- Persistir primero la respuesta externa; luego aplicar cambios de dominio en una transacción breve.

### 3. Garantizar idempotencia

- Generar claves estables a partir de la operación de negocio, no del intento de red.
- Reusar la misma clave al reintentar la misma operación.
- Crear una nueva clave sólo cuando el usuario inicia una operación económica nueva y válida.
- Hacer idempotentes los consumidores, webhooks y pasos de ledger.
- Tratar respuestas ambiguas como `unknown` y resolverlas consultando la pasarela, no repitiendo a ciegas.

### 4. Completar Mercado Pago

- Implementar consultas reales por payment ID y external reference.
- Eliminar dependencias de `mock_gateway_payments` en conciliación y resincronización cuando el gateway no sea mock.
- Verificar firma sobre raw body, timestamp, event ID y secreto correcto.
- Consultar la API y comparar gateway, reference, amount, currency, payer y estado esperado.
- Mantener ranking de estados y descartar eventos atrasados sin perder auditoría.
- Documentar límites y capacidades reales de Checkout Pro, refunds y split/payout; no inventar una transferencia que el producto contratado no soporte.

### 5. Conciliar y reparar

Crear una conciliación programada que:

- compare charges internos con pagos externos;
- compare refunds, chargebacks y mediations;
- detecte aprobados sin charge aplicable, importes distintos, estados estancados y duplicados;
- abra una incidencia con severidad y responsable;
- permita resincronizar de forma idempotente;
- no modifique el ledger sin una regla contable explícita;
- conserve evidencia antes y después de una reparación manual.

Añadir vistas o métricas para: pendientes por edad, divergencias, dead jobs, reembolsos fallidos, payouts retenidos y saldo no conciliado.

### 6. Cerrar el modelo de liquidación

- Definir si Fixy cobra por cuenta propia, usa split marketplace o sólo registra pagos entre partes.
- Validar el modelo con responsables legales y contables antes de activar live.
- Separar disponibilidad contable, solicitud de retiro, aprobación y transferencia real.
- Aplicar doble aprobación o step-up en reembolsos y transferencias de alto riesgo.
- Conservar holds por reclamos, recuperos posteriores a payout y asientos compensatorios.

## Pruebas de fallos obligatorias

Simular al menos:

- timeout después de que la pasarela haya creado el pago;
- respuesta 500 antes y después de aceptar la operación;
- dos workers reclamando la misma intención;
- webhook duplicado, atrasado y fuera de orden;
- webhook con firma, importe, moneda o referencia inválidos;
- crash entre respuesta externa y actualización local;
- crash después de ledger pero antes de notificar;
- reembolso parcial repetido;
- pago aprobado para un charge cancelado o ya reemplazado;
- chargeback después de payout;
- conciliación cuando la pasarela no responde;
- reintento luego de expirar un lease.

Verificar que nunca haya doble cargo, doble refund, doble payout, ledger desbalanceado ni pérdida silenciosa.

## Criterios de aceptación para dinero real

No declarar listo para live hasta que:

- Semgrep no detecte I/O de pasarela dentro de transacciones;
- checkout, refund, payout y onboarding usen intención durable y worker;
- la conciliación consulte Mercado Pago real en sandbox;
- todas las pruebas de fallos pasen de forma repetible;
- exista dashboard y alerta para divergencias y dead jobs;
- haya un runbook de pago huérfano, refund fallido, chargeback y payout bloqueado;
- se haya ejecutado un ensayo de reparación sin editar datos manualmente;
- el modelo legal/contable y las capacidades contratadas estén confirmados;
- el cambio a `live` requiera una variable protegida y una aprobación operativa explícita.

## Entrega al programador

Producir:

1. diagrama de estados y secuencia final;
2. migraciones e índices con estrategia de despliegue gradual;
3. workers y adaptadores sin llamadas live;
4. pruebas unitarias, integración, concurrencia y fallos;
5. reconciliador, dashboard mínimo y comandos seguros de replay;
6. runbooks y checklist de activación/rollback;
7. lista de riesgos residuales y decisiones de negocio pendientes.

