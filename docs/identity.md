# Identidad y acceso

Resultado de las Etapas 0 y 2 de la auditoría técnica (skill `fixy-harden-auth`).

## Cómo se entra
| Vía | Qué se prueba | Notas |
|---|---|---|
| Email y contraseña | La contraseña (scrypt N=2^17, r=8, p=1) | El email queda sin confirmar hasta abrir el enlace (48 h, un uso). Sin confirmar no paga, no cobra ni se suma al equipo. |
| Google | Firma del id_token (JWKS de Google con `jose`), emisor, audiencia, azp, vencimiento, nonce | La cuenta se identifica por `sub`. Vincula una cuenta clásica solo con email verificado por Google y anula su contraseña. |
| WhatsApp | El número (link de un solo uso, 15 min) | Cuenta sin email propio. |
| App (Google) | Código de 2 min atado a un secreto de la app | Solo se gasta con el secreto correcto. |

Contraseñas con parámetros viejos se vuelven a cifrar al ingresar (`needsRehash`).

## Sesiones
- Token aleatorio de 32 bytes; en la base solo su hash. Cookie `httpOnly`, `SameSite=Lax`, `Secure` en producción.
- Clientes y profesionales: máximo 30 días, vencen tras 14 días sin uso.
- Equipo: máximo 7 días, vencen tras 12 horas sin uso.
- "Mi cuenta → Sesiones abiertas" lista dispositivos (navegador y red aproximada) y permite cerrarlos.
- Cambiar la clave cierra las demás sesiones; restablecerla cierra todas. Verificar el segundo factor cambia el token.

## Segundo factor (equipo)
- Obligatorio para entrar a `/admin` (admin, operator y team), salvo cuentas de demostración o de revisión de tiendas.
- TOTP de 6 dígitos (cualquier app de autenticación), ±30 s de tolerancia, un código no se acepta dos veces.
- 10 códigos de respaldo de un solo uso (solo su hash en la base).
- El secreto se guarda cifrado con AES-256-GCM. **Requiere `MFA_ENCRYPTION_KEY` en Vercel** (32+ caracteres aleatorios,
  por ejemplo `openssl rand -base64 48`). Sin esa variable, el panel avisa y no pide el código.
- Si alguien pierde el celular y los códigos: el dueño lo reinicia desde Equipo (con motivo; cierra sus sesiones).
- **No cambies `MFA_ENCRYPTION_KEY` una vez cargada**: los secretos guardados dejarían de poder leerse y todo el equipo
  tendría que volver a activarlo (el dueño reinicia a cada uno).

### Acciones que piden el código de nuevo (últimos 15 minutos)
Reembolsar, cancelar un trabajo desde operación, resolver reclamos, ejecutar liquidaciones, pagar retiros, ajustes
manuales, liberar sin reseña, saldar o condonar recuperos, reintentar reembolsos, cambiar cargos, invitar, cambiar o
quitar permisos del equipo y reiniciar el segundo factor de otro.

## Permisos del equipo en la base (RLS)
| Datos | Quién del equipo los lee |
|---|---|
| Registro financiero, eventos de pago, cuentas bancarias, retiros, recuperos | Finanzas |
| Cobros, liquidaciones | Finanzas, Trabajos, Reclamos |
| Documentos de identidad y archivos privados de profesionales | Profesionales |
| Auditoría | Auditoría |
| Resto de la operación | Todo el equipo (como antes) |

admin y operator ven todas las secciones. Las escrituras siempre pasan por los servicios, que validan el permiso exacto.
Deuda conocida: algunas páginas del panel leen con la conexión del servidor (Semgrep `fixy-lectura-privilegiada-en-pagina`).

## Migraciones y vuelta atrás
- 0041 confirmación de email · 0042 dispositivos atados a la sesión · 0044 sesiones, segundo factor y RLS por sección.
- Volver atrás 0044 (no recomendado): restaurar `app.can_see_provider_finance` y las políticas con `app.is_staff`
  (ver 0003 y 0014), y quitar `requireStaff → mfaGate`. Las tablas nuevas pueden quedar.
