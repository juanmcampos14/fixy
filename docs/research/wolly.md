# Wolly (wollyhome.com): análisis del modelo de servicio y UX para el cliente

> Investigación hecha el 2026-10-08 con navegador y fetch, sin crear cuenta ni enviar formularios. El flujo de pedido lo recorrí hasta el paso "Contacto" (nombre y WhatsApp) y ahí paré, sin cargar datos personales. Para la dirección usé una dirección pública (un museo de Madrid) solo para ver cómo se comporta el autocompletado. Todo está resumido con mis palabras.

## Resumen

- Wolly (ex "Jobin", España; Wolly Corp SL) hoy tiene **dos modelos superpuestos**:
  1. **Catálogo de servicios con precio "desde" cerrado** (unos 593 servicios en 23 gremios, IVA incluido), cada uno con una ficha de qué incluye y qué no. Es el flujo web actual (`marketplace.wollyplatform.app`), donde el lema es "conocé el precio por adelantado".
  2. **Presupuesto a medida**: ítems como "Diagnóstico", "A medida", "Incidencia" y las reformas, que muestran "Contanos qué necesitás y te presupuestamos sin compromiso" en lugar de precio. Es la herencia de Jobin: la ficha de la app promete **hasta 3 presupuestos** de profesionales de la zona, comparar con reseñas, chatear o llamar y pagar desde la app al terminar.
- El **formulario es el mismo** en los dos casos: un wizard de 4 pasos (Proyecto, Ubicación, Contacto, Resumen) con descripción libre obligatoria, fotos o videos opcionales, dirección con Google Places y mapa, y contacto por **WhatsApp sin registro**.
- La "visita" **no aparece como opción para elegir con franja horaria** en ninguna parte pública. Lo más parecido es el ítem **"Diagnóstico"** (incluye diagnóstico técnico, armado del presupuesto y asesoramiento; no incluye piezas ni la reparación), que se cotiza a medida y no tiene precio publicado. Hay "visitas" con precio fijo solo cuando el trabajo cerrado ya incluye desplazamiento y "hasta 1 h de oficial".
- La confianza se apoya en un **directorio público de profesionales** (4.713 al momento de mirar) con la etiqueta "Homologado por Wolly", nota, cantidad de opiniones verificadas, zonas de cobertura por municipio, proyectos y una caja que dice que Wolly verificó impuestos al día, seguro vigente y documentación.
- En monetización conviven dos cosas: los T&C de 2023 describen **créditos prepagos por acceder a trabajos** (con recarga automática, sin cuota mensual y devolución si no hubo contacto con el cliente), y la web de profesionales habla de "membresías" para ganar visibilidad. Hay también una línea B2B white-label (Wolly Marketplace) sobre Stripe Connect con take rate configurable.

## Recorrido del cliente (paso a paso)

Lo verificado en la web `marketplace.wollyplatform.app/wolly/principal/...`, que es adonde llevan todos los "Pide presupuesto" de wollyhome.com:

1. **Home del marketplace**: hero con un **buscador de texto libre** ("escribí lo que necesitás") y debajo una grilla de **21 categorías con íconos** (Manitas, Reformas, Climatización, Fontanería, Electricidad, etc.). Más abajo están el bloque "Cómo funciona" en 3 pasos (buscá el servicio, conocé las condiciones por adelantado, te mandamos un profesional si aceptás) y un **simulador de reformas con IA** (subís una foto, elegís estilo y obtenés un render y una estimación "cerrada").
   - Probé buscar en lenguaje natural ("pierde agua la cisterna del inodoro"). Devolvió **una sola tarjeta de servicio concreta** (sustitución del mecanismo de la cisterna, desde 63 €) en un panel "Elegí la opción que más se adapte a vos" que se puede cerrar. O sea, el texto libre se **mapea a un ítem del catálogo**: no crea un pedido abierto.
