# Pagos

> **Estado: MODO DE PRUEBA.** Ningún pago, reembolso ni liquidación de este MVP mueve dinero real. La integración con Mercado Pago **no está activada** ni verificada en producción. Investigación con fuentes oficiales: `docs/research/mercadopago.md` (consultada el 2026-10-08).

## Principios
- Contratación, adicionales, cobros, movimientos y reclamos suceden dentro de Fixy. No se usan transferencias directas al profesional ni links de pago creados por él.
- Si la pasarela requiere redirección (Checkout Pro), el pedido, el estado y la conciliación quedan en Fixy y la interfaz explica el paso.
- Importes calculados en el servidor, enteros en centavos, moneda explícita (`ARS`). Cálculo de tasas con BigInt y redondeo half-up (`src/server/domain/money.ts`).
- Un cobro solo se aprueba por **evento autenticado + consulta verificada** a la pasarela (nunca por la página de retorno).
- Webhooks idempotentes; duplicados y fuera de orden no tienen efecto; cada intento queda registrado (`payment_events`).
- Registro financiero de doble entrada **inmutable** (`ledger_entries`): cada transacción suma cero (trigger diferido); correcciones por ajustes o reversos con motivo y responsable.
- No se almacenan datos de tarjetas. No se promete custodia, retención ni "dinero protegido".

## Transparencia de precios
Cliente, antes de confirmar: mano de obra, materiales, visita/diagnóstico, cargo de servicio Fixy (con % y "lo pagás vos"), impuestos configurados (hoy: no aplica), total, exclusiones, vigencia y condiciones de cancelación y reembolso. El total confirmado en pantalla viaja con la aceptación y el servidor lo compara (si cambió, se rechaza).
Proveedor: importe bruto (su presupuesto), comisión Fixy, ajustes (reembolsos), neto, estado y fecha de liquidación.

### Modelo de comisión (configurable en `/admin/comisiones`)
`subtotal = mano de obra + materiales + visita`
`cargo cliente = subtotal × tasa_cliente` · `impuesto = cargo × tasa_impuesto`
`total cliente = subtotal + cargo + impuesto`
`comisión proveedor = subtotal × tasa_proveedor` · `neto proveedor = subtotal − comisión proveedor`
`ingreso plataforma = cargo cliente + comisión proveedor`
**Desde la migración 0016 la comisión al profesional es 0 %** (promesa comercial; la base rechaza otro valor con `commission_rules_provider_zero`). Por defecto: proveedor 0 %, cliente 5 %, impuesto 0 %. Los trabajos anteriores conservan la tasa con la que se cotizaron. Cada presupuesto guarda las tasas vigentes al enviarse; los adicionales usan las tasas del contrato.

## Modalidades
| Modalidad | Cobro (demo) |
|---|---|
| Visita de diagnóstico | Cobro de la visita al contratar (`kind = visit`). La reparación se cotiza después como **adicional**, con aceptación explícita y cobro separado. |
| Precio cerrado (servicio catalogado) | Cobro del total al aceptar, antes de que el proveedor confirme. |
| Presupuesto personalizado | Cobro del total al aceptar, antes de que el proveedor confirme. |
| Anticipo y saldo | Modelado (`kind = deposit/balance`) pero **no habilitado**: depende de la capacidad real de la pasarela. |
| Adicional | Aceptación explícita del cliente → cobro separado (`kind = extra`). |
| Liquidación | Evento simulado separado, ejecutado por operación, claramente identificado como simulado. |

