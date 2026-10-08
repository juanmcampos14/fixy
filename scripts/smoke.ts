/*
 * Smoke test HTTP por rol (solo desarrollo): recorre las pantallas principales con sesiones de cuentas demo
 * y verifica códigos de estado esperados, ausencia de errores de render y aislamiento entre usuarios.
 * Uso: con `npm run dev` corriendo y datos demo cargados → `npx tsx scripts/smoke.ts [baseUrl]`
 */
import { loadEnv } from "./load-env";
loadEnv();
import { createHash, randomBytes } from "node:crypto";

const BASE = process.argv[2] ?? "http://localhost:3000";

(async () => {
  const { sql } = await import("@/server/db/client");
  const db = sql();
  const one = async (q: string) => ((await db.unsafe(q))[0] as unknown as { id: string } | undefined)?.id ?? "00000000-0000-0000-0000-000000000000";
  const cookie = async (key: string) => {
    const [u] = await db<{ id: string }[]>`select id from users where email = ${`${key}@demo.fixy.solutions`}`;
    const token = randomBytes(32).toString("base64url");
    await db`insert into sessions (token_hash, user_id, expires_at) values (${createHash("sha256").update(token).digest("hex")}, ${u.id}, now() + interval '1 hour')`;
    return `fixy_session=${token}`;
  };

  const ids = {
    anaJob: await one("select j.id from jobs j join users u on u.id = j.client_user_id where u.email like 'ana@%' limit 1"),
    carlaJob: await one("select id from jobs where code = 'T-502'"),
    anaReq: await one("select r.id from service_requests r join users u on u.id = r.created_by where u.email like 'ana@%' limit 1"),
    org: await one("select id from organizations limit 1"),
    martinInv: await one("select i.id from request_invitations i join providers p on p.id = i.provider_id where p.display_name like 'Electricidad Mart%' limit 1"),
    martinJob: await one("select j.id from jobs j join providers p on p.id = j.provider_id where p.display_name like 'Electricidad Mart%' limit 1"),
    sinJob: await one("select id from jobs where code = 'T-502'"),
    dispute: await one("select id from disputes limit 1"),
    provider: await one("select id from providers where status = 'in_review' limit 1"),
    providerSlug: (await db<{ slug: string }[]>`select slug from providers where status = 'approved' limit 1`)[0].slug,
  };

  type Check = { user: string | null; path: string; expect: number | "redirect" };
  const checks: Check[] = [
    // Público
    ...["/", "/ofrece-tus-servicios", `/profesionales/${ids.providerSlug}`, "/solicitar", "/ingresar", "/registro", "/terminos", "/privacidad"].map((path) => ({ user: null, path, expect: 200 as const })),
    { user: null, path: "/app", expect: "redirect" },
    { user: null, path: "/admin", expect: "redirect" },
    // Cliente
    ...["/app", "/app/solicitudes", `/app/solicitudes/${ids.anaReq}`, "/app/trabajos", `/app/trabajos/${ids.anaJob}`, "/app/propiedades", "/app/pagos", "/notificaciones"].map((path) => ({ user: "ana", path, expect: 200 as const })),
    { user: "ana", path: `/app/trabajos/${ids.carlaJob}`, expect: 404 },
    { user: "ana", path: `/app/organizaciones/${ids.org}`, expect: 404 },
    { user: "ana", path: "/admin", expect: "redirect" },
    { user: "ana", path: `/proveedor/trabajos/${ids.martinJob}`, expect: "redirect" },
    // Organización
    ...[`/app/organizaciones/${ids.org}`, `/app/trabajos/${ids.carlaJob}`, `/api/organizaciones/${ids.org}/export`].map((path) => ({ user: "carla", path, expect: 200 as const })),
    // Proveedor
    ...["/proveedor", "/proveedor/oportunidades", `/proveedor/oportunidades/${ids.martinInv}`, "/proveedor/trabajos", `/proveedor/trabajos/${ids.martinJob}`, "/proveedor/cobros", "/proveedor/perfil", "/proveedor/resenas", "/proveedor/agenda"].map((path) => ({ user: "martin", path, expect: 200 as const })),
    { user: "martin", path: `/proveedor/trabajos/${ids.sinJob}`, expect: 404 },
    ...["/proveedor/equipo", `/proveedor/trabajos/${ids.sinJob}`].map((path) => ({ user: "roberto", path, expect: 200 as const })),
    { user: "jorge", path: `/proveedor/trabajos/${ids.sinJob}`, expect: 200 },
    { user: "jorge", path: "/proveedor/cobros", expect: "redirect" },
    { user: "sofia", path: "/proveedor/alta", expect: 200 },
    // Operación
    ...["/admin", "/admin/proveedores", `/admin/proveedores/${ids.provider}`, "/admin/solicitudes", `/admin/solicitudes/${ids.anaReq}`, "/admin/trabajos", `/admin/trabajos/${ids.anaJob}`, "/admin/reclamos", `/admin/reclamos/${ids.dispute}`, "/admin/finanzas", "/admin/finanzas?tab=conciliacion", "/admin/catalogo", "/admin/comisiones", "/admin/auditoria"].map((path) => ({ user: "operador", path, expect: 200 as const })),
  ];

  const cookies: Record<string, string> = {};
  let failed = 0;
  for (const c of checks) {
    if (c.user && !cookies[c.user]) cookies[c.user] = await cookie(c.user);
    const res = await fetch(BASE + c.path, { redirect: "manual", headers: c.user ? { cookie: cookies[c.user] } : {} });
    const body = res.status === 200 ? await res.text() : "";
    const renderError = /Application error|Unhandled Runtime Error/.test(body);
    const ok = c.expect === "redirect" ? res.status >= 300 && res.status < 400 : res.status === c.expect && !renderError;
    if (!ok) failed++;
    console.log(`${ok ? "✔" : "✘"} ${String(c.user ?? "anónimo").padEnd(9)} ${String(res.status).padEnd(4)} ${c.path}${renderError ? " (error de render)" : ""}`);
  }
  await db`delete from sessions where expires_at < now() + interval '61 minutes' and created_at > now() - interval '10 minutes'`;
  await db.end();
  console.log(failed ? `\n${failed} verificaciones fallaron.` : `\nTodas las verificaciones pasaron (${checks.length}).`);
  process.exit(failed ? 1 : 0);
})();