2. **Lista de servicios de la categoría** (por ejemplo, Fontanería con unos 46 ítems). Cada tarjeta muestra:
   - un chip con el gremio, el título y una línea de descripción;
   - el **precio "desde" con IVA incluido** a la derecha, o bien el texto "te presupuestamos sin compromiso" si es a medida;
   - un acordeón **"Ver detalles"** con dos listas, **"¿Qué incluye?"** y **"¿Qué NO incluye?"**. Ejemplo: la reparación de fuga visible incluye desplazamiento, hasta 1 h de oficial, material estándar y prueba de estanqueidad, y excluye fugas ocultas, picado, urgencias o servicio fuera de horario, más de un punto de fuga, etc. Algunos servicios aclaran el costo de la hora extra (por ejemplo, +50 € + IVA en la detección con cámara térmica);
   - un CTA "Siguiente".
   - Al final de cada categoría siempre hay tres ítems comodín: **Diagnóstico**, **A medida** e **Incidencia** (este último se pensó para administradores de fincas: la incidencia la revisa el administrador).
   - En Reformas casi todo es "a medida" (baño, cocina, integral, parcial). Solo el certificado energético tiene precio.
3. **Wizard "Completá los pasos para recibir tu presupuesto personalizado"** (stepper horizontal de 4 pasos con barra de progreso):
   - **Paso 1, Proyecto**: textarea "Descripción detallada", **obligatoria y con un mínimo de 20 caracteres** (contador 0/20 en rojo hasta llegar). El placeholder sugiere poner medidas, materiales y estado actual. Se pueden subir **fotos o videos opcionales, hasta 5 archivos de 10 MB cada uno**, con un tip: si es una avería, sacale foto a la zona o al aparato y usá flash si hay poca luz. **No hay preguntas guiadas por categoría**: es el mismo formulario para un desatasco que para un diagnóstico.
   - **Paso 2, Ubicación**: ver la sección "Ubicación/dirección".
   - **Paso 3, Contacto**: "¿A qué número te mandamos el presupuesto?". Pide **nombre y móvil con WhatsApp**, con selector de prefijo (+34 por defecto; la lista incluye **+54**). Dice que te lo mandan gratis por WhatsApp, sin registro ni códigos, y al continuar aceptás los T&C y que te escriban por WhatsApp. Tiene un link "¿Ya tenés cuenta? Entrá con tu móvil". **Acá frené.**
   - **Paso 4, Resumen**: no lo vi.
4. **Después del envío** (no verificado en vivo): la sección "Mis presupuestos" exige login y promete historial de solicitudes, **seguimiento del estado en tiempo real** y gestión centralizada. Según la ficha de las tiendas, en el modelo de app "contactarán con vos los mejores profesionales", hasta 3, y podés ver su experiencia, chatear o llamar, valorar y pagar en la app.
5. **Canal alternativo: el directorio de profesionales**. Desde el perfil de cada profesional se puede "Solicitar presupuesto" directo con un formulario propio (nombre, apellidos, teléfono, email, dirección, gremio opcional y descripción, más el consentimiento para que Wolly le pase los datos al profesional).
6. **Asistente conversacional "Candela de Wolly"**: un widget flotante con avatar humano que se presenta como parte del "equipo de proyectos". El input admite adjuntos y dictado por voz. Todo indica que es un bot de IA (la web de profesionales enlaza un chatbot de Chatbase), pero no lo probé con preguntas.

## Visitas vs. presupuestos (cómo conviven)

Lo que **sí** se ve en público:

| Situación | Qué ve el cliente | Precio |
|---|---|---|
| Trabajo acotado y conocido (desatasco, cambio de llave, reparación de electrodoméstico 1.ª hora) | Tarjeta con precio "desde" y lista de incluye / no incluye | Cerrado "desde", IVA incluido |
| No sé qué tiene / hay que mirar | Ítem **"Diagnóstico"**: diagnóstico técnico, armado del presupuesto y asesoramiento (sin piezas ni reparación) | **Sin precio publicado**, "te presupuestamos sin compromiso" |
| Proyecto grande o raro | "A medida" o "Reforma X: presupuesto a medida" | Sin precio; presupuesto a medida |

- La lógica es **"precio cerrado si se puede; si no, diagnóstico o presupuesto"**. Para Wolly la "visita" es un **producto del catálogo** (Diagnóstico) y no un paso intermedio con franjas horarias.
- Los servicios por tiempo ("primera hora", "hasta 2 horas", "hasta 1 h de localización") funcionan como **visita con tope de tiempo y precio conocido**. Es un buen modelo para "visita + arreglo menor".
- **Varios presupuestos**: lo promete la app (hasta 3 presupuestos de profesionales locales, comparables con reseñas). En la web nueva el copy es singular ("tu presupuesto personalizado", "te mandamos un profesional"). Parecería que Wolly pasó de "3 presupuestos" a "precio fijo + asignación", y que el multi-presupuesto quedó para lo hecho a medida y la app. **No pude confirmar** si en web llegan uno o varios presupuestos ni en cuánto tiempo.
- No encontré ninguna pantalla donde el cliente elija entre "pagar visita" o "esperar presupuestos" en paralelo. **Eso que describe el founder de Fixy ("te aparecen opciones para visita y también te llegan presupuestos") no está visible en la parte pública de Wolly.** Puede existir dentro de la app o en "Mis presupuestos" después del login.