## Flujo implementado (adaptador simulado)
1. Cliente acepta → `acceptQuote` crea la orden + `charges(pending)` con `external_reference` único + el comando `create_checkout` (sin llamar a la pasarela) → redirección a `/pagos/ir/<cobro>`, que crea el checkout fuera de la transacción y lleva a la pasarela (en prueba, `/pagos/prueba/<ref>`, pantalla marcada "MODO DE PRUEBA"). Ver "Operaciones con la pasarela".
2. "Simular pago aprobado/rechazado" cambia el estado **del lado de la pasarela simulada** y emite un webhook firmado (HMAC-SHA256 con timestamp y ventana anti-replay).
3. `processPaymentWebhook`: verifica firma → registra evento (único por id) → consulta el pago a la pasarela → valida referencia, monto y moneda → aplica la transición si avanza (`status_rank`) → asientos contables → notificaciones. El endpoint HTTP equivalente es `POST /api/webhooks/payments/mock`.
4. El proveedor confirma (requiere cobro aprobado) → ejecuta → el cliente da conformidad → se crea `payouts(pending)` con bruto, comisión, ajustes y neto. Si hay reclamo abierto, la liquidación queda en pausa.
5. Operación ejecuta la liquidación simulada (`executePayout`): pending → scheduled → processing (+ comando `transfer`) → paid cuando la pasarela confirma, con asiento contable.
6. Reembolsos (`refundCharge`, solo operación, con motivo): se registran **pendientes** y se encola el comando `refund`; recién cuando la pasarela confirma se aplican al cobro, al registro financiero y a las liquidaciones (o recupero si el profesional ya cobró). Los pendientes cuentan para no superar lo cobrado.
7. Conciliación (`/admin/finanzas?tab=conciliacion`): tablero de salud + incidencias abiertas; cada 10 minutos se consulta la pasarela por referencia y se repara lo reparable. Ver `docs/payments-runbooks.md`.

### Asientos contables
| Evento | Cuentas |
|---|---|
| Cobro aprobado | `gateway_clearing +total` · `platform_revenue −(cargo + comisión)` · `taxes_payable −impuesto` · `provider_payable −neto` |
| Reembolso X | `gateway_clearing −X` · `provider_payable +parte proveedor` · `platform_revenue +parte plataforma` |
| Liquidación pagada | `provider_payable +neto` · `gateway_clearing −neto` |
| Ajuste manual (admin) | `provider_payable` ↔ `platform_revenue`, con motivo |

Paneles: cliente (acordado, pagado, saldo, movimientos, comprobantes, reembolsos), proveedor (bruto, comisiones, neto, pendiente, liquidado, por trabajo), administración (cobros, comisiones, liquidaciones, reembolsos, contracargos, conciliación, registro). **Comprobante de pago ≠ factura fiscal** (la facturación queda pendiente de definición fiscal).

## Evaluación de Mercado Pago (resumen de `docs/research/mercadopago.md`)
- ✅ Marketplace con **Split de pagos 1:1** (Checkout Pro con `marketplace_fee`, Checkout API con `application_fee`). Cada proveedor vincula su cuenta MP por **OAuth** (cuenta vendedor nivel KYC 6; el KYC lo hace MP).
- ✅ El dinero se acredita **en la cuenta del proveedor** según los plazos de MP; la comisión del marketplace se separa automáticamente. Las comisiones de MP las descuenta MP.
- ❌ **No hay escrow ni retención documentada** controlada por el marketplace hasta la finalización. Reserva/captura con tarjeta existe con plazos cortos (5–7 días) y su compatibilidad con split no está documentada.
- ✅ Reembolsos totales/parciales hasta 180 días; en split se descuentan proporcionalmente; requieren saldo del vendedor.
- ✅ Contracargos: los absorbe el vendedor.
- ✅ Webhooks: header `x-signature` (`ts`, `v1`), HMAC-SHA256 sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` → implementado en `src/server/payments/mercadopago.ts` (`verifyWebhook`). Responder 200/201 en < 22 s y consultar `GET /v1/payments/{id}`.
- ⚠️ Costos: según la página comercial (vista 2026-10-08) dependen del plazo de acreditación; revalidar y negociar.

### Flujo compatible propuesto para producción
1. Proveedor conecta su cuenta MP por OAuth en el paso "Cobros" del alta (`payouts_status = pending → enabled`). Guardar tokens cifrados fuera de `providers` (tabla dedicada con cifrado de aplicación o Vault de Supabase).
2. Al aceptar, crear una **preferencia de Checkout Pro** con el token del vendedor, `marketplace_fee = cargo cliente + impuesto + comisión proveedor`, `external_reference = charges.external_reference`, `notification_url = https://fixy.solutions/api/webhooks/payments/mercadopago`. Los datos de tarjeta nunca pasan por Fixy.
3. Confirmar por webhook + `GET /v1/payments/{id}` (ya implementado como patrón).
4. **Liquidación**: con Split 1:1 MP liquida directamente al vendedor; la "liquidación" de Fixy pasa a ser **informativa** (estado según `money_release_date`), no una transferencia propia. La pausa por reclamo no puede retener fondos en MP: se reemplaza por reembolso (si corresponde) gestionado por operación.
5. La interfaz debe decir: "El pago se acredita al profesional según los plazos de Mercado Pago. Fixy no retiene el dinero." (nunca "dinero protegido").
6. Alternativa: cobrar al **finalizar** el trabajo (patrón de otras plataformas), reduciendo riesgo de reembolsos; requiere decisión comercial.

