---
name: fixy-harden-auth
description: Endurecer la autenticación, las sesiones y la autorización de Fixy. Usar al implementar verificación de email, MFA o step-up para personal, sesiones por dispositivo, rotación de tokens, parámetros de contraseña, Google OIDC, handoff móvil, permisos de equipo, RLS o pruebas de seguridad de identidad en el repositorio Fixy.
---

# Endurecer identidad y acceso en Fixy

Trabajar sobre el repositorio Fixy como una mejora incremental. Conservar Next.js, PostgreSQL, las sesiones propias y la arquitectura modular salvo que una evidencia técnica obligue a cambiarlos.

## Resultado obligatorio

Entregar un sistema en el que:

- ningún email clásico se considere verificado sin demostrar su propiedad;
- las cuentas privilegiadas tengan autenticación reforzada;
- las sesiones puedan identificarse, rotarse y revocarse;
- Google OIDC se valide con una biblioteca mantenida;
- la autorización de aplicación y RLS apliquen mínimo privilegio;
- todas las rutas de acceso queden cubiertas con pruebas negativas.

## Reglas de seguridad

- No debilitar cookies `httpOnly`, `Secure` o `SameSite`.
- No guardar tokens, códigos, secretos, contraseñas ni OTP en texto plano.
- No registrar PII completa, credenciales ni payloads de identidad.
- No confiar en roles, IDs, emails ni permisos enviados por el navegador.
- No habilitar cuentas o permisos sensibles sólo porque la UI los oculta.
- No migrar usuarios existentes de forma destructiva ni invalidarlos sin plan de transición.
- No probar con cuentas, proveedores OAuth o secretos de producción.

## Contexto técnico que se debe inspeccionar

Leer antes de modificar:

- `AGENTS.md` y documentación aplicable.
- `src/server/auth/`.
- `src/server/modules/users.ts`, `team.ts`, `authz.ts` y `account.ts`.
- `src/app/(auth)/`, `src/app/auth/`, `src/app/wa/` y `src/app/api/push/route.ts`.
- `src/server/db/client.ts`, `src/server/auth/permissions.ts` y `actor.ts`.
- Migraciones `0003_access.sql`, `0022_admin_team.sql`, `0038_app_login_handoff.sql`, `0039_whatsapp_signup.sql` y `0040_email_unverified.sql`.
- Pruebas de auth, RLS, equipo, recuperación, Google y handoff móvil.

Buscar además todos los usos de `email_verified`, `createSession`, `platform_role`, `app.is_staff`, `sql()` y `asUser()`.

## Flujo de trabajo

### 1. Establecer línea base

1. Revisar `git status` y preservar cambios ajenos.
2. Ejecutar typecheck, lint y pruebas unitarias de identidad.
3. Ejecutar pruebas de integración si PostgreSQL está disponible.
4. Documentar cualquier prueba que no pueda ejecutarse; no simular un éxito.

### 2. Corregir la verificación de email

Implementar este recorrido:

```text
registro -> usuario no verificado -> token de un solo uso -> confirmación -> email verificado
```

Requisitos:

- Crear usuarios clásicos con `email_verified = false` de forma explícita.
- Generar tokens aleatorios de alta entropía y guardar sólo su hash.
- Añadir expiración, uso único, reenvío con rate limit e invalidación de tokens anteriores.
- Responder de forma que no permita enumerar cuentas.
- Permitir iniciar una sesión limitada si el producto lo necesita, pero bloquear pagos, datos sensibles, cambios de email y roles hasta verificar.
- Definir una migración segura para usuarios existentes: no asumir silenciosamente que todos son legítimos.
- Evitar que un email no verificado reciba recuperación de contraseña o notificaciones privadas.

### 3. Reforzar contraseñas y sesiones

