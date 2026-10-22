# ADR 0001 · Mantener el monolito modular

**Estado:** aceptada (oct 2026, tras la auditoría técnica).

**Contexto.** La auditoría concluyó que el cuello de botella no es la arquitectura (Next.js + PostgreSQL) sino la
operación: efectos externos dentro de transacciones, cron único y falta de observabilidad.

**Decisión.** Seguir con un solo despliegue (Next.js en Vercel + PostgreSQL en Supabase). Nada de microservicios,
Kafka ni Kubernetes sin una necesidad medida. Las mejoras van adentro: colas con lease, comandos durables para pagos,
tareas programadas separadas, permisos por sección en la base y límites claros entre módulos.

**Cuándo revisarla.** Si una parte necesita escalar distinto que el resto con evidencia (por ejemplo, el procesamiento de
avisos supera lo que entra en una corrida de 4 minutos con tandas, o el bot de WhatsApp necesita latencia propia).
