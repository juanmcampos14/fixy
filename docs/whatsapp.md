# WhatsApp (Cloud API de Meta)

El bot sigue el mismo guion que la web (`docs/flujo-pedido.md`): problema → ubicación → profesionales → enviar.

## Cómo funciona
- **Webhook:** `https://www.fixy.solutions/api/whatsapp`. `GET` responde la verificación de Meta; `POST` exige la firma `X-Hub-Signature-256` (App Secret), registra cada mensaje una sola vez (Meta reintenta) y lo procesa después de responder 200.
- **Estado:** `whatsapp_conversations.state` por número; un lock por número evita que dos mensajes seguidos se pisen.
- **Identidad:** el primer pedido termina con un link `/wa/<token>` (7 días, un solo dueño). Al usarlo con sesión iniciada, el número queda vinculado a la cuenta (`users.whatsapp_phone`) y el pedido se abre listo para enviar. Desde ahí, los pedidos se crean directo desde WhatsApp.
- **Ubicación:** el usuario la comparte desde el clip. Con `GOOGLE_MAPS_SERVER_KEY` se convierte en calle y zona; sin esa clave, el bot pide la calle y reconoce la zona por el barrio escrito o pregunta la zona con botones.
- **Sin credenciales** (desarrollo/tests) los mensajes salientes se guardan con estado `simulated` y no se envían.

## Variables de entorno (Vercel → Production)
| Variable | De dónde sale |
|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Token permanente de un usuario del sistema (Business Settings → Usuarios del sistema), con permisos `whatsapp_business_messaging` y `whatsapp_business_management` |
| `WHATSAPP_PHONE_NUMBER_ID` | App de Meta → WhatsApp → Configuración de la API → "Identificador del número de teléfono" |
| `WHATSAPP_APP_SECRET` | App de Meta → Configuración de la app → Básica → "Clave secreta de la app" |
| `WHATSAPP_VERIFY_TOKEN` | Texto al azar que también se pega en Meta al configurar el webhook (ya está cargado en Vercel) |
| `WHATSAPP_DISPLAY_NUMBER` | Número público, para mostrar en el sitio (opcional) |
| `GOOGLE_MAPS_SERVER_KEY` | Clave de Google **distinta** a la del navegador, restringida a "Geocoding API" (opcional, mejora la ubicación) |

## Pendiente
- Plantillas aprobadas por Meta para avisar fuera de la ventana de 24 h (profesional aceptó, visita confirmada, recordatorio de reseña).
- Avisos de novedades del pedido por WhatsApp a números vinculados.
- Recibir fotos desde WhatsApp (descarga de medios de la Graph API).
