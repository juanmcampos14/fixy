# Flujo de pedido conversacional (web y WhatsApp)

El pedido es una conversación de **4 mensajes**. La web (`src/app/solicitar/chat-request.tsx`) y un futuro canal de WhatsApp siguen el mismo guion, con las mismas reglas del servidor (`submitRequestAction`, `bookableProvidersAction`, `triageAction`).

| # | Fixy pregunta | La persona responde | Web | WhatsApp (Cloud API) |
|---|---|---|---|---|
| 1 | "Contame qué problema tenés." | Texto libre (y fotos, opcional) | Caja de texto tipo chat | Mensaje de texto / imagen |
| — | "Parece trabajo de **Plomería**. ¿No es eso?" | Nada, o cambia el oficio | Botón "¿No es eso?" → lista de oficios | Botones de respuesta o lista interactiva |
| 2 | "¿Dónde es? Tu dirección la ve y la protege solo Fixy." | Comparte la ubicación, elige un lugar guardado o escribe la dirección | Botón **Compartir mi ubicación** (pide el permiso en ese toque), lugares guardados, autocompletado de Google | Mensaje de ubicación nativo de WhatsApp, o texto (se geocodifica) |
| 3 | "Estos profesionales pueden ir: …" | Elige uno, o "presupuestos varios" | Tarjetas con visita, reseñas y precio "desde" | Lista interactiva (hasta 10 filas) con nombre, visita y reseñas |
| 4 | "Listo. Le mando tu pedido a X. No pagás nada hasta confirmar la visita." | Enviar (o sumar detalles) | Botón **Enviar**; "Sumar detalles" desplegable y opcional | Botones "Enviar" / "Sumar detalles" |

## Reglas
- **Nunca rechazar por zona.** Fuera de cobertura se asigna "Otra zona" y el mensaje es: *"Todavía tenemos pocos profesionales en esa zona. Podés hacer el pedido igual: lo revisa nuestro equipo y te avisamos apenas consigamos a alguien."* El pedido queda en `no_coverage` y el equipo lo ve en Administración → Solicitudes.
- **Ubicación solo con un toque.** Los navegadores bloquean en silencio los pedidos de permiso que no vienen de una acción del usuario: nunca pedirla al cargar la página. En WhatsApp la persona comparte la ubicación desde el clip.
- **Detalles opcionales.** Preguntas del oficio, urgencia, horarios, piso, barrio cerrado, acceso y fotos mejoran el pedido pero no lo bloquean (el servidor no los exige).
- **Sin cuenta** se guarda el borrador y se pide crear la cuenta; al volver, el pedido se retoma en el paso 4. En WhatsApp la identidad es el número de teléfono (pendiente: alta por WhatsApp con verificación).
- **Privacidad.** La dirección solo se comparte con el profesional cuando se confirma la visita; los mensajes ocultan teléfonos y datos de pago.

## Pendiente para WhatsApp
- Número de WhatsApp Business y app de Meta (Cloud API), webhook `/api/whatsapp` con verificación de firma.
- Plantillas aprobadas para avisos fuera de la ventana de 24 h (profesional aceptó, visita confirmada, recordatorio de reseña).
- Vincular el número a la cuenta (código por SMS/WhatsApp) antes de crear pedidos.