### Antes de activar pagos reales (bloqueante)
- [ ] Decisión comercial: momento del cobro (al aceptar vs. al finalizar) y política de cancelación/reembolso definitiva.
- [ ] Validar con Mercado Pago: liberación diferida, plazo de acreditación en split, reserva/captura con `application_fee`, tratamiento de la comisión ante contracargos, alcance de "no se permiten transferencias desde instituciones financieras externas".
- [ ] Revisión legal/contable (rol de Fixy, normativa PSP del BCRA si hubiera custodia, facturación de la comisión, IVA sobre el cargo de servicio, ingresos brutos).
- [ ] Implementar OAuth del vendedor, creación de preferencia, consulta de pago, reembolsos y contracargos en `mercadopago.ts`; pruebas en sandbox con cuentas de prueba (vendedor, comprador, integrador).
- [ ] Configurar `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`, `PAYMENTS_GATEWAY=mercadopago` solo en producción, tras checklist anterior.
- [ ] Ajustar textos de UI y términos según el flujo validado.

## Variables
`PAYMENTS_GATEWAY` (`mock` | `mercadopago`), `MOCK_WEBHOOK_SECRET`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`. Con `mercadopago` sin implementación completa, las operaciones fallan explícitamente (no se simula en silencio).


## Saldo y retiros de profesionales (migración 0016)

- Cada trabajo completado genera su liquidación (`payouts`) por el 100 % del presupuesto (menos reembolsos). Pasa a **disponible** cuando el trabajo está completado, con reseña y sin reclamo abierto.
- **Un retiro por mes calendario** (hora de Buenos Aires; índice único `withdrawals_one_per_month`, un rechazo no cuenta). Se retira todo el saldo disponible.
- Se transfiere a los **20 días** (`platform_settings.withdrawals.delay_days`). Al pedirlo, las liquidaciones pasan a `scheduled` con `withdrawal_id`.
- Los **datos bancarios** (titular, CUIT/CUIL, CBU/CVU o alias) se cargan al pedir el retiro o antes en Cobros. Tabla `provider_bank_accounts` con RLS (solo administradores del perfil y operación); nunca se escriben en la auditoría. Cada retiro guarda una copia de la cuenta destino.
- La operación registra la transferencia (`/admin/finanzas?tab=retiros`) con su referencia: recién ahí se asienta `provider_payable +neto · gateway_clearing −neto` por cada liquidación. Si rechaza, el saldo vuelve a estar disponible.
- Ya no es requisito tener cobros configurados para recibir pedidos.

### Pendiente antes de dinero real (bloqueante)
- **Custodia de fondos:** con este modelo Fixy recibe el pago del cliente y transfiere al profesional después. Hay que validar con asesoría legal/contable el encuadre (BCRA/PSP, facturación por cuenta y orden, retenciones impositivas) y, si corresponde, operar con una cuenta recaudadora o un proveedor de pagos que lo permita.
- Con el Split 1:1 de Mercado Pago el dinero va directo al vendedor y MP le descuenta su costo: eso **no es compatible** con "0 % al profesional" ni con los retiros mensuales. Alternativas: cobrar en la cuenta de Fixy y transferir (modelo actual) o absorber el costo de MP en el cargo al cliente.
- Encriptar CBU/alias en reposo y verificar titularidad (CUIT del titular = CUIT del profesional) antes de la primera transferencia.

## Mercado Pago — Checkout Pro (implementado)
- Cobra en la cuenta de FLIPS S.R.L. con la API de Preferences: `src/server/payments/mercadopago.ts`.
- `PAYMENTS_GATEWAY=mercadopago` activa la pasarela; `MERCADOPAGO_MODE=test` usa `MERCADOPAGO_TEST_ACCESS_TOKEN` (sin dinero real) y `live` usa `MERCADOPAGO_ACCESS_TOKEN`.
- Confirmación: webhook firmado (`x-signature`, `MERCADOPAGO_WEBHOOK_SECRET`) en `/api/webhooks/payments/mercadopago` + consulta a `/v1/payments/{id}`; además, la vuelta `/pagos/retorno` fuerza la misma consulta verificada. Nunca se acredita por la vuelta del navegador.
- Solo se procesan avisos de tipo `payment`; el resto se ignora con 200. En el panel de Mercado Pago, suscribir únicamente "Pagos".
- Sin efectivo ni cajeros (tardan días en acreditarse); la preferencia vence a las 48 h.
- Reintegros: `POST /v1/payments/{id}/refunds` con clave de idempotencia.
- Profesionales: cobran por retiros mensuales a su cuenta bancaria (no se usan cuentas de la pasarela).
- Contracargos y reclamos: retienen la liquidación y se registran como reembolso (`source = chargeback`).
- Conciliación: `GET /v1/payments/search?external_reference=…` por turnos (cron) y manual desde Finanzas.

## Operaciones con la pasarela (auditoría H-02 / H-03, migración 0043)

Ninguna llamada a la pasarela ocurre con una transacción de base abierta. Toda operación que mueve dinero es un
**comando durable** (`payment_commands`) con una **clave idempotente estable** derivada de la operación de negocio:

```text
acción de negocio ── tx corta: valida + guarda el comando ── commit
procesador ──────── reclama con lease de 60 s (una sentencia, sin locks durante la red)
                 ── llama a la pasarela con la clave del comando (X-Idempotency-Key en Mercado Pago)
                 ── guarda la respuesta en el comando
                 ── tx corta: aplica estado + registro financiero + avisos y cierra el comando
