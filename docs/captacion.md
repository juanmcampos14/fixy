# Captación de profesionales

Dos vías, un solo backend (`supply_leads`, migración 0048). Panel: **/admin/captacion** (sección «Captación»).

## Las dos vías

| Vía | Cómo entra | Código |
|---|---|---|
| Research (planilla PROVEEDORES) | Sincronización diaria 7:00 (cron `supply-sync`), botón «Sincronizar ahora», o CSV | `FX-001…` (lo pone la planilla) |
| Carga manual | Formulario «Cargar un candidato» | `AL-0001…` |
| Alta espontánea (web, campañas, WhatsApp) | Al crearse el perfil (`createProviderTx` → `attachLeadOnSignupTx`) | Vincula por código, teléfono o email; si no hay, crea `AL-…` con la campaña |

Un candidato **no** es un profesional registrado. Al registrarse se vincula a su perfil y las etapas
Registrado → Verificado → Activo salen del perfil real (cron `requests`, cada 10 minutos). Contactado e Interesado los marca el equipo.

## Planilla

- Variables: `SUPPLY_SHEET_ID` (por defecto, la planilla CRM de research) y `SUPPLY_SHEET_TAB` (`PROVEEDORES`).
- Acceso: compartir la planilla **como lector** con el `client_email` de `FIREBASE_SERVICE_ACCOUNT` y activar la
  *Google Sheets API* en ese proyecto de Google Cloud. Sin eso, la corrida queda «Falló» con el motivo en el panel.
- Columnas por nombre (el orden puede cambiar): ID, Nombre comercial, Oficio, Localidad base, Teléfono comercial, Email comercial, Sitio / perfil.
- Idempotente por ID. Los nuevos entran; de los existentes solo se completan datos vacíos. Etapa, notas, responsable
  y «no contactar» nunca se pisan. Un ID nuevo con el teléfono o email de otro candidato se saltea y se informa.
- La planilla queda como respaldo; la fuente de verdad es Fixy.
- Carga inicial (ya hecha en producción el 23-10-2026: 336 candidatos y 43 barrios cerrados): `npx tsx scripts/supply-import.ts proveedores.csv barrios.csv`.

## Campañas

Los links de campaña llevan `utm_source`, `utm_medium`, `utm_campaign` (y `utm_content` / `utm_term`):
`https://www.fixy.solutions/sumate/plomeros?utm_source=meta&utm_campaign=plomeros-zn`.
La landing los pasa a `/sumate/registrarme`, que los guarda en la cookie `fixy_signup` junto con el oficio (que llega
preelegido al alta guiada). Quedan en `providers.signup_utm` y en el candidato. El gasto se carga por canal y mes
con el mismo nombre que `utm_source`, para ver costo por registrado y por activo.

## Campañas (/admin/captacion/campanas)

Una campaña toma candidatos del mismo backend (no hay un CRM aparte): oficio, región o zonas puntuales, canal y
tamaño. Solo entran candidatos sin registrarse, sin «no contactar», sin otra campaña abierta (ni enviada en los
últimos 60 días) y con el canal (celular o email). Se arma en **borrador**: se revisa el texto («Así le llega»), se
saca a quien no corresponda y recién ahí se activa.

- **No se activa sin requisitos** (Campañas › Requisitos): número de WhatsApp comercial y revisión de políticas
  (WhatsApp y/o email). Para email, además, Resend configurado. La inscripción de la base ante la AAIP es
  recomendada pero no bloquea: desde el 30-10-2026 el dueño decidió operar sin ella y asume esa responsabilidad.
- **WhatsApp asistido.** La cola muestra un candidato por vez con el mensaje armado. «1. Abrir WhatsApp» abre el
  chat (desde el número comercial del teléfono o la computadora de quien envía); recién después se habilita
  «2. Ya lo mandé». Tope diario por campaña (20 por defecto): un número nuevo que manda mucho de golpe se bloquea.
- **Email automático.** Lunes a sábado de 9 a 19 (tarea `supply-outreach`, cada hora), con tope diario. Cada
  email lleva quién escribe (FLIPS S.R.L.), por qué tenemos el dato, link de baja y encabezado List-Unsubscribe.
  La baja pide confirmar con un botón (/captacion/baja) para que los lectores de links no den de baja a nadie.
- **Seguimiento.** A los N días sin respuesta vuelve a la cola con el mensaje de seguimiento, hasta el máximo de
  intentos; después queda «sin respuesta».
- **Respuestas.** Las respuestas llegan al número comercial: se anotan en la campaña (le interesa / no le interesa
  / pidió BAJA). Los clics en el link (`/alta?ref=`, `/sumate/registrarme?ref=`) y los registros se detectan solos.
- Textos: `{nombre} {negocio} {oficio} {zona} {link} {web} {baja}`. Cada mensaje tiene que tener `{link}` o `{web}`
  (vincula la respuesta) y, en WhatsApp, `{baja}`.

## WhatsApp automático (API de Meta + Kommo)

Mismo esquema que Aikestar (`aikestar-metricas`): Fixy manda desde el número comercial (+54 9 11 6600-6676, conectado
a Kommo por la vía oficial) las plantillas de marketing aprobadas por Meta, y Kommo es la bandeja de las respuestas.

