/**
 * Autorización explícita para operaciones de escritura. Reutiliza las funciones app.* de la base
 * (las mismas que usan las políticas RLS), pasando el id del actor autenticado por el servidor.
 * Nunca se toma la identidad ni el rol desde parámetros del navegador.
 */
import type { Db } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { forbidden } from "@/server/domain/errors";

type Check =
  | "is_request_client"
  | "is_request_provider"
  | "can_see_request"
  | "is_job_client"
  | "is_job_provider"
  | "can_see_job"
  | "can_manage_property"
  | "can_see_property"
  | "can_see_conversation"
  | "can_see_provider_finance";

export async function check(db: Db, fn: Check, actor: Actor, id: string): Promise<boolean> {
  const rows = await db.unsafe<{ ok: boolean }[]>(`select app.${fn}($1, $2) as ok`, [actor.id, id]);
  return rows[0]?.ok === true;
}

export async function assert(db: Db, fn: Check, actor: Actor, id: string, msg?: string) {
  if (!(await check(db, fn, actor, id))) throw forbidden(msg);
}

export async function providerRole(db: Db, actor: Actor, providerId: string): Promise<"admin" | "technician" | null> {
  const [r] = await db<{ role: "admin" | "technician" | null }[]>`select app.provider_role(${actor.id}, ${providerId}) as role`;
  return r?.role ?? null;
}

export async function assertProviderAdmin(db: Db, actor: Actor, providerId: string) {
  if ((await providerRole(db, actor, providerId)) !== "admin") throw forbidden();
}

export async function orgRole(db: Db, actor: Actor, orgId: string): Promise<"admin" | "member" | null> {
  const [r] = await db<{ role: "admin" | "member" | null }[]>`select app.org_role(${actor.id}, ${orgId}) as role`;
  return r?.role ?? null;
}
