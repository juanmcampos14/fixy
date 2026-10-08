# Mercado Pago (Argentina) para Fixy: qué se puede hacer y qué no

> Investigación hecha el **2026-10-08** con documentación oficial de Mercado Pago Argentina (`mercadopago.com.ar/developers` y páginas oficiales de `mercadopago.com.ar`).
> No se activó ningún pago real, no se creó ninguna cuenta y no se inició sesión.
> Convenciones:
> - ✅ **Verificado**: figura en la doc oficial citada.
> - ⚠️ **No encontrado / poco claro**: la doc no lo dice, o lo dice de forma ambigua.
> - 💭 **Inferencia**: es interpretación nuestra y no está en la doc.
>
> Algunas páginas `.md` de la doc se leyeron en su versión en inglés. El contenido es el mismo que en la versión en español.

---

## TL;DR

1. ✅ MP tiene un producto de marketplace para Argentina: **Split de pagos 1:1**. Funciona con **Checkout Pro** (usando `marketplace_fee`) y con **Checkout API** (usando `application_fee`). Cada proveedor vincula su propia cuenta de MP por **OAuth**.
2. ✅ El cobro se hace **con el access token del vendedor**. La plata entra en la **cuenta de MP del proveedor**, y la comisión de Fixy se separa automáticamente hacia la cuenta del marketplace.
3. ✅ Primero se descuenta la **comisión de MP** y después, del resto, la **comisión del marketplace**.
4. ⚠️ **No encontramos en la doc pública ningún escrow ni custodia real para marketplace.** No hay un parámetro documentado para que el marketplace retenga la plata del proveedor hasta que termine el trabajo, ni un `money_release_days` configurable por pago. Solo hay dos cosas cercanas:
   - Para cambiar la **fecha de liberación de la comisión del marketplace** hay que hablar con un ejecutivo comercial.
   - Existe la **reserva/captura con tarjeta**, que dura 5 o 7 días según la API y solo sirve para tarjetas. No se documenta que sea compatible con split.
5. ✅ Contracargos: los **absorbe el vendedor**. Reembolsos: se descuentan **proporcionalmente** al vendedor y al marketplace.
6. **Flujo recomendado para el MVP:** Split 1:1 con Checkout Pro y **cobro al confirmar el presupuesto o al terminar el trabajo**, sin prometer custodia. El detalle está en la sección 10.

---

## 1. Soporte de marketplace / Split de pagos

| Tema | Estado | Detalle | Fuente |
|---|---|---|---|
| Producto | ✅ | "Split de pagos 1:1": MP ofrece servicios de procesador de pagos (PSP) a los vendedores de un marketplace y divide automáticamente el dinero entre las partes. Está disponible en AR, BR, CL, CO, MX, PE y UY. | https://www.mercadopago.com.ar/developers/es/docs/split-payments/landing · https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/overview |
| Checkouts soportados | ✅ | Checkout Pro (redirige a MP) y Checkout API (el pago se hace dentro del sitio). La doc de configuración también menciona Checkout Bricks. | https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace · https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/create-configuration |
| Modelo 1:N (un pago repartido entre varios vendedores) | ✅ / ⚠️ | Solo está disponible para vendedores con "cartera asesorada" que estén en contacto con el equipo comercial de MP. No es de autoservicio. | https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/prerequisites |
| Restricción de fondos | ✅ | El Split 1:1 acepta pagos con saldo disponible entre cuentas de MP. **No se permiten transferencias desde instituciones financieras externas.** 💭 El texto es ambiguo: no queda claro si solo se refiere al pago con saldo o si excluye otros medios. Habría que validarlo en sandbox o con MP. | https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace |
| Crear la aplicación | ✅ | En "Tus integraciones" se crea la aplicación eligiendo Pagos online, después Checkout Pro o Checkout API, y como modelo **Marketplace**. Luego hay que cargar la **Redirect URL** (el `redirect_uri` de OAuth). Al crear la aplicación, MP puede pedir reautenticación de identidad y documentos. | https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/create-configuration |
| Aprobación formal del marketplace | ⚠️ | La doc no describe un proceso de aprobación previa para el modelo 1:1. Solo pide verificación de identidad del integrador. | misma fuente |