## Ubicación/dirección

Verificado en el paso 2 del wizard:

- **Banner informativo de privacidad** arriba: los profesionales no ven tu dirección exacta hasta que aceptás el servicio y la compartís.
- Input "Escribí tu dirección…" con **autocompletado de Google Places** (sugerencias con nombre en negrita y localidad debajo).
- Botón secundario **"Usar mi ubicación actual"** (geolocalización del navegador; no lo activé).
- **Mapa de Google embebido** que arranca como placeholder ("Seleccioná una dirección, el mapa mostrará la ubicación") y, al elegir una sugerencia, muestra un pin.
- **Validación de número de calle**: si elegís un lugar sin altura (por ejemplo, "Puerta del Sol"), muestra un error en rojo que pide incluir el número, elegir una sugerencia más concreta o agregarlo, y deja "Siguiente" deshabilitado. Con una dirección que tiene número se habilita.
- **No hay campos de piso, depto, timbre ni indicaciones** en este paso, al menos antes del resumen.
- **No se pide código postal aparte**: sale de Places.
- En el directorio de profesionales, el filtro de ubicación acepta **código postal, localidad o provincia**, con sugerencias desde 2 letras. Cada perfil lista su **cobertura por provincia y municipio** ("¿Trabaja en tu zona?").
- La app (versión 7.1.2) menciona en sus novedades "mejor autocompletado de direcciones y sin direcciones duplicadas", así que guarda direcciones del usuario.

## Comunicación y pagos

- **Canal principal en web: WhatsApp.** El presupuesto llega por WhatsApp y se usa el número como identidad ("entrá con tu móvil", sin contraseña).
- **App**: según la ficha de las tiendas, tiene **chat en la app y llamada telefónica** con el profesional.
- **Pago**: la app lo describe como **pago en la app una vez hecho el trabajo**, "seguro y con garantía", con **seguro de Allianz gratis**. Las notas de la versión 7.1.2 mencionan pagos con tarjeta más rápidos, **resumen del presupuesto visible durante todo el flujo**, precios con IVA y **descarga del presupuesto en PDF**.
- **T&C (septiembre 2023)**: Wolly se define como intermediario. El contrato es entre cliente y profesional, el cliente paga los honorarios que propone el profesional y no se especifican momento ni medio de pago. No hay política de cancelación entre cliente y profesional.
- **White-label (Wolly Marketplace)**: Stripe Connect con split payments, take rate configurable, links de pago, Apple Pay, Google Pay, Bizum, SEPA, Klarna, etc. Eso es lo que venden a terceros: **no está confirmado que el B2C propio use exactamente eso**.

## Confianza (garantías, reseñas, verificación)

- **Etiqueta "Homologado por Wolly"** en tarjetas y perfiles, y caja en el perfil: Wolly comprobó que está al día con Hacienda, tiene seguros vigentes y la documentación en regla.
- **Requisitos de homologación** (página de profesionales): seguro de responsabilidad civil, alta como autónomo o sociedad y certificado de estar al corriente con Hacienda, todo cargado en Pro Manager.
- **Reseñas**: nota de 1 a 5, cantidad, **distribución por estrellas** (5★ 80, 4★ 6, …), fecha relativa ("Ayer", "Hace 2 días"), etiqueta **"Opinión verificada" / "Cliente verificado de Wolly"** y una cita destacada en la tarjeta del listado.
- **Filtros del directorio**: tiene reseñas, tiene proyectos, **hace urgencias**, homologación, perfil verificado y guardados. Se ordena por relevancia, mejor valorados, más recientes o más experiencia.
- **Perfil**: "Sobre nosotros", servicios destacados, gremios, zonas, **proyectos con fecha**, valoraciones y botones de guardar y compartir. Hay sellos de texto como "Puntualidad garantizada" o "Trabajos con garantía profesional" (los escribe el propio profesional o Wolly; no lo pude distinguir).
- **Garantía**: la app menciona "pago con garantía + seguro Allianz". Los T&C dicen que el profesional da "las garantías legales" y que **Wolly no garantiza la calidad**. **No encontré plazo de garantía ni un proceso de reclamo para el cliente final.**
- **Señales institucionales**: prensa (El País, La Sexta, Cinco Días, etc.), FEDER/IVF, oficinas en Madrid y Miami. Cifras propias: más de 20.000 o 35.000 profesionales (varía según la página), más de 100.000 servicios en el último año, nota media de 9,2/10. Nada de esto está verificado.
- **Tiendas**: App Store con 4,4★ y unas 1.100 valoraciones (las reseñas visibles son de 2017). Google Play con más de 50.000 descargas, actualizada el 23 de julio de 2026; desde la región AR no se ven reseñas.

