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
Por defecto: proveedor 10 %, cliente 5 %, impuesto 0 %. Cada presupuesto guarda las tasas vigentes al enviarse; los adicionales usan las tasas del contrato.

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
1. Cliente acepta → `acceptQuote` crea la orden + `charges(pending)` con `external_reference` único + intención de pago en la pasarela simulada (`mock_gateway_payments`) → redirección a `/pagos/prueba/<ref>` (pantalla marcada "MODO DE PRUEBA").
2. "Simular pago aprobado/rechazado" cambia el estado **del lado de la pasarela simulada** y emite un webhook firmado (HMAC-SHA256 con timestamp y ventana anti-replay).
3. `processPaymentWebhook`: verifica firma → registra evento (único por id) → consulta el pago a la pasarela → valida referencia, monto y moneda → aplica la transición si avanza (`status_rank`) → asientos contables → notificaciones. El endpoint HTTP equivalente es `POST /api/webhooks/payments/mock`.
4. El proveedor confirma (requiere cobro aprobado) → ejecuta → el cliente da conformidad → se crea `payouts(pending)` con bruto, comisión, ajustes y neto. Si hay reclamo abierto, la liquidación queda en pausa.
5. Operación ejecuta la liquidación simulada (`executePayout`): pending → scheduled → processing → paid, con transferencia ficticia idempotente y asiento contable.
6. Reembolsos (`refundCharge`, solo operación, con motivo): vinculados al cobro original, nunca superan lo cobrado, se reparten proporcionalmente entre neto del proveedor y plataforma; si la liquidación aún no se pagó, se ajusta; si ya se pagó, queda auditado como recupero pendiente.
7. Conciliación (`/admin/finanzas?tab=conciliacion`): compara estado y monto internos contra la pasarela; "re-sincronizar" usa la misma lógica que el webhook.

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