### Vinculación de proveedores (OAuth)

✅ Fuente: https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation (y la intro: https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/additional-content/security/oauth/introduction)

- Se usa el flujo **Authorization code**:
  - Se redirige al proveedor a `https://auth.mercadopago.com/authorization` con `client_id`, `response_type=code`, `platform_id=mp`, `state` y `redirect_uri`.
  - El `redirect_uri` tiene que coincidir con el que está configurado en la app y conviene que sea estático.
- `state`: un valor único por intento, sin datos sensibles, que sirve para validar que la respuesta corresponde al pedido.
- **PKCE**: es recomendado y se habilita en el detalle de la aplicación. Usa `code_challenge` y `code_challenge_method` (`S256`). El verifier tiene que tener entre 43 y 128 caracteres.
- El `code` dura **10 minutos** y se puede usar una sola vez.
- El canje se hace con `POST https://api.mercadopago.com/oauth/token`, enviando `client_id`, `client_secret`, `code`, `grant_type=authorization_code`, `redirect_uri` y `code_verifier` si se usa PKCE.
- Con `test_token=true` se obtienen credenciales de prueba.
- El **access token del vendedor dura 180 días**. El `refresh_token` dura **6 meses** y es reutilizable. Para renovar se usa `grant_type=refresh_token`, sin que el proveedor tenga que intervenir.
- En el pago, el frontend usa la `public_key` del integrador y el backend usa el **access token del vendedor**.
  Fuente: https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace

## 2. Alta e identificación del proveedor (KYC)

| Tema | Estado | Detalle | Fuente |
|---|---|---|---|
| Tipo de cuenta | ✅ | Hace falta una **cuenta vendedor de MP con nivel KYC 6**. Se crea gratis. | https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/prerequisites |
| App de MP | ✅ | Se requiere la app de Mercado Pago (Android o iOS) para gestionar los cobros. | misma |
| OAuth | ✅ | Cada vendedor tiene que autorizar la conexión por OAuth. | misma |
| Quién hace el KYC | 💭 | El KYC queda dentro de la cuenta MP del vendedor (lo pide MP como requisito de nivel). La doc **no detalla** qué documentos pide MP ni cuánto tarda. Fixy no tendría que recolectar documentación financiera del proveedor para MP, aunque puede pedir datos propios (matrícula, seguro, etc.). | — |
| Qué significa "KYC 6" exactamente | ⚠️ | No está definido en la doc pública que leímos. | — |

**Pasos que tendría que hacer el proveedor (según la doc):**
1. Tener o crear una cuenta de MP y completar la verificación hasta el nivel requerido.
2. Desde Fixy, tocar "Conectar Mercado Pago" y autorizar en MP (OAuth).
3. Gestionar sus cobros en su cuenta de MP o en la app.

## 3. Comisión de la plataforma

| Tema | Estado | Detalle | Fuente |
|---|---|---|---|
| Checkout Pro | ✅ | Se usa `marketplace_fee` en cada preferencia (`/checkout/preferences`). El error `invalid_marketplace_fee` aparece si la comisión supera el monto total. | https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace · https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post |
| Checkout API | ✅ | Se usa `application_fee` en cada `POST /v1/payments`. La referencia lo define como la comisión que los integradores cobran a sus clientes. Restricciones: no puede superar `transaction_amount` (error 4038), no puede ser negativo (error 4039) y requiere un token OAuth (error 2059). | https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api-payments/create-payment/post |
| Unidad (monto o %) | ⚠️ | La guía habla de un "porcentaje de comisión", pero describe el parámetro como "monto a cobrar" y los ejemplos son números enteros (10 sobre 25). 💭 Por la validación "no puede superar el monto total", parece ser un **monto absoluto en ARS**. Hay que confirmarlo en sandbox. | integrate-marketplace |
| Quién paga la comisión de MP | ✅ | **Primero se descuenta la comisión de MP y después, del monto restante, la del marketplace.** 💭 Es decir, el costo de MP lo termina absorbiendo el vendedor (se cobra en su cuenta) y el marketplace cobra su comisión completa. | integrate-marketplace |
| Comisión configurable | 💭 | Como el fee se manda en cada preferencia o pago, Fixy puede calcularlo dinámicamente (porcentaje configurable a monto). | — |

