# Convenciones de UI y código (para quien construya pantallas)

## Stack
- Next.js 16 App Router (server components por defecto), React 19, Tailwind CSS v4 (tokens en `src/app/globals.css`), TypeScript estricto.
- `params` y `searchParams` son Promises: `const { id } = await params`.
- Postgres con `postgres` (postgres.js). Importes en centavos (enteros). Formateo con `formatMoney`, `formatDate`, `formatDateTime`, `relativeTime` de `@/lib/format`.

## Datos
- **Lecturas de paneles**: `asUser(actor.id, async (tx) => tx\`...\`)` de `@/server/db/client`. Corre con el rol `fixy_app` + RLS: solo devuelve lo que el usuario puede ver. Usar para todo lo que muestre datos de un usuario/proveedor/organización.
- Vistas seguras: `user_names (id, full_name)` y `provider_public` (sin CUIT, facturación ni cuenta de cobro). Nunca seleccionar `tax_id`, `billing_info`, `payout_account_ref` para mostrarlos a terceros.
- Datos sensibles de acceso en `request_private` (RLS: solo cliente, operación o proveedor contratado con pago aprobado). Dirección exacta en `properties` (misma regla). Antes de contratar, el proveedor ve solo zona (`zones.name` vía consulta de sistema acotada) y tipo de propiedad.
- Para datos públicos (landing, perfil público) se puede usar `sql()` directo seleccionando SOLO columnas públicas.
- **Escrituras**: siempre a través de los servicios en `src/server/modules/*` (autorizan al actor y validan estados). No escribir SQL de escritura en páginas/acciones.
- Consultas reutilizables: `src/server/queries/shared.ts` (`getJobDetail`, `timeline`, `conversationMessages`, `jobMoney`).

## Auth
- `requireActor(next?)`, `requireStaff()`, `requirePlatformAdmin()`, `requireProviderMembership()` de `@/server/auth/session` (server-only).
- `Actor` (`@/server/auth/actor`): `{ id, fullName, platformRole, organizations[{id,name,role}], providers[{id,name,role,status,slug}] }`.

## Acciones de servidor
- Archivo `actions.ts` con `"use server"`. Patrón:
  ```ts
  export async function xAction(_: ActionState, f: FormData): Promise<ActionState> {
    return act(async () => { const actor = await requireActor(); await servicio(actor, ...); revalidatePath(...); return { ok: true, message: "..." }; });
  }
  ```
  `act`, `str`, `strs`, `bool`, `files` en `@/server/action`. `act` traduce `DomainError`/Zod/DB a mensajes. Para redirigir: ejecutar `act` y si no hay error, `redirect()` fuera de `act`.
- Formularios: `<ActionForm action={xAction}>` y `<SubmitButton>` (client) de `@/components/ui/form`. Acciones sensibles: `<ConfirmAction action=... title=... requireReason hidden={{ id }} />` (diálogo con motivo obligatorio → campo `reason`).
- Importes ingresados por usuarios: `parseArsToMinor` de `@/server/domain/money` (formato "12.500,50").

## Componentes
- Layout de panel: `PanelShell` (`@/components/layout/panel-shell`) con `nav: NavItem[]` (`icon` es un string: dashboard, inbox, house, building, receipt, bell, briefcase, wallet, star, users, store, clipboard, flag, settings, scroll, coins, file, user, search, wrench).
- UI: `Card`, `CardHeader`, `PageHeader`, `Stat`, `DefinitionList` (`ui/card`); `Badge`, `StatusBadge` (con mapas de `@/server/domain/labels`), `TestModeBadge`, `DemoBadge` (`ui/badge`); `Alert`; `EmptyState` (acepta `pose` de la mascota); `Field`, `Input`, `Textarea`, `Select`, `Checkbox` (`ui/field`); `Button`, `ButtonLink`, `buttonClass`.
- Dominio: `Timeline`, `MessageThread`, `ClientPriceBreakdown`, `ProviderNetBreakdown`, `EvidenceGallery` en `src/components/domain/`. `CategoryIcon`.
- Íconos: `lucide-react` (trazo redondeado).
- Mascota `<Mascot pose="wave|listen|think|celebrate|empathy" />`: solo bienvenida, búsqueda (con texto de estado real), celebración de finalización confirmada y empatía en estados vacíos. NUNCA en desgloses de pago, controles principales ni como sello de verificación.

## Voz y diseño (docs/brand-manual.md)
- Español argentino con voseo, frases breves, verbos concretos. Sin "¡Ups!" en dinero/errores. Nunca "garantizado", "100 % seguro", "llega enseguida".
- Botón principal: verde profundo (`variant="primary"`). Naranja solo detalles. Estados siempre con texto.
- Mobile first: tarjetas, 16px+, objetivos táctiles ≥ 44px, foco visible, etiquetas en todos los campos.
- Datos ficticios: mostrar `DemoBadge` cuando `is_demo`. En pagos: dejar claro "modo de prueba" (`TestModeBadge`) si `is_test`.
- Diferenciar: volumen contratado ≠ dinero cobrado ≠ ingresos de plataforma; cobro aprobado ≠ trabajo completado ≠ liquidación pagada.

## Verificación
- `npx tsc --noEmit -p .` debe pasar. `npx eslint <rutas>`.
- Dev server en http://localhost:3000. Para probar una página autenticada con curl: `npx tsx scripts/dev-session.ts <usuario>` imprime una cookie (`curl -s -H "Cookie: fixy_session=..." http://localhost:3000/ruta`). Usuarios demo: admin, operador, ana, bruno, carla, diego, martin, lucia, roberto, jorge, valeria, pablo, sofia, hernan.
- No correr `npm test` / `db:reset` (la base es compartida mientras otros trabajan).
