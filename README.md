# Fixy

**De problema a resuelto.** Plataforma que conecta hogares, oficinas y pequeñas empresas con profesionales independientes y empresas de servicios para reparación, instalación y mantenimiento: pedido guiado, matching, presupuestos comparables, contratación atómica, pagos integrados (modo de prueba), seguimiento, mensajes, adicionales, reclamos, reseñas e historial por propiedad.

> **Estado: MVP funcional en desarrollo.** Los pagos y liquidaciones son **simulados** (no mueven dinero real). Ver "Qué está listo y qué no" al final.

## Requisitos
- Node.js 20.9+ (probado con 24) y npm.
- Docker (para PostgreSQL 16 local).

## Puesta en marcha local
```bash
npm install
```
```bash
cp .env.example .env.local
```
```bash
npm run setup
```
(`setup` levanta Postgres en Docker en el puerto 54329, aplica migraciones y carga datos base + demostración.)
```bash
npm run dev
```
Abrí http://localhost:3000.

### Accesos de prueba
En http://localhost:3000/ingresar aparece "Accesos de demostración" (solo en desarrollo; deshabilitado siempre en producción). Contraseña de todas las cuentas demo: `fixy-demo-2026`.

| Cuenta | Rol / caso |
|---|---|
| `admin@demo.fixy.solutions` | Administración de plataforma |
| `operador@demo.fixy.solutions` | Operación (revisiones, reclamos, liquidaciones) |
| `ana@demo.fixy.solutions` | Cliente con 2 propiedades: presupuestos comparables, trabajo completado y calificado, reclamo abierto, pedido en revisión |
| `bruno@demo.fixy.solutions` | Cliente en GBA Sur: pedido sin cobertura |
| `carla@demo.fixy.solutions` | Admin de "Estudio Contable Delta": sedes, trabajo con adicional pendiente, liquidación pendiente |
| `diego@demo.fixy.solutions` | Miembro de la organización: diagnóstico pendiente de conformidad |
| `martin@demo.fixy.solutions` | Electricista aprobado con historial |
| `lucia@demo.fixy.solutions` | Plomera aprobada, sin reseñas |
| `roberto@demo.fixy.solutions` | Empresa proveedora con técnicos |
| `jorge@`, `valeria@demo.fixy.solutions` | Técnicos (solo trabajos asignados) |
| `pablo@demo.fixy.solutions` | Gasista en revisión |
| `sofia@demo.fixy.solutions` | Alta de proveedor incompleta |
| `hernan@demo.fixy.solutions` | Proveedor suspendido |

### Scripts
| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` / `npm start` | Build y servidor de producción |
| `npm run lint` · `npm run typecheck` | ESLint y TypeScript |
| `npm test` | Pruebas unitarias e integración (usa `fixy_test`, que se recrea) |
| `npm run db:up` | Postgres en Docker |
| `npm run db:migrate` | Aplica migraciones pendientes |
| `npm run db:seed` | Datos base (+ demo si `DEMO_MODE=true` o `-- --demo`) |
| `npm run db:reset` | Borra y recrea la base local con datos demo |
| `npm run outbox` | Procesa emails pendientes (en producción: cron `/api/cron/outbox`) |
| `npm run admin:create` | Crea/promueve un administrador (`ADMIN_EMAIL`, `ADMIN_PASSWORD`) |

## Documentación
- `docs/product-spec.md` — producto, supuestos, roles, alcance.
- `docs/architecture.md` — arquitectura, seguridad, respaldo, entornos.
- `docs/data-model.md` — entidades, aislamiento, índices.
- `docs/state-machines.md` — estados, transiciones y actores.
- `docs/payments.md` — modelo de pagos, Mercado Pago, checklist para dinero real.
- `docs/deployment.md` — **cómo publicarlo en fixy.solutions** (Vercel + Supabase).
- `docs/implementation-plan.md` — etapas, verificaciones y pendientes.
- `docs/brand-manual.md`, `docs/ui-conventions.md` — marca y convenciones de UI.
- `docs/research/` — investigación de Mercado Pago y referencias.

## Qué está listo y qué no
1. **MVP funcional en desarrollo** (implementado y probado): registro y revisión de proveedores, catálogo, propiedades y organizaciones, solicitudes con asistente, matching, presupuestos, contratación atómica, trabajos, mensajes, notificaciones (internas + outbox), evidencias, adicionales, reprogramaciones, pagos simulados con webhooks idempotentes, registro financiero, liquidaciones simuladas, reembolsos, reclamos, reseñas, auditoría, paneles de cliente/organización/proveedor/operación.
2. **Integraciones reales verificadas**: ninguna. Mercado Pago está evaluado y con verificación de firma de webhooks implementada, pero **no activado**. Email real disponible vía Resend (requiere configurar). Asistente de IA opcional (Claude) implementado, desactivado por defecto.
3. **Pendiente para operar con clientes y dinero reales**: ver `docs/implementation-plan.md` → "Requisitos para operar".
