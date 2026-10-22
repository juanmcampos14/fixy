# ADR 0002 · Efectos externos fuera de las transacciones

**Estado:** aceptada.

**Decisión.** Ninguna llamada de red (Mercado Pago, Resend, Meta, FCM/APNs) ocurre con una transacción abierta o con
filas bloqueadas. Patrón único:
1. la acción de negocio guarda la intención (comando de pago o aviso en `outbox`) en su transacción;
2. un procesador la reclama con un lease corto en una sola sentencia;
3. llama al proveedor con una clave idempotente estable (cuando el proveedor la soporta);
4. aplica el resultado en una transacción breve; si se cae en el medio, el lease vence y otro procesador reintenta.

**Consecuencias.** La entrega es "al menos una vez": pagos y emails usan claves idempotentes del proveedor; WhatsApp y
avisos al celular pueden duplicarse si el proceso muere justo después de enviar (aceptado: es raro y no mueve dinero).
Semgrep bloquea llamadas a la pasarela con `tx`/`db`.
