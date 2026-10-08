import type { Db } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";

/** Auditoría de acciones sensibles (append-only). No guardar documentos ni datos personales sensibles en `data`. */
export async function audit(
  db: Db,
  actor: Actor | null,
  action: string,
  entityType: string,
  entityId: string | null,
  reason: string | null,
  data: Record<string, unknown> = {},
) {
  await db`insert into audit_log (actor_id, actor_role, action, entity_type, entity_id, reason, data)
    values (${actor?.id ?? null}, ${actor?.platformRole ?? null}, ${action}, ${entityType}, ${entityId}, ${reason}, ${db.json(data as never)})`;
}

export type EntityType = "request" | "quote" | "job" | "charge" | "payout" | "dispute" | "provider" | "refund";

/** Evento de línea de tiempo / historial de estados. */
export async function recordEvent(
  db: Db,
  e: {
    entityType: EntityType;
    entityId: string;
    action: string;
    from?: string | null;
    to?: string | null;
    actorId?: string | null;
    actorRole?: string | null;
    reason?: string | null;
    data?: Record<string, unknown>;
  },
) {
  await db`insert into entity_events (entity_type, entity_id, action, from_state, to_state, actor_id, actor_role, reason, data)
    values (${e.entityType}, ${e.entityId}, ${e.action}, ${e.from ?? null}, ${e.to ?? null}, ${e.actorId ?? null},
            ${e.actorRole ?? null}, ${e.reason ?? null}, ${db.json((e.data ?? {}) as never)})`;
}
