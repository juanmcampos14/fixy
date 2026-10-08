/** Solicitudes, borradores anónimos, matching e invitaciones. */
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import { sql, systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { isStaff } from "@/server/auth/actor";
import { audit, recordEvent } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { assertTransition, requestMachine, type RequestStatus, type ActorSide } from "@/server/domain/state-machines";
import { triageByRules } from "@/server/assistant/rules";
import { clientRecipients, notify, providerRecipients, staffRecipients } from "@/server/notifications";
import { getSetting } from "./catalog";
import { storeFile } from "@/server/storage";
import { assertProviderAdmin, check } from "./authz";

export const TIME_WINDOWS = [
  { key: "morning", label: "Mañana (8 a 12 h)", start: 8 * 60, end: 12 * 60, weekend: false },
  { key: "afternoon", label: "Tarde (12 a 17 h)", start: 12 * 60, end: 17 * 60, weekend: false },
  { key: "evening", label: "Última hora (17 a 20 h)", start: 17 * 60, end: 20 * 60, weekend: false },
  { key: "weekend", label: "Fin de semana", start: 8 * 60, end: 20 * 60, weekend: true },
] as const;

export const requestSchema = z.object({
  propertyId: z.string().uuid("Elegí dónde es el trabajo."),
  categoryId: z.string().uuid().optional().nullable(),
  serviceId: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(3, "Agregá un título breve.").max(140),
  description: z.string().trim().min(10, "Contanos un poco más (mínimo 10 caracteres).").max(4000),
  answers: z.record(z.string(), z.union([z.string().max(500), z.boolean()])).default({}),
  urgency: z.enum(["flexible", "normal", "soon", "urgent"]),
  preferredWindows: z.array(z.enum(["morning", "afternoon", "evening", "weekend"])).default([]),
  accessInfo: z.string().trim().max(1000).optional().or(z.literal("")),
  targetProviderId: z.string().uuid().optional().nullable(),
  previousJobId: z.string().uuid().optional().nullable(),
  responsibleUserId: z.string().uuid().optional().nullable(),
});
export type RequestInput = z.infer<typeof requestSchema>;

// ───────────────────────── Borradores anónimos ─────────────────────────
export const DRAFT_COOKIE = "fixy_draft";
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Guarda un borrador sin cuenta. El token en claro solo vive en una cookie httpOnly. */
export async function saveAnonymousDraft(existingToken: string | null, data: Record<string, unknown>) {
  const json = JSON.stringify(data);
  if (json.length > 20000) throw invalid("El borrador es demasiado grande.");
  if (existingToken) {
    const r = await sql()`update request_drafts set data = ${sql().json(data as never)}, updated_at = now()
      where token_hash = ${hashToken(existingToken)} and claimed_by is null returning id`;
    if (r.length) return existingToken;
  }
  const token = randomBytes(24).toString("base64url");
  await sql()`insert into request_drafts (token_hash, data) values (${hashToken(token)}, ${sql().json(data as never)})`;
  return token;
}

/** Recupera el borrador asociado al token y lo vincula al usuario (una sola vez, dentro de 7 días). */
export async function claimDraft(token: string, userId: string): Promise<Record<string, unknown> | null> {
  const [d] = await sql()<{ data: Record<string, unknown> }[]>`
    update request_drafts set claimed_by = ${userId}, claimed_at = now()
    where token_hash = ${hashToken(token)} and (claimed_by is null or claimed_by = ${userId})
      and created_at > now() - interval '7 days'
    returning data`;
  return d?.data ?? null;
}

// ───────────────────────── Matching ─────────────────────────

export type Candidate = {
  providerId: string;
  displayName: string;
  score: number;
  reasons: string[];
  activeJobs: number;
  reviews: number;
  rating: number | null;
};

/**
 * Matching determinista. Filtros: categoría, cobertura, proveedor aprobado, identidad verificada,
 * cobros habilitados, credenciales requeridas vigentes, disponibilidad declarada, acepta trabajos.
 * Orden: disponibilidad, reputación (con prior: los nuevos no quedan excluidos), carga, cercanía,
 * y como desempate, menos invitaciones recientes (rotación justa).
 */
export async function findCandidates(db: Db, requestId: string, opts: { excludeInvited?: boolean } = {}): Promise<Candidate[]> {
  const [r] = await db<{ category_id: string | null; zone_id: string; region: string; preferred_windows: string[] }[]>`
    select r.category_id, p.zone_id, z.region, r.preferred_windows
    from service_requests r join properties p on p.id = r.property_id join zones z on z.id = p.zone_id where r.id = ${requestId}`;
  if (!r || !r.category_id) return [];
  const rows = await db<{
    id: string; display_name: string; base_zone_id: string | null; base_region: string | null; max_active_jobs: number;
    active_jobs: number; reviews: number; rating_sum: number; recent_invites: number;
    slots: { weekday: number; start_minute: number; end_minute: number }[];
  }[]>`
    select p.id, p.display_name, p.base_zone_id, bz.region as base_region, p.max_active_jobs,
      (select count(*)::int from jobs j where j.provider_id = p.id and j.status in ('pending_confirmation','confirmed','on_the_way','in_progress','pending_approval')) as active_jobs,
      (select count(*)::int from reviews v where v.provider_id = p.id and v.hidden_at is null) as reviews,
      (select coalesce(sum(rating), 0)::int from reviews v where v.provider_id = p.id and v.hidden_at is null) as rating_sum,
      (select count(*)::int from request_invitations i where i.provider_id = p.id and i.created_at > now() - interval '14 days') as recent_invites,
      (select coalesce(json_agg(json_build_object('weekday', a.weekday, 'start_minute', a.start_minute, 'end_minute', a.end_minute)), '[]')
         from provider_availability a where a.provider_id = p.id) as slots
    from providers p
    left join zones bz on bz.id = p.base_zone_id
    where p.status = 'approved' and p.identity_status = 'verified' and p.payouts_status = 'enabled' and p.accepting_jobs
      and exists (select 1 from provider_categories pc where pc.provider_id = p.id and pc.category_id = ${r.category_id})
      and exists (select 1 from provider_zones pz where pz.provider_id = p.id and pz.zone_id = ${r.zone_id})
      and exists (select 1 from provider_availability a where a.provider_id = p.id)
      and not exists (
        select 1 from category_required_credentials rc where rc.category_id = ${r.category_id}
        and not exists (select 1 from provider_documents d where d.provider_id = p.id and d.credential_type_id = rc.credential_type_id
          and d.status = 'approved' and (d.expires_on is null or d.expires_on >= current_date)))
      ${opts.excludeInvited ? db`and not exists (select 1 from request_invitations i where i.request_id = ${requestId} and i.provider_id = p.id)` : db``}`;

  const prefs = r.preferred_windows ?? [];
  const candidates = rows.map((p) => {
    const reasons: string[] = [];
    // Disponibilidad declarada vs franjas preferidas
    const overlaps = prefs.length === 0
      ? p.slots.length > 0
      : prefs.some((key) => {
          const w = TIME_WINDOWS.find((x) => x.key === key);
          if (!w) return false;
          return p.slots.some((s) => (w.weekend ? s.weekday === 0 || s.weekday === 6 : s.weekday >= 1 && s.weekday <= 5) && s.start_minute < w.end && s.end_minute > w.start);
        });
    const availability = overlaps ? 30 : 12;
    reasons.push(overlaps ? "Disponibilidad compatible con tus franjas" : "Disponibilidad parcial");
    // Reputación bayesiana: prior de 4 estrellas con peso 3 (los nuevos arrancan en un valor neutro)
    const bayes = (p.rating_sum + 4 * 3) / (p.reviews + 3);
    const reputation = Math.round(((bayes - 1) / 4) * 30);
    reasons.push(p.reviews ? `Reputación ${(p.rating_sum / p.reviews).toFixed(1)} (${p.reviews} reseñas)` : "Proveedor nuevo (sin reseñas aún)");
    // Carga de trabajo
    const load = Math.min(p.active_jobs / Math.max(p.max_active_jobs, 1), 1);
    const workload = Math.round(25 * (1 - load));
    reasons.push(`${p.active_jobs} trabajo(s) activo(s)`);
    // Cercanía (solo con datos suficientes: zona base declarada)
    let proximity = 0;
    if (p.base_zone_id === r.zone_id) {
      proximity = 15;
      reasons.push("Base en la misma zona");
    } else if (p.base_region === r.region) {
      proximity = 8;
      reasons.push("Base en la misma región");
    }
    return {
      providerId: p.id,
      displayName: p.display_name,
      score: availability + reputation + workload + proximity,
      reasons,
      activeJobs: p.active_jobs,
      reviews: p.reviews,
      rating: p.reviews ? Math.round((p.rating_sum / p.reviews) * 10) / 10 : null,
      recentInvites: p.recent_invites,
    };
  });
  candidates.sort((a, b) => b.score - a.score || a.recentInvites - b.recentInvites || a.providerId.localeCompare(b.providerId));
  return candidates.map((c) => ({ providerId: c.providerId, displayName: c.displayName, score: c.score, reasons: c.reasons, activeJobs: c.activeJobs, reviews: c.reviews, rating: c.rating }));
}

async function transitionRequest(tx: Tx, requestId: string, from: RequestStatus, to: RequestStatus, side: ActorSide, actor: Actor | null, reason?: string) {
  assertTransition(requestMachine, from, to, side);
  await tx`update service_requests set status = ${to},
    submitted_at = case when ${to} = 'submitted' then now() else submitted_at end where id = ${requestId}`;
  await recordEvent(tx, { entityType: "request", entityId: requestId, action: "status", from, to, actorId: actor?.id ?? null, actorRole: actor?.platformRole ?? side, reason });
}

async function inviteProviderTx(tx: Tx, requestId: string, providerId: string, source: "matching" | "client" | "operator", invitedBy: string | null, rank?: { position: number; score: number; reasons: string[] }) {
  const inserted = await tx<{ id: string }[]>`
    insert into request_invitations (request_id, provider_id, source, invited_by, rank_position, rank_score, rank_reasons)
    values (${requestId}, ${providerId}, ${source}, ${invitedBy}, ${rank?.position ?? null}, ${rank?.score ?? null}, ${tx.json((rank?.reasons ?? []) as never)})
    on conflict (request_id, provider_id) do nothing returning id`;
  if (!inserted.length) return null;
  await tx`insert into conversations (request_id, provider_id) values (${requestId}, ${providerId}) on conflict do nothing`;
  const [r] = await tx<{ code: string; title: string }[]>`select code, title from service_requests where id = ${requestId}`;
  await notify(tx, await providerRecipients(tx, providerId), {
    type: "invitation",
    title: `Nueva oportunidad · ${r.code}`,
    body: r.title,
    link: `/proveedor/oportunidades/${inserted[0].id}`,
  });
  return inserted[0].id;
}

/** Corre el matching e invita a un grupo acotado. Devuelve cuántos proveedores se invitaron. */
export async function runMatchingTx(tx: Tx, requestId: string, actor: Actor | null): Promise<number> {
  const [r] = await tx<{ status: RequestStatus; code: string }[]>`select status, code from service_requests where id = ${requestId} for update`;
  const limit = await getSetting<number>(tx, "matching.invite_limit", 4);
  const candidates = await findCandidates(tx, requestId, { excludeInvited: true });
  const chosen = candidates.slice(0, limit);
  let invited = 0;
  for (const [i, c] of chosen.entries()) {
    const id = await inviteProviderTx(tx, requestId, c.providerId, "matching", actor?.id ?? null, { position: i + 1, score: c.score, reasons: c.reasons });
    if (id) invited++;
  }
  const [{ total }] = await tx<{ total: number }[]>`select count(*)::int as total from request_invitations where request_id = ${requestId} and status not in ('declined','expired')`;
  const side: ActorSide = actor && isStaff(actor) ? "staff" : "system";
  if (total > 0 && (r.status === "submitted" || r.status === "no_coverage")) {
    await transitionRequest(tx, requestId, r.status, "searching", side, actor);
  } else if (total === 0 && (r.status === "submitted" || r.status === "searching")) {
    await transitionRequest(tx, requestId, r.status, "no_coverage", side, actor, "Sin proveedores elegibles en la zona y categoría");
    await notify(tx, await clientRecipients(tx, requestId), {
      type: "request_received",
      title: `Todavía no hay profesionales disponibles · ${r.code}`,
      body: "No encontramos proveedores habilitados para tu zona y tipo de trabajo. Nuestro equipo lo revisa y te avisamos.",
      link: `/app/solicitudes/${requestId}`,
    });
    await notify(tx, await staffRecipients(tx), { type: "request_received", title: `Solicitud sin cobertura · ${r.code}`, link: `/admin/solicitudes/${requestId}`, email: false });
  }
  await recordEvent(tx, { entityType: "request", entityId: requestId, action: "matching_run", actorId: actor?.id ?? null, data: { candidates: candidates.length, invited } });
  return invited;
}

/** Crea y envía una solicitud. Valida que la propiedad pertenezca al usuario o a su organización. */
export async function createRequest(actor: Actor, input: RequestInput, photos: { data: Buffer; name: string }[] = []) {
  const d = requestSchema.parse(input);
  if (photos.length > 6) throw invalid("Podés adjuntar hasta 6 fotos.");
  return systemTx(async (tx) => {
    const [prop] = await tx<{ owner_user_id: string | null; organization_id: string | null }[]>`
      select owner_user_id, organization_id from properties where id = ${d.propertyId} and archived_at is null`;
    if (!prop) throw notFound("Propiedad inexistente.");
    let orgId: string | null = null;
    if (prop.owner_user_id) {
      if (prop.owner_user_id !== actor.id) throw forbidden();
    } else {
      const [{ role }] = await tx<{ role: string | null }[]>`select app.org_role(${actor.id}, ${prop.organization_id}) as role`;
      if (!role) throw forbidden();
      orgId = prop.organization_id;
    }
    let responsible: string | null = null;
    if (d.responsibleUserId) {
      if (!orgId) throw invalid("El responsable solo aplica a organizaciones.");
      const [{ role }] = await tx<{ role: string | null }[]>`select app.org_role(${d.responsibleUserId}, ${orgId}) as role`;
      if (!role) throw invalid("El responsable debe ser miembro de la organización.");
      responsible = d.responsibleUserId;
    }
    if (d.previousJobId) {
      const [{ ok }] = await tx<{ ok: boolean }[]>`select app.is_job_client(${actor.id}, ${d.previousJobId}) as ok`;
      if (!ok) throw forbidden();
    }

    // Categoría: explícita o sugerida por el asistente. Sin categoría o "otro" → revisión humana.
    let categoryId = d.categoryId ?? null;
    let requiresReview = false;
    let reviewReason: string | null = null;
    const triage = triageByRules(`${d.title}. ${d.description}`);
    if (!categoryId && triage.categorySlug && triage.confidence !== "low") {
      const [c] = await tx<{ id: string }[]>`select id from categories where slug = ${triage.categorySlug} and active`;
      categoryId = c?.id ?? null;
    }
    if (categoryId) {
      const [c] = await tx<{ requires_review: boolean }[]>`select requires_review from categories where id = ${categoryId} and active`;
      if (!c) throw invalid("Categoría inválida.");
      if (c.requires_review) {
        requiresReview = true;
        reviewReason = "Pedido fuera del catálogo o sin oficio definido";
      }
    } else {
      requiresReview = true;
      reviewReason = "No se pudo identificar la categoría";
    }
    let serviceId = d.serviceId ?? null;
    if (serviceId) {
      const [s] = await tx<{ category_id: string }[]>`select category_id from services where id = ${serviceId} and active`;
      if (!s || s.category_id !== categoryId) serviceId = null;
    }

    const [req] = await tx<{ id: string; code: string }[]>`
      insert into service_requests (created_by, organization_id, responsible_user_id, property_id, category_id, service_id, title, description,
        answers, urgency, preferred_windows, status, needs_review, review_reason, safety_flag, target_provider_id, previous_job_id)
      values (${actor.id}, ${orgId}, ${responsible}, ${d.propertyId}, ${categoryId}, ${serviceId}, ${d.title}, ${d.description},
        ${tx.json(d.answers as never)}, ${d.urgency}, ${tx.json(d.preferredWindows as never)}, 'draft',
        ${requiresReview}, ${reviewReason}, ${triage.safety?.level !== "none" ? triage.safety?.level ?? null : null},
        ${d.targetProviderId ?? null}, ${d.previousJobId ?? null})
      returning id, code`;
    await tx`insert into request_private (request_id, access_info) values (${req.id}, ${d.accessInfo || null})`;
    for (const ph of photos) {
      const fileId = await storeFile(tx, { data: ph.data, originalName: ph.name, uploadedBy: actor.id, purpose: "request_photo", ownerType: "request", ownerId: req.id, allowPdf: false });
      await tx`insert into request_attachments (request_id, file_id) values (${req.id}, ${fileId})`;
    }
    await recordEvent(tx, { entityType: "request", entityId: req.id, action: "created", to: "draft", actorId: actor.id });
    await transitionRequest(tx, req.id, "draft", "submitted", "client", actor);
    await notify(tx, [actor.id], {
      type: "request_received",
      title: `Recibimos tu solicitud · ${req.code}`,
      body: requiresReview ? "Una persona del equipo la revisa para derivarla al profesional adecuado." : "Estamos buscando profesionales disponibles.",
      link: `/app/solicitudes/${req.id}`,
    });

    if (requiresReview) {
      await notify(tx, await staffRecipients(tx), { type: "request_received", title: `Solicitud para revisar · ${req.code}`, body: reviewReason ?? "", link: `/admin/solicitudes/${req.id}`, email: false });
      return req.id;
    }
    if (d.targetProviderId) {
      // Pedido a un proveedor concreto: se invita solo si es elegible para esta categoría y zona.
      const eligible = (await findCandidates(tx, req.id)).some((c) => c.providerId === d.targetProviderId);
      if (eligible) {
        await inviteProviderTx(tx, req.id, d.targetProviderId, "client", actor.id);
        await transitionRequest(tx, req.id, "submitted", "searching", "system", null);
      } else {
        await tx`update service_requests set needs_review = true, review_reason = 'El profesional elegido no cubre esta zona o categoría' where id = ${req.id}`;
        await notify(tx, await staffRecipients(tx), { type: "request_received", title: `Solicitud para revisar · ${req.code}`, link: `/admin/solicitudes/${req.id}`, email: false });
      }
      return req.id;
    }
    await runMatchingTx(tx, req.id, null);
    return req.id;
  });
}

export async function cancelRequest(actor: Actor, requestId: string, reason: string) {
  if (!reason || reason.trim().length < 3) throw invalid("Contanos el motivo de la cancelación.");
  return systemTx(async (tx) => {
    const staff = isStaff(actor);
    if (!staff && !(await check(tx, "is_request_client", actor, requestId))) throw forbidden();
    const [r] = await tx<{ status: RequestStatus }[]>`select status from service_requests where id = ${requestId} for update`;
    await transitionRequest(tx, requestId, r.status, "cancelled", staff ? "staff" : "client", actor, reason);
    await tx`update service_requests set cancel_reason = ${reason} where id = ${requestId}`;
    await tx`update request_invitations set status = 'closed' where request_id = ${requestId} and status in ('invited','viewed')`;
    const quotes = await tx<{ id: string; provider_id: string }[]>`update quotes set status = 'rejected', decided_at = now() where request_id = ${requestId} and status = 'sent' returning id, provider_id`;
    for (const q of quotes) {
      await recordEvent(tx, { entityType: "quote", entityId: q.id, action: "status", from: "sent", to: "rejected", reason: "Solicitud cancelada" });
      await notify(tx, await providerRecipients(tx, q.provider_id), { type: "quote_received", title: "Una solicitud que cotizaste fue cancelada", link: "/proveedor/oportunidades" });
    }
    if (staff) await audit(tx, actor, "request.cancel", "request", requestId, reason);
  });
}

// ───────────────────────── Operación ─────────────────────────

export async function operatorSetCategory(actor: Actor, requestId: string, categoryId: string, reason: string) {
  if (!isStaff(actor)) throw forbidden();
  if (!reason || reason.trim().length < 3) throw invalid("Indicá el motivo.");
  return systemTx(async (tx) => {
    const [c] = await tx<{ requires_review: boolean }[]>`select requires_review from categories where id = ${categoryId} and active`;
    if (!c) throw invalid("Categoría inválida.");
    await tx`update service_requests set category_id = ${categoryId}, needs_review = false, review_reason = null where id = ${requestId}`;
    await audit(tx, actor, "request.set_category", "request", requestId, reason, { categoryId });
    await recordEvent(tx, { entityType: "request", entityId: requestId, action: "category_set", actorId: actor.id, actorRole: actor.platformRole, reason });
    return runMatchingTx(tx, requestId, actor);
  });
}

export async function operatorRunMatching(actor: Actor, requestId: string, reason: string) {
  if (!isStaff(actor)) throw forbidden();
  return systemTx(async (tx) => {
    await audit(tx, actor, "request.run_matching", "request", requestId, reason || "Reintento de matching");
    await tx`update service_requests set needs_review = false where id = ${requestId}`;
    return runMatchingTx(tx, requestId, actor);
  });
}

/** Invitación manual por operación (respeta elegibilidad del proveedor). */
export async function operatorInvite(actor: Actor, requestId: string, providerId: string, reason: string) {
  if (!isStaff(actor)) throw forbidden();
  if (!reason || reason.trim().length < 3) throw invalid("Indicá el motivo de la invitación manual.");
  return systemTx(async (tx) => {
    const [r] = await tx<{ status: RequestStatus }[]>`select status from service_requests where id = ${requestId} for update`;
    if (!["submitted", "searching", "with_quotes", "no_coverage"].includes(r.status)) throw invalid("La solicitud no admite nuevas invitaciones.");
    const eligible = (await findCandidates(tx, requestId)).some((c) => c.providerId === providerId);
    if (!eligible) throw invalid("Ese proveedor no es elegible para esta solicitud (categoría, zona, credenciales o estado).");
    const id = await inviteProviderTx(tx, requestId, providerId, "operator", actor.id);
    if (r.status === "submitted" || r.status === "no_coverage") await transitionRequest(tx, requestId, r.status, "searching", "staff", actor, reason);
    await tx`update service_requests set needs_review = false where id = ${requestId}`;
    await audit(tx, actor, "request.invite", "request", requestId, reason, { providerId });
    return id;
  });
}

// ───────────────────────── Lado proveedor ─────────────────────────

export async function markInvitationViewed(actor: Actor, invitationId: string) {
  return systemTx(async (tx) => {
    const [i] = await tx<{ provider_id: string; status: string }[]>`select provider_id, status from request_invitations where id = ${invitationId}`;
    if (!i) throw notFound();
    await assertProviderAdmin(tx, actor, i.provider_id);
    if (i.status === "invited") await tx`update request_invitations set status = 'viewed', responded_at = now() where id = ${invitationId}`;
  });
}

export async function declineInvitation(actor: Actor, invitationId: string, reason: string) {
  return systemTx(async (tx) => {
    const [i] = await tx<{ provider_id: string; status: string; request_id: string }[]>`select provider_id, status, request_id from request_invitations where id = ${invitationId} for update`;
    if (!i) throw notFound();
    await assertProviderAdmin(tx, actor, i.provider_id);
    if (!["invited", "viewed"].includes(i.status)) throw invalid("Esta invitación ya no está activa.");
    await tx`update request_invitations set status = 'declined', decline_reason = ${reason || null}, responded_at = now() where id = ${invitationId}`;
    await recordEvent(tx, { entityType: "request", entityId: i.request_id, action: "invitation_declined", actorId: actor.id, data: { providerId: i.provider_id } });
    // Si todos declinaron, se reintenta el matching con otros candidatos.
    const [{ active }] = await tx<{ active: number }[]>`select count(*)::int as active from request_invitations where request_id = ${i.request_id} and status in ('invited','viewed','quoted')`;
    const [r] = await tx<{ status: string }[]>`select status from service_requests where id = ${i.request_id}`;
    if (active === 0 && r.status === "searching") await runMatchingTx(tx, i.request_id, null);
  });
}