## 4. Distribución y acreditación: ¿hay escrow?

| Tema | Estado | Detalle | Fuente |
|---|---|---|---|
| Quién recibe el dinero | ✅ | El pago se crea con el token del vendedor y se divide automáticamente entre el vendedor y el marketplace. | overview / integrate-marketplace |
| Cuándo queda disponible | ✅ / ⚠️ | Depende del **plazo de acreditación** de la cuenta que cobra. La página comercial de Checkout para sitio web muestra plazos de 35 días, 18 días, 10 días y "al instante", con costos distintos (ver sección 8). La página dice que el costo depende del "plazo elegido para recibir el dinero". ⚠️ No hay doc developer que explique cómo se aplica ese plazo en un pago split (qué plazo rige: el del vendedor o el del marketplace). | https://www.mercadopago.com.ar/herramientas-para-vender/check-out |
| Fecha de liberación en el pago | ✅ | El GET de pago devuelve `money_release_date` (solo como campo de respuesta, en el ejemplo, sin descripción). | https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api-payments/get-payment/get |
| Parámetro para fijar días o fecha de liberación por pago (`money_release_days`, etc.) | ⚠️ **No encontrado** | En la referencia de `POST /v1/payments` y en la de crear preferencia **no aparece** ningún parámetro de request para definir la liberación. | create-payment/post · create-preference/post |
| Liberación de la comisión del marketplace | ✅ | "Si necesitás configurar la fecha de liberación de la comisión del marketplace, contactá a tu ejecutivo comercial asistido." Esto aplica **a la comisión**, no al dinero del vendedor. | prerequisites |
| **Escrow o custodia hasta que termine el trabajo** | ⚠️ **No existe en la doc pública** | No hay ningún mecanismo documentado para que el marketplace **retenga** el dinero del vendedor y lo libere al confirmar el trabajo. El dinero se acredita en la cuenta del vendedor según los plazos de MP. | — |
| "Advanced Payments" (disbursements, cambio de fecha de liberación) | ⚠️ | Aparece en SDKs y en mirrors de terceros, pero **no figura en el índice de la API Reference de AR** que revisamos. No es fuente oficial vigente, así que no lo damos por disponible. Si interesa, hay que preguntarle a MP comercial. | https://www.mercadopago.com.ar/developers/es/reference (índice revisado) |

### Lo más parecido a una "retención": reserva y captura (solo tarjeta)

- ✅ **Checkout API (Orders):** se puede reservar el monto en la tarjeta y capturarlo después. Hay que capturar **dentro de 5 días desde la creación** o se cancela. **No admite captura parcial.** Endpoints: `POST /v1/orders/{id}/capture` y `/cancel`. El dinero no está disponible hasta que se captura.
  Fuente: https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/payment-management/reserve-capture-cancel
- ✅ **Checkout API (Payments, legacy):** se usa `capture=false` y después `PUT /v1/payments/{id}` con `capture: true`. El plazo es de **7 días desde la creación**. Permite captura parcial solo con Visa, Cabal, Master y Amex.
  Fuente: https://www.mercadopago.com.ar/developers/es/docs/checkout-api-payments/payment-management/capture-authorized-payment
