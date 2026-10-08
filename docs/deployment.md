# Despliegue en fixy.solutions (Vercel + Supabase)

> Nada de esto se ejecuta automáticamente. Seguí los pasos en orden. Tiempo estimado: 45–60 minutos la primera vez.
> Resultado: la plataforma online en **modo de prueba de pagos** (sin dinero real). Activar pagos reales requiere el checklist de `docs/payments.md`.

## Qué vas a usar
| Servicio | Para qué | Plan sugerido para empezar |
|---|---|---|
| GitHub (`juanmcampos14/fixy`) | Código | — |
| Supabase | Base de datos Postgres + almacenamiento privado de archivos | Free para probar; Pro antes de tener clientes reales (backups diarios). |
| Vercel | Hosting de la app Next.js | Hobby para probar; Pro para uso comercial (los términos de Hobby no permiten uso comercial). |
| Tu registrador de dominio | DNS de fixy.solutions | — |
| Resend (opcional) | Emails reales | Free |

Recomendación: dos entornos separados — **producción** en `fixy.solutions` (sin datos de demostración) y, si querés mostrar el MVP con datos ficticios, **demo** en `demo.fixy.solutions` con su propio proyecto Supabase y Vercel.

---

## 1. Supabase (base de datos y archivos)
1. Entrá a https://supabase.com → **New project**. Nombre: `fixy-prod`. Región: la más cercana a tus usuarios (el proyecto actual está en **us-east-1**; `vercel.json` usa la región `iad1`, cercana a esa base). Guardá la contraseña de la base en un gestor de contraseñas.
2. **Project Settings → Database → Connection string**, copiá dos cadenas (reemplazá `[YOUR-PASSWORD]`):
   - **Session pooler** (puerto **5432**): para migraciones desde tu computadora.
   - **Transaction pooler** (puerto **6543**): para la app en Vercel.
   Agregá `?sslmode=require` al final de ambas si no lo tienen.
3. **Storage → New bucket**: nombre `fixy-private`, **Public bucket: desactivado**. No hace falta crear políticas: la app accede con la service role key desde el servidor y entrega archivos con enlaces firmados propios.
4. **Project Settings → API**: copiá `Project URL` y la **service_role key** (secreta: solo va en Vercel, nunca en el navegador ni en el repo).

## 2. Preparar la base
**Opción simple (recomendada): SQL Editor.** En Supabase → **SQL Editor → New query**, pegá el contenido completo de `db/supabase-init.sql` y tocá **Run**. Crea todas las tablas, reglas de seguridad y datos base. Al final muestra `categorias 13 · zonas 17 · migraciones 6`. Ejecutalo una sola vez.

**Opción por terminal** (para futuras migraciones):
Necesitás Node 20.9+ y el código clonado.
```bash
git clone https://github.com/juanmcampos14/fixy.git && cd fixy && npm ci
```
Aplicá migraciones y datos base contra Supabase (usá la cadena **Session pooler**, puerto 5432):
```bash
DATABASE_URL='postgresql://postgres.xxxx:CLAVE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require' npm run db:migrate
```
```bash
DATABASE_URL='postgresql://postgres.xxxx:CLAVE@aws-0-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require' DEMO_MODE=false npm run db:seed
```
Creá tu usuario administrador. Lo más simple: después del deploy registrate en el sitio y en el SQL Editor ejecutá `update users set platform_role = 'admin' where email = 'tu@email.com';`. Alternativa por terminal (la contraseña se pide sin mostrarse):
```bash
read -s -p "Contraseña admin: " ADMIN_PASSWORD && export ADMIN_PASSWORD && echo
```
```bash
DATABASE_URL='postgresql://...:5432/postgres?sslmode=require' ADMIN_EMAIL=tu@email.com ADMIN_NAME='Tu Nombre' npm run admin:create
```
Verificación: en Supabase → Table Editor deberías ver `categories` (13 filas), `zones` (17) y tu usuario en `users` con `platform_role = admin`.