## Profesionales (alta y monetización)

- **Alta**: formulario en "Únete como Pro". El equipo de red evalúa y, si cumplís, te contacta para la homologación. Después subís los documentos a **Pro Manager** (su app de gestión para profesionales: seguimiento de servicios, ingresos y gastos, **presupuestos y facturas con IA**, un CRM simple). También ofrecen **Website Builder** (web del profesional por menos de 1 € por día).
- **Cómo consiguen trabajos**: "trabajos verificados" de clientes reales. **Asignación según reputación, tasa de respuesta y membresías** que suben la visibilidad en el directorio. Los clientes también pueden pedir presupuesto directo desde el perfil.
- **Monetización hacia el profesional** (T&C 2023): **sistema de créditos o saldo prepago**. Pagás solo los trabajos a los que accedés, sin cuota ni permanencia. La recarga automática viene activada (se dispara con menos de 10 créditos y repite el monto de la última recarga) y el saldo no es reembolsable una vez usado. Hay **devolución del crédito de un trabajo** si se confirma que no hubo contacto con el cliente y se reclama dentro de los 30 días; los trabajos "verificados" no se devuelven.
- **Membresías**: se mencionan, pero **no se publican precios ni planes**.
- **Comisión sobre el trabajo**: no aparece en el B2C. En el white-label es un "take rate configurable".
- **Corporate**: aseguradoras (siniestros), retail (instalación y montaje) e inmobiliarias. Mencionan "Smart Matching" y conexión cliente-profesional en menos de 10 minutos.

## Patrones de UI a adoptar en Fixy (priorizados)

1. **Tarjeta de servicio con precio "desde" y acordeón "Qué incluye / Qué NO incluye"** (lista de servicios por categoría en el marketplace). Es lo que más baja la ansiedad y los reclamos. Para Argentina conviene mostrar el precio en ARS con fecha de actualización y aclarar si los materiales están incluidos.
2. **Ítem "Diagnóstico / Visita técnica" como producto del catálogo**, con lo que incluye (diagnóstico, presupuesto, asesoramiento) y lo que no (piezas, reparación). En Fixy conviene **ponerle precio visible y decir si se descuenta del trabajo**: eso no lo hace Wolly y sería un diferencial.
3. **Servicios por tiempo con tope** ("1.ª hora", "hasta 2 h", "hasta 1 h de localización + hora extra $X"). Es la forma más honesta de vender una visita con arreglo menor.
4. **Buscador en lenguaje natural que mapea a ítems del catálogo**, con fallback a "A medida" (home del marketplace). En Fixy: que al pedido abierto se ofrezcan a la vez la "visita de diagnóstico con precio" y "recibir presupuestos", que es el híbrido que quiere el founder.
5. **Wizard de 4 pasos con stepper** (Proyecto, Ubicación, Contacto, Resumen), con CTA fijo abajo (Anterior / Siguiente) que se habilita solo cuando el paso está completo.
6. **Descripción con mínimo de caracteres y contador** (0/20 en rojo) más **fotos o videos (hasta 5)** con un consejo contextual ("si es una avería, sacá foto con flash"). Mejora sugerida para Fixy: **2 o 3 preguntas guiadas por categoría** (Wolly no las tiene).
7. **Dirección**: Google Places + "Usar mi ubicación actual" + mapa con pin + **validación de altura obligatoria** + **aviso de privacidad** ("el profesional ve tu dirección exacta recién cuando aceptás"). Para Argentina hay que agregar **piso, depto y entre calles**, porque Wolly no los pide, y prever direcciones sin altura (barrios cerrados, rutas) con un pin ajustable.
8. **Contacto por WhatsApp sin registro** (nombre + celular con prefijo, +54 preseleccionado en Fixy) y login posterior con el celular. Encaja muy bien con Argentina.
9. **Directorio público de profesionales**: insignia "Verificado", nota, cantidad de opiniones, **distribución por estrellas**, "opinión verificada", zonas por municipio, proyectos con fecha, filtros como **"hace urgencias"** y CTA "pedir presupuesto" en cada perfil.
10. **Caja "Fixy verificó a este profesional"** con los checks concretos: monotributo o CUIT activo, seguro de responsabilidad civil o accidentes personales, DNI y antecedentes. Es el equivalente local de lo que hace Wolly con Hacienda y seguros.
11. **"Mis pedidos" con seguimiento de estado en tiempo real**, resumen del presupuesto siempre visible y **descarga del presupuesto en PDF**.
12. Opcional para más adelante: asistente conversacional con voz y adjuntos para triage, y simulador con IA para reformas.

