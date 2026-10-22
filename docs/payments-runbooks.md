# Pagos: guías de operación y activación de dinero real

Para quien opera Finanzas. Todo se hace desde **Operación → Finanzas → Conciliación**: nunca editando la base a mano.
Cada acción queda en la auditoría. Diseño técnico: `docs/payments.md` → "Operaciones con la pasarela".

## El tablero
- **Cobros pendientes +1 h**: clientes que abrieron el pago y no terminaron, o avisos de la pasarela que no llegaron.
  La conciliación los revisa sola cada 10 minutos.
- **Operaciones en cola**: pedidos a la pasarela que se están reintentando. "Sin procesar" = murieron: hay incidencia.
- **Reembolsos**: pendientes de confirmar por la pasarela y fallidos en total.
- **Sin conciliar +2 días**: cobros aprobados que la conciliación todavía no revisó (si sube, revisar el cron).
- **Conciliar ahora**: revisa los próximos 100 cobros contra la pasarela.

## Incidencias y qué hacer

### Monto o moneda distintos (crítica)
La pasarela informa un pago por otro importe que el cobro. **No se aplica nunca solo.**
1. Abrí el pago en Mercado Pago (Actividad → buscar la referencia `FXY-…`).
2. Si el cliente pagó de más o de menos, devolvé el pago completo desde Mercado Pago y pedile que vuelva a pagar desde
   el trabajo. «Re-sincronizar» registra la devolución.
3. Marcá la incidencia como resuelta contando qué hiciste.

### Cobro aprobado que la pasarela no confirma (crítica)
Fixy tiene el cobro como aprobado pero la pasarela no muestra ese pago aprobado (anulado, rechazado tarde o error).
1. Buscá la referencia en Mercado Pago. Si el pago existe y está acreditado, «Re-sincronizar» y resolvé.
2. Si no existe o fue anulado: **no liberes la liquidación** (retenela desde Liquidaciones), avisá al cliente y
   escalá a administración: hace falta un ajuste contable compensatorio (Finanzas → Registro → Ajuste manual).

### Reembolso registrado que la pasarela no tiene (crítica)
Fixy registró una devolución que la pasarela no muestra.
1. Revisá en Mercado Pago si la devolución existe (pudo revertirse).
2. Si no se hizo, hacela desde Mercado Pago por el mismo importe y «Re-sincronizar».

### Operación con la pasarela sin procesar (crítica para reembolsos, atención para links de pago)
La pasarela rechazó la operación o no respondió durante ~2 horas de reintentos.
- **Reembolso**: primero «Re-sincronizar» el cobro (si la pasarela sí lo hizo, se registra solo). Si no, «Reintentar»:
  usa la misma clave, así que la pasarela no lo duplica. Si vuelve a fallar, mirá el error en el detalle (saldo
  insuficiente en la cuenta, pago de más de 180 días, etc.) y hacelo a mano desde Mercado Pago.
- **Link de pago**: el cobro quedó fallido y el cliente ve "Reintentar pago". No hay que hacer nada más que resolver.
- **Devolución de pago duplicado**: «Reintentar». Si falla, devolvelo desde Mercado Pago.

### Operación con la pasarela demorada (atención)
Se está reintentando hace más de una hora. Suele ser Mercado Pago caído o lento: mirá https://status.mercadopago.com.
Se resuelve sola; si pasa a "sin procesar", seguí la guía anterior.

## Situaciones frecuentes

### Pago huérfano (el cliente pagó dos veces o pagó un link viejo)
Se devuelve completo de forma automática y el cliente recibe un aviso. Verás la auditoría `payment.orphan_refunded`.
Si no se pudo devolver, aparece como incidencia "Devolución de pago duplicado".

### Contracargo
Mercado Pago avisa: Fixy retiene la liquidación del profesional y registra el contracargo como reembolso. Si el
profesional ya había cobrado, queda un recupero que se descuenta de su próximo retiro. Respondé la disputa en Mercado Pago.

### Liquidación bloqueada
Una liquidación no se paga si: está retenida (reclamo o contracargo), falta la reseña del cliente, el trabajo no está
completado o es parte de un retiro. Los retiros se transfieren por banco y se registran en Retiros con la referencia.

## Checklist para operar con dinero real

Técnico (hecho en la Etapa 1):
- [x] Ninguna llamada a la pasarela con transacción abierta (Semgrep lo bloquea en CI).
- [x] Cobro, reembolso, devolución de duplicados y transferencias con intención durable, procesador y clave idempotente.
- [x] Conciliación contra la pasarela real por referencia, programada y manual, con incidencias y avisos al equipo.
- [x] Pruebas de fallas repetibles (timeouts, rechazos, concurrencia, leases, avisos fuera de orden).
- [x] Tablero de salud y reintento manual sin editar datos.

Antes de ampliar el volumen (decisión de la empresa):
- [ ] Ensayo en modo prueba (`MERCADOPAGO_MODE=test`) de: pago, reembolso parcial, reembolso total, pago duplicado y
      conciliación manual, con evidencia (capturas del tablero y de Mercado Pago).
- [ ] Webhook de Mercado Pago en modo productivo apuntando a `/api/webhooks/payments/mercadopago`, solo "Pagos", con
      `MERCADOPAGO_WEBHOOK_SECRET` cargado (Finanzas muestra si falta).
- [ ] Revisión legal y contable del modelo de cobro y liquidación (custodia, facturación por cuenta y orden, retenciones).
- [ ] Definir quién revisa el tablero de Conciliación y con qué frecuencia (sugerido: todos los días hábiles).
- [ ] Doble control para reembolsos grandes y transferencias (Etapa 2: segundo factor para finanzas).

Volver a modo prueba (rollback): en Vercel, `MERCADOPAGO_MODE=test` y volver a desplegar. Ojo: con la credencial de
prueba la conciliación no puede consultar los cobros reales ya hechos; esos se revisan a mano en Mercado Pago.
