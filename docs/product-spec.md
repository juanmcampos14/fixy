# Fixy — Especificación de producto (MVP)

> Nombre comercial: **Fixy** (fixy.solutions). Nombre de trabajo original del brief: "Resuelve". La identidad sigue `docs/brand-manual.md`.

## Propuesta de valor
"Contanos qué pasa. Encontrá quién lo resuelva." Fixy conecta hogares, oficinas y pequeñas empresas con profesionales independientes y empresas de servicios para reparación, instalación y mantenimiento, y reúne en un solo lugar el pedido, los presupuestos, la contratación, la coordinación, el pago, el seguimiento, los reclamos y el historial de cada propiedad.

## Supuestos iniciales (documentados y reversibles)
| Tema | Decisión |
|---|---|
| País / cobertura | Argentina. Zonas configurables en BD: CABA (8 zonas) y GBA Norte/Oeste/Sur (9 zonas). |
| Idioma / tono | Español argentino con voseo (manual de marca). |
| Moneda | ARS. Importes en centavos (enteros) con moneda explícita. |
| Zona horaria | America/Argentina/Buenos_Aires (formateo en interfaz). |
| Plataforma | Web responsive mobile-first, preparada para PWA. Sin apps nativas. |
| Clientes | Particulares y organizaciones (con sedes y miembros). |
| Proveedores | Independientes y empresas con técnicos. Registro abierto. |
| Monetización | Comisión configurable: por defecto 10 % al proveedor (descontada de su neto) + 5 % de cargo de servicio al cliente. Configurable por categoría. Impuestos sobre el cargo: configurable, 0 por defecto (pendiente definición fiscal). |
| Presupuestos | Pedir presupuestos es gratis. |
| Pagos | Modo de prueba (pasarela simulada) mientras no haya credenciales y validación comercial. Ver `docs/payments.md`. |
| Asistente | Reglas locales por defecto; adaptador opcional de IA (Claude) en servidor. |
| "Resolver cualquier problema" | Catálogo ampliable + categoría "Otro / no sé" que deriva a revisión humana. No se promete cobertura universal ni inmediatez. |

## Roles
| Rol | Alcance |
|---|---|
| Cliente particular | Sus propiedades, pedidos, trabajos, pagos, reclamos y reseñas. |
| Administrador de organización | Sedes, miembros, todos los trabajos y gastos de la organización, datos de facturación. |
| Miembro de organización | Crea pedidos para sedes; ve los pedidos que creó o de los que es responsable. |
| Administrador de proveedor | Perfil, documentación, cobertura, presupuestos, equipo, trabajos, cobros. |
| Técnico de proveedor | Solo trabajos asignados; registra avances; no ve dinero ni presupuestos. |
| Operador de plataforma | Revisión de proveedores, solicitudes, reclamos, liquidaciones y reembolsos (con motivo). |
| Administrador de plataforma | Todo lo anterior + catálogo, cobertura, comisiones, configuración, ajustes contables. |

Una misma cuenta puede ser cliente y proveedor (membresías separadas). Los roles de plataforma solo se asignan desde la base/administración; el registro nunca los otorga.

## Alcance del MVP (implementado)
1. **Sitio público**: landing (propuesta, campo "¿Qué necesitás resolver?", categorías, cómo funciona, transparencia de precios, hogares, empresas, proveedores, FAQ), "Ofrecé tus servicios", perfil público de profesionales, términos y privacidad (borradores).
2. **Asistente de pedido** (`/solicitar`): texto libre → sugerencia de categoría + orientación de seguridad → preguntas por categoría → lugar, urgencia, franjas, acceso → resumen editable → envío. Funciona sin cuenta: guarda borrador (cookie httpOnly + token hasheado) y lo asocia al registrarse.
3. **Panel del cliente** (`/app`): inicio con acciones pendientes, solicitudes con estado de búsqueda, comparación de presupuestos, contratación atómica, pago (prueba), trabajo con línea de tiempo, mensajes, adicionales, reprogramaciones, evidencias, conformidad, reclamos, reseñas, "volver a contratar", propiedades con historial y gastos, pagos con comprobantes.
4. **Organizaciones**: perfil, sedes, miembros, responsable por pedido, historial y gastos con filtros (período, sede, proveedor, categoría, estado) y exportación CSV.
5. **Panel del proveedor** (`/proveedor`): alta guiada, estados separados, oportunidades (sin datos sensibles), presupuestos con neto en vivo, agenda, trabajos, técnicos, evidencias, adicionales, cobros/liquidaciones, reseñas.
6. **Panel de operación** (`/admin`): indicadores, revisión de proveedores y documentos, solicitudes (revisión, matching, invitación manual), trabajos, reclamos, finanzas (cobros, liquidaciones, reembolsos, conciliación, registro financiero), catálogo, comisiones, auditoría.

## Fuera del MVP (segunda etapa; el modelo ya lo contempla)
Apps nativas, suscripciones y mantenimiento recurrente, aprobaciones empresariales por monto (`organization_members.approval_limit_minor`), centros de costo, GPS en tiempo real, expansión internacional, WhatsApp, facturación fiscal, contracargos reales.

## Recorrido principal (verificado por prueba automatizada)
Profesional se registra → operador lo aprueba → cliente describe un problema → el matching invita al proveedor → cotiza → cliente acepta y paga (modo de prueba) → proveedor ejecuta y registra evidencias → cliente confirma → liquidación simulada → cliente califica. Ver `tests/integration/flow.test.ts`.

## Principios de confianza
- No se muestran verificaciones sin proceso real: solo "Identidad verificada" (documento aprobado por operación) y "<credencial> vigente" (documento aprobado y no vencido).
- No se inventan testimonios, cifras, disponibilidad 24/7, tiempos de llegada ni garantías. Perfiles, reseñas y pagos de demostración están marcados.
- Antes de contratar, el proveedor solo ve zona y tipo de propiedad; la dirección y los datos de acceso se revelan al proveedor contratado con el pago aprobado.
- Toda intervención sensible requiere motivo y queda auditada.