- ⚠️ No está documentado si la reserva y captura **funciona junto con `application_fee` o el split**. Tampoco aplica a Checkout Pro ni a medios que no sean tarjeta.
- 💭 En la práctica, sirve para **trabajos que se hacen en pocos días**, como una garantía de cobro. **No es escrow:** es una preautorización sobre el cupo de la tarjeta del cliente.

### Alternativa "custodia propia" (no recomendada para el MVP)

💭 Fixy podría cobrar en **su propia cuenta** (sin split) y después pagarle a cada proveedor. Esto convierte a Fixy en **custodio de fondos de terceros**. La doc de MP no cubre este caso, pero tiene implicancias regulatorias (normativa de PSP del BCRA), fiscales y de contracargos. **Requiere asesoramiento legal y contable.** No lo verificamos.

## 5. Reembolsos

| Tema | Estado | Detalle | Fuente |
|---|---|---|---|
| Reembolso en marketplace | ✅ | El monto reembolsado se descuenta **proporcionalmente** de la cuenta del vendedor y de la del marketplace (la comisión se devuelve en proporción). | integrate-marketplace |
| Saldo insuficiente del vendedor | ✅ | En 1:1, el marketplace **no puede hacer el reembolso total** si el vendedor no tiene fondos. En ese caso devuelve su parte y decide si cubre el resto por otros medios. El resto sigue siendo responsabilidad del vendedor. | integrate-marketplace |
| Total o parcial | ✅ | Para un reembolso total, el body va vacío. Para uno parcial, se indica el monto. El plazo es de **180 días desde la aprobación**. Hace falta saldo disponible suficiente. Endpoint (Orders): `POST /v1/orders/{id}/refund`. | https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/payment-management/refunds-cancellations |
| Endpoints legacy y Checkout Pro | ✅ | La API Reference incluye "crear reembolso", "obtener reembolso" y "listar reembolsos" tanto para Checkout API Payments como para Checkout Pro Preferences. | https://www.mercadopago.com.ar/developers/es/reference |
| Cancelación | ✅ | Solo se puede cancelar un pago que todavía no fue aprobado. | refunds-cancellations |

## 6. Contracargos

| Tema | Estado | Detalle | Fuente |
|---|---|---|---|
| Quién los absorbe | ✅ | **El vendedor.** Si el contracargo procede, se cancela el cobro, se retiran los fondos del vendedor y se devuelven al cliente. | https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/payment-management/chargebacks |
| Retención | ✅ | Mientras se resuelve, el monto en disputa queda **retenido en la cuenta del vendedor**. | misma |
| Documentación | ✅ | El vendedor puede tener que reunir información y presentarla por API. Hay endpoints de contracargos en la API Reference. | misma · https://www.mercadopago.com.ar/developers/es/reference |
| Plazos | ⚠️ | No están especificados en esa página. | — |
| Qué pasa con la comisión del marketplace ante un contracargo | ⚠️ | No encontrado. | — |
| Prevención | ✅ | Usar un `statement_descriptor` claro, webhooks de fraude, facturación precisa y evidencia del servicio. | chargebacks |

💭 Para Fixy conviene guardar evidencia de cada trabajo: presupuesto aceptado, fotos, confirmación del cliente y chat.

## 7. Webhooks y notificaciones

✅ Fuente: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks

- **Firma:** el header `x-signature` viene con el formato `ts=...,v1=...`.
- **Manifest:** `id:[data.id];request-id:[x-request-id];ts:[ts];`
  - Si `data.id` es alfanumérico, se pasa a minúsculas.
  - Si falta `data.id` o `x-request-id`, se omite ese campo del manifest.
