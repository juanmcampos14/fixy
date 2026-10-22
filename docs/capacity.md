# Capacidad · línea base

Medición del 22 de octubre de 2026 sobre un build de producción local (MacBook, PostgreSQL 16 en Docker, misma máquina).
No reemplaza una prueba sobre staging, pero fija una referencia para detectar regresiones.

## Web (`node scripts/load/run.mjs --users 25 --seconds 30`)
| Escenario | Pedidos | rps | p50 ms | p95 ms | p99 ms | Errores |
|---|---|---|---|---|---|---|
| Inicio | 3935 | 131 | 79 | 93 | 108 | 0 |
| Pedir servicio | 3893 | 130 | 81 | 96 | 110 | 0 |
| Profesionales | 2691 | 90 | 14 | 20 | 24 | 0 |
| Ingresar | 1314 | 44 | 50 | 64 | 78 | 0 |
| Estado (`/api/health`) | 1318 | 44 | 13 | 20 | 23 | 0 |
| **Total** | **13 151** | **438** | | | | **0 %** |

## Cola de avisos (`npx tsx scripts/load/outbox-bench.ts`)
3000 emails con 4 procesadores en paralelo y 15 ms de latencia simulada por envío: **16 s (187 por segundo), 0
duplicados**. Con un proveedor real (~150 ms por envío) cada procesador manda ~6 por segundo: una corrida de avisos (hasta
~70 s por canal) despacha ~400 emails; picos mayores se vacían en las corridas siguientes, cada 5 minutos.

## Límites conocidos y cuándo actuar
- **Conexiones:** `DATABASE_POOL_MAX` por instancia; con muchas instancias de Vercel se multiplican. Usar siempre el
  pooler de Supabase (puerto 6543, modo transacción) y mirar "conexiones a la base" en Salud.
- **Avisos:** si "Más viejo" supera 30 min en horario normal, subir `BATCH_EMAIL`/`BATCH_WHATSAPP` o la frecuencia.
- **Archivos:** pasan por la aplicación (hasta 8 MB); si el tráfico de fotos crece, servir con URLs firmadas del storage
  después de autorizar.
