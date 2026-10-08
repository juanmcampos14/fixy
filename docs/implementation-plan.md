# Plan de implementación, estado y pendientes

## Etapas
| # | Etapa | Estado | Verificación |
|---|---|---|---|
| 1 | Base técnica, autenticación y permisos | ✅ | Migraciones 0001–0005, RLS, funciones `app.*`, sesiones, rate limit. Pruebas de aislamiento. |
| 2 | Registro y revisión de proveedores | ✅ | Alta guiada, documentos privados, cobros (simulado), envío a revisión, aprobación/observación/rechazo/suspensión con motivo. Prueba de recorrido completo. |
| 3 | Catálogo, propiedades y solicitudes | ✅ | 13 categorías, 8 servicios, preguntas, 17 zonas; asistente por reglas; borradores sin cuenta (probado en navegador). |
| 4 | Matching y presupuestos | ✅ | Matching determinista con razones; invitación acotada; presupuestos con desglose y neto; vencimientos. |
| 5 | Contratación y ejecución | ✅ | Aceptación atómica (prueba de concurrencia y doble clic), contrato inmutable, estados, evidencias, adicionales, reprogramaciones, técnicos. |
| 6 | Pagos simulados y registro financiero | ✅ | Webhooks firmados idempotentes, fuera de orden, monto distinto, reintentos, reembolsos, liquidaciones, conciliación, ledger balanceado e inmutable. |
| 7 | Mensajería y notificaciones | ✅ | Conversaciones por participantes, adjuntos privados, notificaciones internas, outbox con reintentos, adaptador email (consola/Resend). |
| 8 | Organizaciones y administración | ✅ | Sedes, miembros, filtros, CSV; panel de operación con indicadores, revisión, finanzas, catálogo, comisiones, auditoría. |
| 9 | Reclamos y reseñas | ✅ | Reclamo con evidencia, pausa de liquidación, resolución con reembolso vinculado, una reseña por trabajo. |
| 10 | Verificación, accesibilidad y documentación | ✅ | Typecheck, lint, 32 pruebas, smoke test HTTP por rol, prueba en navegador desktop y móvil (375 px sin scroll horizontal). |

## Cómo verificar
```bash
npm run typecheck
```
```bash
npm run lint
```
```bash
npm test
```
Con `npm run dev` corriendo:
```bash
npx tsx scripts/smoke.ts
```

## Decisiones reversibles tomadas
- Nombre y marca: Fixy (manual de marca provisto). Tokens centralizados en `globals.css`; logo vectorial provisional en `components/brand/logo.tsx`.
- Sesiones propias en lugar de Supabase Auth (ver `docs/architecture.md`).
- Comisión por defecto 10 % proveedor + 5 % cliente; impuestos 0 hasta definición fiscal.
- Cobro del total al aceptar (demo pedida en el brief). Para producción con Mercado Pago se evalúa cobrar al finalizar (`docs/payments.md`).
- Reclamos: ventana de 15 días después de completado.
- Matching: invita hasta 4 proveedores (configurable en `/admin/comisiones` → configuración).
- Solo la categoría Gas exige credencial para recibir oportunidades (configurable).
- Modelo de IA del asistente opcional: `claude-opus-5-5` por defecto (configurable con `ASSISTANT_MODEL`; un modelo más económico puede bastar para clasificar — decisión de costo del negocio).

## Limitaciones conocidas del MVP
- Técnicos no pueden proponer reprogramaciones (lo hace el administrador del proveedor).
- El editor de disponibilidad maneja una franja por día.
- Un usuario con varios proveedores opera el primero (sin selector).
- Documentos de proveedor: se suben nuevos; no hay reemplazo/borrado.
- Invitaciones a organizaciones solo para cuentas existentes (sin email de invitación).
- Al abrir una oportunidad se marca como vista durante el render (escritura en carga de página).
- La configuración `quotes.default_valid_days` todavía no se usa como valor por defecto del formulario de presupuesto.
- Al cerrar un trabajo por resolución de reclamo solo se envía la notificación del reclamo.
- El equipo de un proveedor muestra nombres, no emails (por la política de privacidad de `users`).
- Subidas en Vercel limitadas a ~4,5 MB por envío (pendiente: subida directa firmada a Storage).
- Sin contracargos reales, sin facturación fiscal, sin anticipo/saldo.
- Accesibilidad: revisada manualmente (etiquetas, foco visible, contraste de tokens, navegación por teclado en diálogos nativos); falta auditoría con lector de pantalla y herramienta automática.

## Requisitos para operar con clientes y dinero reales
**Pagos y dinero**
- [ ] Checklist completo de `docs/payments.md` (validación con Mercado Pago, sandbox, OAuth de vendedores, flujo de cobro definitivo).
- [ ] Revisión legal y contable: rol de la plataforma, facturación de comisiones, IVA del cargo de servicio, ingresos brutos.
- [ ] Política de cancelación, reembolsos y reclamos definitiva publicada.
**Legal y confianza**
- [ ] Términos, privacidad y condiciones de proveedores revisados por abogado (Ley 25.326, Defensa del Consumidor); registrar base de datos si corresponde.
- [ ] Proceso operativo real de verificación de identidad y matrículas (quién revisa, criterios, vencimientos, re-verificación).
- [ ] Definir si se ofrecerán garantías o seguros (hoy no se publican).
**Producto y operación**
- [ ] Equipo y horarios de operación para revisiones, pedidos sin respuesta y reclamos; SLA internos.
- [ ] Email transaccional con dominio verificado (Resend) y plantillas.
- [ ] Captación inicial de proveedores por zona/categoría para evitar "sin cobertura".
- [ ] Analítica respetuosa de la privacidad y monitoreo de errores (ej.: Sentry) sin datos personales.
**Técnico**
- [ ] Supabase Pro con backups diarios + PITR; restauración probada.
- [ ] Entorno de staging separado.
- [ ] Subida directa de archivos a Storage con URL firmada (evita el límite de Vercel) y compresión de imágenes.
- [ ] Opcional: migrar a Supabase Auth (reemplazar `auth/session.ts`, mapear `app.uid()` a `auth.uid()`), verificación de email y recuperación de contraseña (hoy no implementadas).
- [ ] Cron frecuente para outbox y vencimientos (plan Vercel Pro o cron externo).
- [ ] Pruebas end-to-end automatizadas en navegador (Playwright) en CI.
