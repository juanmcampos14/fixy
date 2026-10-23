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