- **Validación:** se calcula un HMAC-SHA256 en hex usando la **clave secreta** de la app (Tus integraciones > Webhooks) y se compara con `v1`. Opcionalmente, también se puede validar la antigüedad de `ts`.
- **Clave secreta:** no vence. Se recomienda renovarla.
- **Respuesta:** hay que devolver HTTP **200 o 201 en menos de 22 segundos**.
- **Reintentos:** cada 15 minutos. Después del tercer intento el intervalo se alarga, pero los reintentos siguen.
- **Verificación:** después de confirmar la recepción, hay que **consultar el recurso** (por ejemplo `GET /v1/payments/{id}` o `/v1/orders/{id}`) para obtener el estado real.
- **Idempotencia en las notificaciones:** ⚠️ la página no da una guía de deduplicación. 💭 Como hay reintentos, el handler tiene que ser idempotente, por ejemplo con una clave única por `data.id`, `action` y estado consultado.
- **Idempotencia en requests:** ✅ el header `X-Idempotency-Key` es **obligatorio** en `POST /v1/payments` (error 4292 si es nulo).
  Fuente: https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api-payments/create-payment/post
- `notification_url` tiene que ser HTTPS y tener menos de 500 caracteres (misma fuente).
- ⚠️ Webhooks en marketplace: no encontramos una página específica que diga qué aplicación recibe las notificaciones de pagos hechos con el token del vendedor. El link de la sección de Split dio 404. 💭 Conviene mandar `notification_url` en cada preferencia o pago.

## 8. Costos

- ✅ **Página comercial oficial "Checkout para sitio web"**, vista el 2026-10-08: https://www.mercadopago.com.ar/herramientas-para-vender/check-out

  | Plazo de acreditación | Comisión |
  |---|---|
  | 35 días | 1,49% + IVA |
  | 18 días | 3,39% + IVA |
  | 10 días | 4,39% + IVA |
  | Al instante | 6,29% + IVA |

  - La página aclara que los costos **pueden variar por impuestos provinciales**, por el medio de pago y por el plazo elegido, y que solo se paga por venta aprobada.
  - ⚠️ Los valores se tomaron de una tabla cuyo texto viene desordenado en el HTML. Asociamos cada plazo con su porcentaje por el orden en que aparecen. Hay que revalidarlo antes de usarlo.
