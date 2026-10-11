# Formularios de privacidad de las tiendas

Respuestas para **"Privacidad de la app" (App Store Connect)** y **"Seguridad de los datos" (Google Play)**, según lo que la plataforma guarda hoy.
Si se suma analítica, publicidad o un proveedor nuevo, hay que actualizar esto y la [Política de privacidad](https://www.fixy.solutions/privacidad).

## Respuestas generales
| Pregunta | Respuesta |
|---|---|
| ¿La app recopila datos? | Sí |
| ¿Se usan para rastrear al usuario entre apps o sitios de terceros (tracking)? | **No** |
| ¿Se venden datos? | No |
| ¿Hay publicidad o SDK de anuncios? | No |
| ¿Hay analítica de terceros? | No |
| ¿Los datos viajan cifrados? | Sí (HTTPS) |
| ¿El usuario puede pedir que se borren? | Sí: en la app (Mi cuenta → Eliminar mi cuenta) y en https://www.fixy.solutions/ayuda#eliminar-cuenta |
| ¿La recopilación es obligatoria? | Nombre, correo y dirección del trabajo: sí. Teléfono, fotos, ubicación y avisos: opcionales |

## Datos por categoría
Todos quedan **vinculados a la identidad** del usuario y **ninguno se usa para rastreo**. Finalidad: "Funcionalidad de la app" salvo que se indique otra.

| Dato | Apple (tipo) | Google (tipo) | ¿Se comparte? | Notas |
|---|---|---|---|---|
| Nombre y apellido | Contact Info → Name | Información personal → Nombre | Con el profesional o cliente del trabajo | |
| Correo | Contact Info → Email | Información personal → Correo | No | También para avisos del servicio |
| Teléfono | Contact Info → Phone | Información personal → Teléfono | Con la otra parte, al confirmarse el trabajo | Opcional |
| Dirección del trabajo | Contact Info → Physical Address | Información personal → Dirección | Con el profesional elegido, recién al confirmar la visita | |
| Ubicación | Location → Precise Location | Ubicación → Precisa | No | Solo si la persona toca "usar mi ubicación"; se convierte en dirección y no se guarda el recorrido |
| Fotos | User Content → Photos or Videos | Fotos y videos → Fotos | Con la otra parte del trabajo | Fotos del problema, del trabajo terminado y del perfil profesional |
| Mensajes entre cliente y profesional | User Content → Other User Content | Mensajes → Otros mensajes en la app | Con la otra parte | |
| Descripción del pedido, reseñas, reclamos | User Content → Other User Content / Customer Support | Actividad en la app → Otro contenido generado por el usuario | Reseñas: públicas y anónimas | |
| Pagos | Purchases → Purchase History | Información financiera → Historial de compras | Con Mercado Pago (procesador) | Fixy no ve ni guarda datos de tarjetas |
| Datos bancarios del profesional (CBU/alias) | Financial Info → Other Financial Info | Información financiera → Otra información financiera | No | Solo profesionales, para transferirles sus cobros |
| DNI y matrículas del profesional | Sensitive Info: **no** · Other Data Types | Información personal → Otra información | No | Solo profesionales, para verificar identidad |
| Identificador de usuario | Identifiers → User ID | Información personal → IDs de usuario | No | |
| Token de avisos push | Identifiers → Device ID | IDs del dispositivo o de otro tipo | Con Apple / Google (envío del aviso) | Solo si permite notificaciones |

**No se recopila:** contactos, calendario, salud, historial de navegación o de búsqueda, datos de uso para analítica, diagnósticos, audio, identificador de publicidad.

## Proveedores que procesan datos (encargados)
Vercel (alojamiento), Supabase (base de datos y archivos), Mercado Pago (pagos), Google (mapas, ingreso con Google en la web, avisos push de Android), Apple (avisos push de iOS), Meta (WhatsApp, si el usuario lo usa), Anthropic (asistente), Resend (correos).
En Google Play esto **no** cuenta como "compartir" porque actúan por cuenta de Fixy; por eso la columna dice "No" salvo cuando el dato le llega a otro usuario.

## Permisos que pide la app y su texto
| Permiso | Para qué |
|---|---|
| Cámara | Sacar fotos del problema o del trabajo terminado |
| Fotos | Elegir fotos para un pedido o un trabajo |
| Ubicación (al usar la app) | Saber en qué zona es el trabajo, solo si la persona la comparte |
| Notificaciones | Avisar de presupuestos, mensajes y cambios en un trabajo |
