<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Semgrep — reglas de arquitectura de Fixy

Después de tocar server actions, `src/server/modules`, pagos, componentes `"use client"` o SQL, corré
`npm run semgrep:arch` (rápido, sin red). Una regla ERROR que salta es una invariante rota: corregila antes
de dar la tarea por terminada. Las WARNING son deuda conocida; no sumes casos nuevos. Detalle en `.semgrep/README.md`.
