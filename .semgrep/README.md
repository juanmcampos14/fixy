# Semgrep en Fixy

Reglas de arquitectura propias (`.semgrep/fixy.yml`) más los packs de seguridad del registry. Semgrep está
instalado con `pip3 install --user semgrep` (no está en el PATH): los scripts lo llaman por `scripts/semgrep.sh`.

```bash
npm run semgrep:arch   # reglas de Fixy: rápido, sin red
npm run semgrep:sec    # packs de seguridad del registry (p/secrets, p/typescript, p/react, p/nextjs, p/owasp-top-ten); requiere red
npm run semgrep        # las dos cosas
```

Validar el archivo de reglas después de editarlo: `bash scripts/semgrep.sh --validate --config .semgrep/fixy.yml`.

## Cuándo correrlo

Después de tocar server actions, `src/server/modules`, pagos, componentes `"use client"` o SQL.
Una regla **ERROR** es una invariante que hoy se cumple: si salta, el cambio la rompió.
Una regla **WARNING** es deuda conocida de la auditoría del 13/10/2026: la lista tiene que bajar, no subir.

## Reglas

| Regla | Severidad | Qué protege |
|---|---|---|
| `fixy-cliente-importa-servidor` | ERROR | Un `"use client"` no importa de `src/server` (salvo `src/server/domain` y `import type`). |
| `fixy-env-no-publico-en-cliente` | ERROR | En el navegador sólo se leen variables `NEXT_PUBLIC_*`. |
| `fixy-accion-sin-autenticacion` | ERROR | Toda server action llama a un helper de sesión. Las públicas viven en `(auth)`, `(public)`, `solicitar` y `wa/entrar`. |
| `fixy-accion-publica-sin-limite` | WARNING | Una acción pública (sin sesión) llama a `rateLimit(...)`. |
| `fixy-escritura-sql-fuera-del-servidor` | ERROR | `src/app` y `src/components` no escriben en la base: lo hace `src/server/modules`. |
| `fixy-html-crudo` | ERROR | Nada de `dangerouslySetInnerHTML`. |
| `fixy-sql-unsafe` | ERROR | Nada de `.unsafe(...)`: SQL siempre parametrizado. |
| `fixy-contrasena-demo-fuera-del-seed` | ERROR | La contraseña demo publicada no se usa fuera de `src/server/seed`. |
| `fixy-estado-de-trabajo-fuera-de-movejob` | WARNING | El estado de un trabajo cambia por `moveJob` (assert, timestamp, evento, efectos). |
| `fixy-pasarela-dentro-de-transaccion` | WARNING | La pasarela no se llama con la transacción abierta (con Mercado Pago real es HTTP). |
| `fixy-tabla-del-mock-fuera-del-mock` | WARNING | El dominio no lee `mock_gateway_payments`: habla con `PaymentGateway`. |

Para silenciar un caso puntual y justificado: comentario `// nosemgrep: <id-de-la-regla> — motivo` en la línea.

## Hook automático de Claude Code

`scripts/semgrep-hook.sh` corre las reglas **ERROR** sobre cada archivo que Claude Code edita (un archivo,
sin red). Si una regla salta, sale con código 2 y Claude Code recibe el aviso para corregirlo en el momento.
Las WARNING no lo frenan.

Está activado en `.claude/settings.local.json`, que es personal y no se versiona. Para activarlo en otra
máquina, agregá:

```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/scripts/semgrep-hook.sh\"" }] }
    ]
  }
}
```