## 3. Vercel (la app)
1. https://vercel.com → **Add New → Project** → importá `juanmcampos14/fixy`. Framework: Next.js (se detecta solo). No cambies build ni output.
2. **Environment Variables** (entorno Production). Generá los secretos con `openssl rand -base64 48`:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | Cadena **Transaction pooler** (puerto **6543**) con `?sslmode=require` |
| `DATABASE_POOL_MAX` | `3` |
| `APP_URL` | `https://fixy.solutions` |
| `FILE_SIGNING_SECRET` | secreto aleatorio (≥ 32 caracteres) |
| `STORAGE_DRIVER` | `supabase` |
| `SUPABASE_URL` | Project URL de Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `SUPABASE_STORAGE_BUCKET` | `fixy-private` |
| `PAYMENTS_GATEWAY` | `mock` (modo de prueba visible) |
| `MOCK_WEBHOOK_SECRET` | secreto aleatorio |
| `CRON_SECRET` | secreto aleatorio |
| `DEMO_MODE` | `false` |
| `EMAIL_ADAPTER` | `console` (o `resend`, ver paso 6) |
| `EMAIL_FROM` | `Fixy <no-responder@fixy.solutions>` |
| `ASSISTANT_PROVIDER` | `rules` (o `claude` + `ANTHROPIC_API_KEY`) |

3. **Deploy**. Al terminar, abrí la URL `*.vercel.app` y probá: landing, registro, `/solicitar`, ingreso con tu admin en `/ingresar` → `/admin`.
4. El archivo `vercel.json` ya define la región `gru1` (São Paulo, cerca de la base) y un cron diario a `/api/cron/outbox` (envía emails pendientes y vence presupuestos). En el plan Hobby los cron corren una vez por día; en Pro podés pasarlo a cada 5–10 minutos (`*/10 * * * *`).

## 4. Dominio fixy.solutions
1. Vercel → Project → **Settings → Domains** → agregá `fixy.solutions` y `www.fixy.solutions` (elegí redirigir `www` al dominio principal).
2. Vercel te muestra los registros DNS exactos. En el panel de tu registrador (donde compraste el dominio) cargá **los valores que indique Vercel**; normalmente:
   - `A` · nombre `@` · valor `76.76.21.21`
   - `CNAME` · nombre `www` · valor `cname.vercel-dns.com`
   Borrá registros `A`/`AAAA`/`CNAME` previos para `@` y `www` que apunten a otro lado (por ejemplo, a una página de "parking").
3. Esperá la propagación (minutos a algunas horas). Vercel emite el certificado HTTPS automáticamente cuando el dominio resuelve.
4. Confirmá que `APP_URL=https://fixy.solutions` y hacé **Redeploy**.

## 5. Probar en producción
- Registrate como cliente con un email tuyo, creá un pedido y verificá que aparece en `/admin/solicitudes` (sin proveedores aprobados quedará "sin cobertura": es lo esperado).
- Registrate con otra cuenta como proveedor (`/ofrece-tus-servicios`), completá el alta y aprobalo desde `/admin/proveedores`.
- Repetí el pedido: el proveedor recibe la oportunidad, cotiza, el cliente acepta y paga en **modo de prueba**.

## 6. Emails reales (opcional)
1. https://resend.com → agregá el dominio `fixy.solutions` y cargá en tu DNS los registros que indique (SPF/DKIM).
2. En Vercel: `EMAIL_ADAPTER=resend`, `RESEND_API_KEY=...`, `EMAIL_FROM=Fixy <no-responder@fixy.solutions>` → Redeploy.

## 7. Entorno de demostración (opcional, separado)
Proyecto Supabase `fixy-demo` + proyecto Vercel `fixy-demo` en `demo.fixy.solutions` (CNAME `demo` → valor que indique Vercel). Para cargar datos ficticios:
```bash
DATABASE_URL='...demo...:5432/postgres?sslmode=require' NODE_ENV=production ALLOW_DEMO_SEED=true DEMO_SEED_PASSWORD='otra-clave-larga' npm run db:seed -- --demo
```
Los accesos rápidos de demo nunca se habilitan en producción; se ingresa con email (`<usuario>@demo.fixy.solutions`) y `DEMO_SEED_PASSWORD`. No uses este entorno con personas reales.

## Limitaciones conocidas en Vercel
- **Tamaño de envío**: Vercel limita cada request a ~4,5 MB. Fotos y documentos grandes pueden fallar; pedí archivos livianos. Pendiente: subida directa a Storage con URL firmada.
- **Funciones serverless**: usá siempre el Transaction pooler (6543) para no agotar conexiones.

## Actualizaciones
- Cada `git push` a `main` despliega automáticamente.
- Si un cambio incluye una migración nueva en `db/migrations/`, aplicala **antes** del deploy con `npm run db:migrate` (cadena Session pooler).
- Backups: Supabase Pro hace copias diarias; antes de migraciones importantes corré `pg_dump` (ver `docs/architecture.md` → Respaldo).
