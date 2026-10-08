import type { Db } from "@/server/db/client";

export type PlatformRole = "operator" | "admin" | null;

export type Actor = {
  id: string;
  email: string;
  fullName: string;
  platformRole: PlatformRole;
  isDemo: boolean;
  organizations: { id: string; name: string; role: "admin" | "member" }[];
  providers: { id: string; name: string; role: "admin" | "technician"; status: string; slug: string }[];
};

export const isStaff = (a: Actor | null) => a?.platformRole === "operator" || a?.platformRole === "admin";
export const isPlatformAdmin = (a: Actor | null) => a?.platformRole === "admin";

export async function loadActor(db: Db, userId: string): Promise<Actor | null> {
  const [u] = await db<{ id: string; email: string; full_name: string; platform_role: PlatformRole; is_demo: boolean }[]>`
    select id, email, full_name, platform_role, is_demo from users where id = ${userId} and disabled_at is null`;
  if (!u) return null;
  const orgs = await db<{ id: string; name: string; role: "admin" | "member" }[]>`
    select o.id, o.name, m.role from organization_members m join organizations o on o.id = m.organization_id
    where m.user_id = ${userId} order by o.name`;
  const providers = await db<{ id: string; name: string; role: "admin" | "technician"; status: string; slug: string }[]>`
    select p.id, p.display_name as name, m.role, p.status, p.slug from provider_members m join providers p on p.id = m.provider_id
    where m.user_id = ${userId} and m.active order by p.display_name`;
  return {
    id: u.id,
    email: u.email,
    fullName: u.full_name,
    platformRole: u.platform_role,
    isDemo: u.is_demo,
    organizations: [...orgs],
    providers: [...providers],
  };
}