- **Configuración (Vercel → Fixy → Environment Variables):** `SUPPLY_WHATSAPP_PHONE_NUMBER_ID` (ID del número en la
  API; en Aikestar › Seguimiento hay un listado de los números de la cuenta), `SUPPLY_WHATSAPP_WABA_ID` (cuenta de
  WhatsApp Business del número), `SUPPLY_WHATSAPP_TOKEN` (token del usuario del sistema del portfolio, el mismo que usa
  Aikestar si el número está en ese portfolio), `KOMMO_TOKEN` y `KOMMO_SUBDOMINIO` (integración privada de Kommo).
- **Una vez:** Campañas › Requisitos › «Crear plantillas en Meta» (`fixy_invitacion_profesional_v1` y
  `fixy_invitacion_recordatorio_v1`, con botones «Quiero sumarme» → `/alta?ref=<código>` y «No me interesa») y
  «Armar embudo en Kommo» («Captación Fixy»: Invitado, Recordatorio, Respondió, Interesado, Se registró, No le interesa / Baja).
- **Envío:** tarea `supply-outreach`, cada hora, lunes a sábado de 9 a 19, hasta el tope diario de la campaña. Cada
  envío crea (o mueve) el lead en Kommo con una nota del mensaje. Recordatorio a los N días con la segunda plantilla.
- **Respuestas:** llegan a Kommo. El equipo mueve el lead: «Respondió» o «Interesado» cortan los recordatorios
  (Interesado pasa la etapa en Fixy); «No le interesa / Baja» lo marca «no contactar» para siempre. Quien se registra
  pasa solo a «Se registró».
- **Frenos:** no sale nada si la plantilla no está aprobada o si Meta marca el número en calidad amarilla o roja;
  los números sin WhatsApp (131026) o que no aceptan marketing (131050) se saltean.
- Se puede enviar sin consentimiento previo: decisión del dueño (30-10-2026), con pocos mensajes diarios.

## Bases con consentimiento

Captación › Cargar y sincronizar › «Subir una base»: CSV con Nombre, Oficio, Localidad, Teléfono y Email (el ID es
opcional; sin ID se asigna un código AL-). Si se marca «dieron su consentimiento para recibir WhatsApp de Fixy», hay que
decir de dónde sale, y queda registrado en cada contacto (fecha y origen) y en su historial. Volver a subir el mismo
archivo no duplica. Al armar una campaña se puede elegir «Solo contactos con consentimiento». Guardar aparte el
respaldo del consentimiento: es lo que se pide ante un reclamo.

El envío por WhatsApp es siempre asistido (la persona aprieta enviar desde WhatsApp Business): automatizar la app
viola las condiciones de WhatsApp y hace que bloqueen el número.

## Fuente de cada contacto

Columna **«Fuente»** en la planilla (URL de donde salió el dato). Se guarda en `source_url` solo si estaba vacía:
nada de lo ya levantado se pisa, y el respaldo de la fila (`research_data`) suma columnas nuevas sin cambiar las
anteriores. La ficha la clasifica: su propio sitio, directorio o red, u otra página (`src/lib/lead-source.ts`).

## API de solo lectura (ChatGPT / Claude)

Claves en Captación › API e integraciones (se muestran una vez; se guarda el hash; vencimiento; revocables; piden
el segundo factor reciente). Límite: 120 consultas por minuto. Cada consulta queda en `api_key_requests` (180 días).
No entrega teléfonos ni emails de los candidatos.

- Especificación: `GET /api/v1/openapi.json` (para un GPT personalizado: Acciones › Importar desde URL; autenticación
  «Clave de API», tipo Bearer).
- `GET /api/v1/captacion/{resumen|oficios|zonas|localidades|canales|campanas|candidatos}`
- `POST /api/v1/captacion/verificar` con `{ "items": [{ "telefono", "email", "web" }] }`: ¿ya lo tenemos? (para
  no duplicar el research).

## Contacto (políticas)

- **El primer contacto lo hace una persona**, desde un WhatsApp Business comercial separado o por llamada. Nunca desde
  el número del bot: Meta no permite mensajes en frío a quien no escribió primero y el número se puede bloquear.
- El botón «Abrir WhatsApp con la invitación» arma el mensaje con el link `/alta?ref=fx-001`: la persona manda el
  mensaje escrito al bot y el alta queda vinculada a su candidato.
- Si pide no ser contactado: «Pidió que no lo contactemos». Queda marcado para siempre (derecho de oposición,
  Ley 25.326) y el panel bloquea nuevos contactos.
- Base de datos: los candidatos son datos personales de fuentes públicas con fin comercial. La inscripción de la
  base ante la AAIP es responsabilidad de FLIPS S.R.L.

## Métricas del panel

Por oficio (candidatos, en contacto, registrados, activos en Fixy, pedidos 30 días, pedidos por activo — arriba los
de menos oferta), altas por semana, por canal (conversión y costo), por localidad base y cobertura por zona (activos
que la cubren y barrios cerrados de referencia). Localidad base ≠ zonas de cobertura.