- ⚠️ La sección de costos personalizada (https://www.mercadopago.com.ar/costs-section) **pide login** (redirige al login). La página de ayuda https://www.mercadopago.com.ar/ayuda/costo-recibir-pagos-dinero_220 se renderiza con JS y no pudimos leer el contenido. La de "Comisiones y cargos" (https://www.mercadopago.com.ar/ayuda/26748) devolvió 403.
- ⚠️ No encontramos costos específicos del Split de pagos ni costos de reembolsos o contracargos.

## 9. Restricciones operativas, PCI y sandbox

| Tema | Estado | Detalle | Fuente |
|---|---|---|---|
| Países | ✅ | Split 1:1 está disponible en AR (entre otros). | overview |
| Datos de tarjeta / PCI | ✅ | MP permite **tokenizar por backend solo a comercios que cumplen PCI**. Si no, después de obtener el card token se usa el formulario de tarjeta (MercadoPago.js o Bricks). 💭 Con **Checkout Pro** los datos de tarjeta nunca pasan por Fixy, que es lo más simple a nivel PCI. | https://www.mercadopago.com.ar/developers/es/docs/resources-pci-compliant-merchants/receiving-payment-by-card |
| Cuentas de prueba | ✅ | Tipos: Vendedor, Comprador e **Integrador** (para el modelo marketplace). Se pueden crear hasta 15. No se pueden borrar. El país no se puede cambiar. Comprador y vendedor tienen que ser del mismo país. Hay tarjetas de prueba y saldo ficticio. **Checkout Bricks no admite cuentas de prueba** para testear integraciones. | https://www.mercadopago.com.ar/developers/es/docs/your-integrations/test/accounts |
| Sandbox OAuth | ✅ | Con `test_token=true` en `/oauth/token` se obtienen credenciales de prueba. | oauth/creation |
| 1:N y cambios de liberación de la comisión | ✅ | Requieren contacto comercial. | prerequisites |

## 10. Flujo recomendado y compatible con lo documentado

**Modelo:** Split de pagos 1:1 con **Checkout Pro**, más OAuth por proveedor, con `marketplace_fee` calculado a partir de una comisión configurable.

1. **Onboarding del proveedor:** se registra en Fixy y después usa "Conectar Mercado Pago" (OAuth con PKCE y `state`). Se guardan `access_token`, `refresh_token`, la fecha de expiración y el `user_id`, **encriptados**. Se le pide al proveedor tener la cuenta verificada (KYC de MP). Mientras no conecte MP, el proveedor no puede recibir pagos por la plataforma.
2. **Pedido:** el cliente describe el problema, recibe un presupuesto o un precio cerrado y lo acepta.
3. **Momento del cobro.** Como **no hay escrow**, hay dos opciones honestas:
   - **A (recomendada para el MVP):** se cobra **al finalizar el trabajo**. El cliente confirma que terminó y paga por Checkout Pro. Es el patrón que usa Clickie (ver `referencias.md`). Así no hace falta custodia.
   - **B:** se cobra **al aceptar el presupuesto** (pago anticipado o seña), avisando claramente que el dinero va al proveedor según los plazos de MP y que, si hay problemas, el reembolso se gestiona por la plataforma y queda sujeto al saldo del proveedor.
   - (Opcional, más adelante: reserva y captura con tarjeta vía Checkout API para trabajos de menos de 5 a 7 días. Hay que validar con MP que sea compatible con `application_fee`.)
4. **Preferencia:** se crea con el **token del proveedor**, `marketplace_fee`, `external_reference = id del trabajo`, `notification_url`, `back_urls` y `statement_descriptor`.
5. **Webhook:** se valida `x-signature` con HMAC, se responde 200 rápido, se consulta `GET /v1/payments/{id}` y se actualiza el estado de forma idempotente.
6. **Reembolsos:** total o parcial dentro de 180 días. Se descuentan proporcionalmente al proveedor y a Fixy. Si el proveedor no tiene saldo, Fixy decide si cubre su parte.
7. **Contracargos:** los absorbe el proveedor. Fixy guarda la evidencia del trabajo.
8. **Mientras no se activen pagos reales:** dejar el módulo de pagos detrás de un feature flag o de un "proveedor de pagos simulado" con estos mismos estados (`pending`, `approved`, `refunded`, `charged_back`).

**No prometer en la UI** "tu dinero queda protegido hasta que el trabajo termine", porque no está soportado por la doc pública de MP.

## 11. Pendientes para validar con Mercado Pago (comercial o soporte)

- ¿Existe para AR algún producto de retención o liberación diferida controlada por el marketplace (por ejemplo, "Advanced Payments" o disbursements)?
- ¿Qué plazo de acreditación rige en un pago split: el del vendedor o el del marketplace?
- ¿`marketplace_fee` / `application_fee` es un monto o un porcentaje? (Probar en sandbox.)
- ¿La reserva y captura funciona con `application_fee`?
- ¿Qué pasa con la comisión del marketplace cuando hay un contracargo?
- ¿Cuál es el alcance exacto de la restricción "no se permiten transferencias desde instituciones financieras externas"?
- ¿Qué implica concretamente el KYC nivel 6?

## Páginas que no se pudieron leer

- https://www.mercadopago.com.ar/costs-section → requiere login.
- https://www.mercadopago.com.ar/ayuda/26748 → 403.
- https://www.mercadopago.com.ar/ayuda/costo-recibir-pagos-dinero_220 → el contenido se carga con JS y no se pudo extraer.
- https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/payment-management/refunds-cancellations → 404.
- https://www.mercadopago.com.ar/developers/en/docs/resources-faqs/collections → 404.
- Webhooks dentro de la sección Split: la URL anidada dio 404. Usamos la página general de webhooks.