## Qué no pude verificar

- Si en la web llegan **uno o varios presupuestos**, **cuántos**, **en cuánto tiempo** y **en qué formato** (WhatsApp, PDF, en la app). La app dice "hasta 3", pero el copy web es singular.
- El **precio del "Diagnóstico"**, si se descuenta del trabajo final y si alguna vez se ofrece **con franjas horarias** para elegir.
- El paso 4 ("Resumen") y todo lo que pasa después de enviar: la pantalla de comparación de presupuestos, la aceptación y la **agenda o selección de horario**.
- El **momento y el medio de pago** en el B2C web actual (si se paga por adelantado al aceptar un precio fijo o al terminar), si hay seña o retención, y si usan Stripe en el B2C.
- La **política de cancelación** para el cliente y sus costos.
- El **plazo de garantía** y el **proceso de reclamo** (y qué cubre exactamente el "seguro Allianz gratis", que solo aparece en la ficha de la app).
- Los **precios de membresías y créditos** para profesionales, y si el modelo de créditos de 2023 sigue vigente o se reemplazó por asignación más comisión.
- Las **reseñas recientes** en tiendas (App Store solo muestra reseñas de 2017; Google Play no las mostró desde la región AR). No encontré perfil en Trustpilot.
- Si "Candela" es IA o una persona, y qué hace con la conversación (no le escribí).
- Las capturas de las tiendas (la ficha de App Store no tenía leyendas legibles).

## Fuentes (URLs)

- https://www.wollyhome.com/particulares
- https://www.wollyhome.com/servicios/
- https://www.wollyhome.com/servicios/fontaneria
- https://www.wollyhome.com/profesionales
- https://www.wollyhome.com/profesionales/unete-como-pro (el contenido no se pudo leer)
- https://www.wollyhome.com/corporate
- https://www.wollyhome.com/sobre-nosotros
- https://www.wollyhome.com/legales/terminos-condiciones
- https://clientes.wollyplatform.app/wolly/home → redirige a https://marketplace.wollyplatform.app/wolly/principal/home
- https://marketplace.wollyplatform.app/wolly/principal/budget/category/cmnfsbhpj047n8p0ymeobxgrj (Fontanería)
- https://marketplace.wollyplatform.app/wolly/principal/budget/category/cmnfsbi4l04lj8p0yhsm2daju (Reformas)
- https://marketplace.wollyplatform.app/wolly/principal/budget/category/cmnfsbhwb04dd8p0yhwl9s0e7 (Electrodomésticos)
- https://marketplace.wollyplatform.app/wolly/principal/budget/cmrvrn7ba01px510y7kdsfgal (wizard: desatasco)
- https://marketplace.wollyplatform.app/wolly/principal/budget/cmnfsbhpv047s8p0ymkd0b92o (wizard: diagnóstico)
- https://marketplace.wollyplatform.app/wolly/principal/professionals
- https://marketplace.wollyplatform.app/wolly/principal/professional/andres-ocando-cmmym0m5u0q2vltd4kvchpxmq (perfil de ejemplo)
- https://marketplace.wollyplatform.app/wolly/principal/my-services (requiere login)
- https://wollymarketplace.wollyhome.com/
- https://play.google.com/store/apps/details?id=es.jobin.jobinapp&hl=es_419
- https://apps.apple.com/es/app/wolly-reformas-y-reparaciones/id1078034513
