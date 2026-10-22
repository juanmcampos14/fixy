# Deuda técnica pendiente (después de la auditoría)

Priorizada. "Dueño" es quién tiene que moverla; "Listo cuando" es el criterio de cierre.

| # | Qué | Por qué importa | Dueño | Listo cuando |
|---|---|---|---|---|
| 1 | Entorno de staging separado + protección de la rama `main` | Probar migraciones y pagos sin tocar producción | Juan (cuentas) + desarrollo | Preview de Vercel contra Supabase de staging; `main` exige CI verde |
| 2 | PITR en Supabase + copia del storage + ensayo de restauración | Hoy se podría perder hasta un día de datos | Juan | Ensayo hecho con RPO/RTO anotados en `docs/operations-runbooks.md` |
| 3 | Monitor externo de `/api/health` + Sentry o log drain | Enterarse de una caída antes que los clientes | Juan | Alerta de prueba recibida |
| 4 | Pentest del entorno desplegado | Lo pide la auditoría antes de abrir a todo el país | Juan (contratar) | Informe sin hallazgos altos abiertos |
| 5 | Revisión legal/contable del modelo de cobro y liquidación | Custodia de fondos, facturación, retenciones | Juan + contador/abogado | Modelo aprobado por escrito |
| 6 | Política de contenido (CSP) en modo bloqueo, con nonces | Hoy solo informa; un XSS tendría más impacto en la app | Desarrollo | 2 semanas sin informes `[csp]` en los logs y `Content-Security-Policy` activa |
| 7 | Páginas del panel que leen con `sql()` | La base no frena un olvido de autorización (Semgrep: 8 avisos) | Desarrollo | 0 avisos de `fixy-lectura-privilegiada-en-pagina` |
| 8 | Dividir módulos grandes: bot de WhatsApp (1047 líneas), pagos (900), pedidos (684) | Cambios más chicos y revisables | Desarrollo | Ningún archivo de dominio > 500 líneas, sin cambios de comportamiento (las pruebas no cambian) |
| 9 | Antivirus para PDFs | Hoy solo se rechazan PDFs con contenido activo | Desarrollo | Escaneo antes de mostrar el archivo, con cuarentena |
| 10 | iOS: Team ID, entitlements y APNs | App de iPhone y avisos al celular | Juan (Apple) + desarrollo | App en TestFlight con avisos funcionando |
| 11 | Avisos de WhatsApp y celular "al menos una vez" | Si el proceso muere justo después de enviar, puede duplicarse | Desarrollo | Clave de deduplicación por aviso (si Meta/FCM la soportan) o aceptado |