conciliador ────── compara Fixy con la pasarela por referencia y abre incidencias
```

| Comando | Clave | Al confirmarse | Si muere (rechazo o 8 intentos) |
|---|---|---|---|
| `create_checkout` | `charge:<trabajo>:<tipo>:<extra>:<cobro>` | guarda `checkout_url` | cobro `failed`; el cliente reintenta (cobro nuevo) |
| `refund` | `refund:<cobro>:<ya devuelto+pendiente>:<importe>` | reembolso `approved` + efectos | reembolso `failed` + incidencia crítica; reintento manual con la misma clave |
| `orphan_refund` | `orphan:<pago>` | auditoría + aviso al cliente | incidencia crítica; reintento manual |
| `transfer` | `payout:<liquidación>` | liquidación `paid` + asiento | liquidación `failed` (se reprograma con la misma clave) |

Estados del comando: `pending → leased → succeeded`, `leased → retryable → leased…`, `leased → dead`. Errores
reintentables: sin respuesta, 5xx, 408/409/425/429 (backoff exponencial con jitter, 30 s → 1 h). Si la pasarela ya hizo
la operación y se cae el registro, el reintento con la misma clave devuelve la misma operación: nunca se duplica.

Los avisos (webhooks) se procesan en tres pasos: registrar el evento (transacción propia), consultar el pago a la
pasarela (sin transacción) y aplicarlo (`applyGatewayPayment`, transacción breve). Una devolución propia todavía
pendiente no se registra como "devolución hecha en la pasarela" aunque el aviso llegue antes.

Pruebas de fallas: `tests/integration/payment-failures.test.ts` (timeout después de la operación, rechazo, dos
procesadores, lease vencido, aviso antes del registro, pasarela sin respuesta, pago duplicado, transferencia).
Semgrep bloquea (ERROR) llamadas a la pasarela con `tx`/`db` y lecturas de `mock_gateway_payments` fuera del simulador.