- Migrar progresivamente a Argon2id o a scrypt con parámetros alineados con OWASP y medidos en el entorno objetivo.
- Versionar el formato del hash y hacer rehash al autenticar cuando los parámetros sean antiguos.
- Mantener comparación de tiempo constante.
- Añadir metadatos mínimos a sesiones: creación, última actividad, expiración, agente/dispositivo aproximado y fecha de revocación.
- Rotar el token al iniciar sesión, cambiar contraseña, verificar email y elevar privilegios.
- Implementar expiración absoluta e inactiva, con una política más corta para staff.
- Permitir listar y cerrar sesiones propias; al cambiar contraseña, revocar las demás.

### 4. Reforzar cuentas privilegiadas

- Exigir MFA, passkey o step-up equivalente para `admin`, `operator`, miembros con `manage` y acciones financieras.
- Requerir reautenticación reciente para cambios de permisos, reembolsos, liquidaciones, secretos y exportaciones sensibles.
- Registrar eventos de seguridad sin exponer secretos.
- Añadir recuperación segura del segundo factor con códigos de respaldo hasheados y procedimiento operativo.

### 5. Corregir Google OIDC y handoff móvil

- Sustituir el parseo manual por `google-auth-library`, `jose` o biblioteca equivalente mantenida.
- Validar firma/JWKS, algoritmo permitido, `iss`, `aud`, `azp` cuando aplique, `exp`, `iat`, `nonce` y `sub`.
- Mantener Authorization Code, PKCE, `state`, `nonce` y llamadas server-to-server.
- Identificar cuentas por `sub`, no por email mutable.
- Conservar el enlace automático por email sólo si el email está criptográficamente verificado y existe una política explícita de recuperación de cuentas.
- En el handoff móvil, bloquear la fila, comprobar el verifier y marcar el código como usado sólo cuando coincida.

### 6. Aplicar mínimo privilegio

- Revisar rutas de panel que usan `sql()` con conexión propietaria.
- Mover lecturas sensibles a repositorios que usen `asUser()` y RLS.
- Evitar que `team` herede lectura total sólo por ser staff. Separar al menos finanzas, documentos de identidad, auditoría y datos de contacto.
- Mantener las escrituras privilegiadas dentro de servicios que validen el `Actor` y el permiso exacto.
- Añadir una regla estática que impida nuevos accesos privilegiados desde páginas y acciones salvo excepción documentada.

## Pruebas mínimas

Cubrir al menos:

- registro nuevo permanece sin verificar;
- token válido verifica una vez; expirado, repetido o manipulado falla;
- reenvío respeta límites y no enumera usuarios;
- usuario no verificado no accede a operaciones sensibles;
- cambio de contraseña revoca sesiones anteriores;
- sesión expirada, revocada o de usuario deshabilitado falla;
- Google rechaza firma, issuer, audience, nonce, expiry y subject inválidos;
- handoff con verifier incorrecto no consume el código válido;
- cada rol de equipo sólo ve y ejecuta su sección autorizada;
- acceso cruzado entre usuarios, organizaciones y proveedores es rechazado por RLS;
- pruebas de concurrencia para verificación, linking y revocación.

## Criterios de aceptación

No declarar terminada la skill hasta que:

- el registro clásico no produzca emails verificados por defecto;
- exista un flujo completo de verificación y transición para cuentas antiguas;
- las cuentas privilegiadas requieran autenticación reforzada;
- el flujo Google use validación criptográfica mantenida;
- las sesiones sean rotables, observables y revocables;
- las pruebas negativas de RLS y permisos pasen;
- typecheck, lint, unitarias, integración y reglas estáticas estén verdes;
- se entregue una nota de migración, rollback y cambios de configuración sin incluir secretos.

## Entrega al programador

Producir:

1. migraciones reversibles o con rollback documentado;
2. cambios de servidor y UI mínima necesaria;
3. pruebas unitarias, integración y concurrencia;
4. lista de variables nuevas y procedimiento de rotación;
5. matriz de roles y acciones sensibles;
6. resumen de riesgos residuales y pasos manuales de despliegue.

