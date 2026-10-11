import type { Db } from "@/server/db/client";
import type { Permissions } from "./permissions";

export type PlatformRole = "operator" | "admin" | "team" | null;

export type Actor = {
  id: string;
  email: string;
  fullName: string;
  platformRole: PlatformRole;
  isDemo: boolean;
  /** Cuenta de revisión de tiendas: solo se cruza con el profesional de prueba. */
  sandbox?: boolean;
  organizations: { id: string; name: string; role: "admin" | "member" }[];
  providers: { id: string; name: string; role: "admin" | "technician"; status: string; slug: string }[];
  /** Permisos por sección del panel (solo rol "team"). */
  permissions: Permissions;
};

/** Puede entrar al panel de administración (cualquier rol de equipo). */
export const canAccessAdmin = (a: Actor | null) => a?.platformRole === "operator" || a?.platformRole === "admin" || a?.platformRole === "team";
/**
 * Puede ACTUAR como equipo de Fixy en los módulos (lado "staff"). Un miembro "team" solo si gestiona al menos una sección:
 * quien solo ve (por ejemplo, un socio) nunca actúa como operación. Qué acción puede hacer lo valida cada acción por sección.
 */
export const isStaff = (a: Actor | null) =>
  a?.platformRole === "operator" || a?.platformRole === "admin" || (a?.platformRole === "team" && Object.values(a.permissions).includes("manage"));
export const isPlatformAdmin = (a: Actor | null) => a?.platformRole === "admin";

export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const [u] = await db<{ id: string; email: string; full_name: string; platform_role: PlatformRole; is_demo: boolean; sandbox: boolean }[]>`
    select id, email, full_name, platform_role, is_demo, sandbox from users where id = ${userId} and disabled_at is null`;
  if (!u) return null;
  const orgs = await db<{ id: string; name: string; role: "admin" | "member" }[]>`
    select o.id, o.name, m.role from organization_members m join organizations o on o.id = m.organization_id
    where m.user_id = ${userId} order by o.name`;
  const providers = await db<{ id: string; name: string; role: "admin" | "technician"; status: string; slug: string }[]>`
    select p.id, p.display_name as name, m.role, p.status, p.slug from provider_members m join providers p on p.id = m.provider_id
    where m.user_id = ${userId} and m.active order by p.display_name`;
  const perms = u.platform_role === "team"
    ? await db<{ section: string; level: "view" | "manage" }[]>`select section, level from admin_permissions where user_id = ${userId}`
    : [];
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    platformRole: u.platform_role,
    isDemo: u.is_demo,
    sandbox: u.sandbox,
    organizations: [...orgs],
    providers: [...providers],
    permissions: Object.fromEntries(perms.map((p) => [p.section, p.level])) as Permissions,
  };
}
