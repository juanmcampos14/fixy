/**
 * Equipo del panel de administración: invitaciones y permisos por sección. Solo el dueño (rol admin) lo gestiona.
 * La invitación es un link de un solo uso (7 días) para un email: solo la puede aceptar una cuenta con ese email.
 */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { sql, systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { isPlatformAdmin } from "@/server/auth/actor";
import { PRESETS, sanitizePermissions, type Permissions } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { notify } from "@/server/notifications";

const hash = (t: string) => createHash("sha256").update(t).digest("hex");

export type Access = { kind: "socio" } | { kind: "operacion" } | { kind: "custom"; permissions: Record<string, string> };

/** Lo que se guarda en la invitación y se aplica al aceptarla. */
function resolveAccess(a: Access): { label: string; stored: { role: "operator" } | { role: "team"; permissions: Permissions } } {
  if (a.kind === "operacion") return { label: PRESETS.operacion.label, stored: { role: "operator" } };
  if (a.kind === "socio") return { label: PRESETS.socio.label, stored: { role: "team", permissions: PRESETS.socio.permissions } };
  const permissions = sanitizePermissions(a.permissions);
  if (!Object.keys(permissions).length) throw invalid("Elegí al menos una sección que pueda ver.");
  return { label: "Personalizado", stored: { role: "team", permissions } };
}

function assertOwner(actor: Actor) {
  if (!isPlatformAdmin(actor)) throw forbidden("Solo el dueño de la cuenta gestiona el equipo.");
}

export async function inviteMember(actor: Actor, input: { email: string; access: Access }) {
  assertOwner(actor);
  const email = z.string().trim().toLowerCase().email("Ingresá un email válido.").parse(input.email);
  const { label, stored } = resolveAccess(input.access);
  const token = randomBytes(24).toString("base64url");
  return systemTx(async (tx) => {
    const [u] = await tx<{ id: string; platform_role: string | null }[]>`select id, platform_role from users where lower(email) = ${email}`;
    if (u?.platform_role === "admin") throw invalid("Esa persona ya es dueña o administradora de la cuenta.");
    await tx`update admin_invitations set revoked_at = now() where lower(email) = ${email} and accepted_at is null and revoked_at is null`;
    const [inv] = await tx<{ id: string }[]>`
      insert into admin_invitations (token_hash, email, label, permissions, created_by) values (${hash(token)}, ${email}, ${label}, ${tx.json(stored as never)}, ${actor.id})
      returning id`;
    await audit(tx, actor, "team.invite", "admin_invitation", inv.id, null, { email, label });
    const link = `/invitacion/${token}`;
    // Si ya tiene cuenta, le avisamos por la plataforma y por email.
    if (u) await notify(tx, [u.id], { type: "message", title: "Te invitaron al panel de Fixy", body: `Acceso: ${label}. Aceptá la invitación desde el link (vence en 7 días).`, link });
    return { id: inv.id, link };
  });
}

export async function getInvitation(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [inv] = await sql()<{ id: string; email: string; label: string; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null; inviter: string }[]>`
    select i.id, i.email, i.label, i.expires_at, i.accepted_at, i.revoked_at, u.full_name as inviter
    from admin_invitations i join users u on u.id = i.created_by where i.token_hash = ${hash(token)}`;
  return inv ?? null;
}

export async function acceptInvitation(actor: Actor, token: string) {
  return systemTx(async (tx) => {
    const [inv] = await tx<{ id: string; email: string; label: string; permissions: { role: "operator" } | { role: "team"; permissions: Permissions }; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }[]>`
      select id, email, label, permissions, expires_at, accepted_at, revoked_at from admin_invitations where token_hash = ${hash(token)} for update`;
    if (!inv) throw notFound("La invitación no existe.");
    if (inv.revoked_at) throw invalid("Esta invitación fue anulada. Pedí una nueva.");
    if (inv.accepted_at) throw invalid("Esta invitación ya se usó.");
    if (inv.expires_at < new Date()) throw invalid("La invitación venció. Pedí una nueva.");
    if (inv.email.toLowerCase() !== actor.email.toLowerCase()) throw forbidden(`Esta invitación es para ${inv.email}. Ingresá con esa cuenta.`);
    if (actor.platformRole !== "admin") {
      const p = inv.permissions;
      await tx`delete from admin_permissions where user_id = ${actor.id}`;
      if (p.role === "operator") await tx`update users set platform_role = 'operator' where id = ${actor.id}`;
      else {
        await tx`update users set platform_role = 'team' where id = ${actor.id}`;
        for (const [section, level] of Object.entries(p.permissions))
          await tx`insert into admin_permissions (user_id, section, level, granted_by) values (${actor.id}, ${section}, ${level}, null)`;
      }
    }
    await tx`update admin_invitations set accepted_at = now(), accepted_by = ${actor.id} where id = ${inv.id}`;
    // La invitación llegó por email a esa casilla: abrirla prueba que es suya.
    await tx`update users set email_verified = true where id = ${actor.id} and not email_placeholder`;
    await audit(tx, actor, "team.accept", "admin_invitation", inv.id, null, { label: inv.label });
  });
}

export async function updateMemberAccess(actor: Actor, userId: string, access: Access) {
  assertOwner(actor);
  if (userId === actor.id) throw invalid("No podés cambiar tus propios permisos.");
  const { label, stored } = resolveAccess(access);
  return systemTx(async (tx) => {
    const [u] = await tx<{ platform_role: string | null }[]>`select platform_role from users where id = ${userId} for update`;
    if (!u?.platform_role) throw notFound("Esa persona no es parte del equipo.");
    if (u.platform_role === "admin") throw invalid("No se pueden cambiar los permisos de otro dueño o administrador.");
    await tx`delete from admin_permissions where user_id = ${userId}`;
    if (stored.role === "operator") await tx`update users set platform_role = 'operator' where id = ${userId}`;
    else {
      await tx`update users set platform_role = 'team' where id = ${userId}`;
      for (const [section, level] of Object.entries(stored.permissions))
        await tx`insert into admin_permissions (user_id, section, level, granted_by) values (${userId}, ${section}, ${level}, ${actor.id})`;
    }
    await audit(tx, actor, "team.update", "user", userId, null, { label, permissions: stored });
  });
}

export async function removeMember(actor: Actor, userId: string) {
  assertOwner(actor);
  if (userId === actor.id) throw invalid("No podés quitarte el acceso a vos mismo.");
  return systemTx(async (tx) => {
    const [u] = await tx<{ platform_role: string | null }[]>`select platform_role from users where id = ${userId} for update`;
    if (!u?.platform_role) throw notFound("Esa persona no es parte del equipo.");
    if (u.platform_role === "admin") throw invalid("No se puede quitar a otro dueño o administrador desde acá.");
    await tx`delete from admin_permissions where user_id = ${userId}`;
    await tx`update users set platform_role = null where id = ${userId}`;
    await audit(tx, actor, "team.remove", "user", userId, null);
  });
}

export async function revokeInvitation(actor: Actor, invitationId: string) {
  assertOwner(actor);
  return systemTx(async (tx) => {
    const [r] = await tx<{ id: string }[]>`update admin_invitations set revoked_at = now() where id = ${invitationId} and accepted_at is null and revoked_at is null returning id`;
    if (!r) throw invalid("La invitación ya no está pendiente.");
    await audit(tx, actor, "team.revoke_invite", "admin_invitation", invitationId, null);
  });
}

export async function listTeam() {
  const members = await sql()<{ id: string; full_name: string; email: string; platform_role: "admin" | "operator" | "team"; created_at: Date }[]>`
    select id, full_name, email, platform_role, created_at from users where platform_role is not null and disabled_at is null
    order by case platform_role when 'admin' then 0 when 'operator' then 1 else 2 end, full_name`;
  const perms = members.length
    ? await sql()<{ user_id: string; section: string; level: "view" | "manage" }[]>`select user_id, section, level from admin_permissions where user_id in ${sql()(members.map((m) => m.id))}`
    : [];
  const invitations = await sql()<{ id: string; email: string; label: string; created_at: Date; expires_at: Date }[]>`
    select id, email, label, created_at, expires_at from admin_invitations where accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc`;
  return {
    members: members.map((m) => ({ ...m, permissions: Object.fromEntries(perms.filter((p) => p.user_id === m.id).map((p) => [p.section, p.level])) as Permissions })),
    invitations,
  };
}
