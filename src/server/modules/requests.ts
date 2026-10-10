/** Solicitudes, borradores anónimos, matching e invitaciones. */
import { formatMoney } from "@/lib/format";
import { maskContactInfo } from "@/server/domain/contact-guard";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Db, Tx } from "@/server/db/client";
import { sql, systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { audit, recordEvent } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { assertTransition, requestMachine, type RequestStatus, type ActorSide } from "@/server/domain/state-machines";
import { triageByRules } from "@/server/assistant/rules";
import { clientRecipients, notify, providerRecipients, staffRecipients } from "@/server/notifications";
import { getSetting } from "./catalog";
import { profileFacts } from "./providers";
import { profileStrength, rankingBoost } from "@/lib/profile-strength";
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
  /** Pedido con presupuesto: lo que el cliente quiere pagar por el trabajo (sin el cargo de servicio). */
  budgetMinor: z.coerce.number().int().min(500_000, "El presupuesto mínimo es de $ 5.000.").max(100_000_000_00).optional().nullable(),
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
  /** Aprobado, con identidad verificada y las credenciales que exige el rubro. Si no, puede recibir el pedido pero debe verificarse para aceptarlo. */
  verified: boolean;
};

/**
 * Matching determinista. Filtros: categoría, cobertura, proveedor aprobado, identidad verificada,
 * cobros habilitados, credenciales requeridas vigentes, disponibilidad declarada, acepta trabajos.
 * Orden: disponibilidad, reputación (con prior: los nuevos no quedan excluidos), carga, cercanía,
 * y como desempate, menos invitaciones recientes (rotación justa).
 */
export async function findCandidates(db: Db, requestId: string, opts: { excludeInvited?: boolean; verifiedOnly?: boolean } = {}): Promise<Candidate[]> {
  const [r] = await db<{ category_id: string | null; zone_id: string; region: string; preferred_windows: string[] }[]>`
    select r.category_id, p.zone_id, z.region, r.preferred_windows
    from service_requests r join properties p on p.id = r.property_id join zones z on z.id = p.zone_id where r.id = ${requestId}`;
  if (!r || !r.category_id) return [];
  return findCandidatesFor(db, { categoryId: r.category_id, zoneId: r.zone_id, region: r.region, preferredWindows: r.preferred_windows ?? [], excludeInvitedFor: opts.excludeInvited ? requestId : undefined, verifiedOnly: opts.verifiedOnly });
}

/** Matching sin solicitud previa (para que el cliente elija profesional antes de enviar el pedido). */
export async function findCandidatesFor(
  db: Db,
  q: { categoryId: string; zoneId: string; region: string; preferredWindows: string[]; excludeInvitedFor?: string; verifiedOnly?: boolean },
): Promise<Candidate[]> {
  const r = { category_id: q.categoryId, zone_id: q.zoneId, region: q.region, preferred_windows: q.preferredWindows };
  const requestId = q.excludeInvitedFor ?? null;
  const rows = await db<{
    id: string; display_name: string; base_zone_id: string | null; base_region: string | null; max_active_jobs: number;
    active_jobs: number; reviews: number; rating_sum: number; recent_invites: number; verified: boolean;
    slots: { weekday: number; start_minute: number; end_minute: number }[];
  }[]>`
    select p.id, p.display_name, p.base_zone_id, bz.region as base_region, p.max_active_jobs,
      (p.status = 'approved' and p.identity_status = 'verified' and not exists (
        select 1 from category_required_credentials rc where rc.category_id = ${r.category_id}
        and not exists (select 1 from provider_documents d where d.provider_id = p.id and d.credential_type_id = rc.credential_type_id
          and d.status = 'approved' and (d.expires_on is null or d.expires_on >= current_date)))) as verified,
      (select count(*)::int from jobs j where j.provider_id = p.id and j.status in ('pending_confirmation','confirmed','on_the_way','in_progress','pending_approval')) as active_jobs,
      (select count(*)::int from reviews_published v where v.provider_id = p.id) as reviews,
      (select coalesce(sum(rating), 0)::int from reviews_published v where v.provider_id = p.id) as rating_sum,
      (select count(*)::int from request_invitations i where i.provider_id = p.id and i.created_at > now() - interval '14 days') as recent_invites,
      (select coalesce(json_agg(json_build_object('weekday', a.weekday, 'start_minute', a.start_minute, 'end_minute', a.end_minute)), '[]')
         from provider_availability a where a.provider_id = p.id) as slots
    from providers p
    left join zones bz on bz.id = p.base_zone_id
    -- Se muestran todos los que cubren rubro y zona (verificados o no); rechazados y suspendidos no.
    where p.status in ('pending','in_review','approved') and p.accepting_jobs
      and exists (select 1 from provider_categories pc where pc.provider_id = p.id and pc.category_id = ${r.category_id})
      and exists (select 1 from provider_zones pz where pz.provider_id = p.id and pz.zone_id = ${r.zone_id})
      ${requestId ? db`and not exists (select 1 from request_invitations i where i.request_id = ${requestId} and i.provider_id = p.id)` : db``}`;

  const prefs = r.preferred_windows ?? [];
  const pool = q.verifiedOnly ? rows.filter((p) => p.verified) : rows;
  const facts = await profileFacts(db, pool.map((p) => p.id));
  const candidates = pool.map((p) => {
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
    // Perfil completo (fotos, precios, verificación…): suma hasta 15 puntos
    const f = facts.get(p.id);
    const strength = f ? profileStrength(f).score : 0;
    const completeness = rankingBoost(strength);
    reasons.push(`Perfil completo al ${strength}%`);
    reasons.push(p.verified ? "Identidad verificada" : "Todavía no verificó su identidad");
    return {
      providerId: p.id,
      displayName: p.display_name,
      score: availability + reputation + workload + proximity + completeness,
      reasons,
      activeJobs: p.active_jobs,
      reviews: p.reviews,
      rating: p.reviews ? Math.round((p.rating_sum / p.reviews) * 10) / 10 : null,
      recentInvites: p.recent_invites,
      verified: p.verified,
    };
  });
  // Primero los verificados; dentro de cada grupo, por puntaje.
  candidates.sort((a, b) => Number(b.verified) - Number(a.verified) || b.score - a.score || a.recentInvites - b.recentInvites || a.providerId.localeCompare(b.providerId));
  return candidates.map((c) => ({ providerId: c.providerId, displayName: c.displayName, score: c.score, reasons: c.reasons, activeJobs: c.activeJobs, reviews: c.reviews, rating: c.rating, verified: c.verified }));
}

async function transitionRequest(tx: Tx, requestId: string, from: RequestStatus, to: RequestStatus, side: ActorSide, actor: Actor | null, reason?: string) {
  assertTransition(requestMachine, from, to, side);
  await tx`update service_requests set status = ${to},
    submitted_at = case when ${to} = 'submitted' then now() else submitted_at end where id = ${requestId}`;
  await recordEvent(tx, { entityType: "request", entityId: requestId, action: "status", from, to, actorId: actor?.id ?? null, actorRole: actor?.platformRole ?? side, reason });
}

async function inviteProviderTx(tx: Tx, requestId: string, providerId: string, source: "matching" | "client" | "operator", invitedBy: string | null, rank?: { position: number; score: number; reasons: string[] }, respondBy?: Date | null, verified = true, referralId?: string) {
  const inserted = await tx<{ id: string }[]>`
    insert into request_invitations (request_id, provider_id, source, invited_by, rank_position, rank_score, rank_reasons, respond_by, referral_id)
    values (${requestId}, ${providerId}, ${source}, ${invitedBy}, ${rank?.position ?? null}, ${rank?.score ?? null}, ${tx.json((rank?.reasons ?? []) as never)}, ${respondBy ?? null}, ${referralId ?? null})
    on conflict (request_id, provider_id) do nothing returning id`;
  if (!inserted.length) return null;
  await tx`insert into conversations (request_id, provider_id) values (${requestId}, ${providerId}) on conflict do nothing`;
  const [r] = await tx<{ code: string; title: string; request_mode: string; budget_minor: number | null; category: string | null; zone: string }[]>`
    select r.code, r.title, r.request_mode, r.budget_minor, lower(c.name) as category, z.name as zone
    from service_requests r join properties p on p.id = r.property_id join zones z on z.id = p.zone_id left join categories c on c.id = r.category_id
    where r.id = ${requestId}`;
  const budget = r.request_mode === "budget" && r.budget_minor ? Number(r.budget_minor) : null;
  const [refInfo] = referralId ? await tx<{ from_name: string; fee_bps: number }[]>`
    select p.display_name as from_name, pr.fee_bps from provider_referrals pr join providers p on p.id = pr.from_provider_id where pr.id = ${referralId}` : [];
  await notify(tx, await providerRecipients(tx, providerId), {
    type: "invitation",
    title: refInfo ? `${refInfo.from_name} te recomendó y el cliente te eligió · ${r.code}` : source === "client" ? `Un cliente te eligió · ${r.code}`
      : budget ? `Un cliente ofrece ${formatMoney(budget)} · ${r.code}` : `Nueva oportunidad · ${r.code}`,
    body: verified
      ? (source === "client" ? `${r.title}. Respondé para coordinar la visita.` : budget ? `${r.title}. Anotate por ese precio u ofrecé menos para ganarlo.` : r.title)
      : `${r.title}. Para aceptarlo, primero verificá tu cuenta: cargá tu DNI y enviá tu perfil a revisión. Te damos prioridad.`,
    link: `/proveedor/oportunidades/${inserted[0].id}`,
    // WhatsApp, solo si el profesional activó los avisos.
    whatsapp: {
      audience: "provider",
      requestId: inserted[0].id,
      ...(source === "client" || refInfo
        ? { template: "chosenYou" as const, params: [r.category ?? "servicios", r.zone, r.title], text: `Un cliente te eligió para un trabajo de ${r.category ?? "servicios"} en ${r.zone}: «${r.title}». Respondé lo antes posible desde Fixy.` }
        : budget
          ? { template: "budgetOffer" as const, params: [formatMoney(budget), r.category ?? "servicios", r.zone, r.title], text: `Un cliente ofrece ${formatMoney(budget)} por un trabajo de ${r.category ?? "servicios"} en ${r.zone}: «${r.title}». Anotate por ese precio u ofrecé menos.` }
          : { template: "newOpportunity" as const, params: [r.category ?? "servicios", r.zone, r.title], text: `Tenés un pedido nuevo de ${r.category ?? "servicios"} en ${r.zone}: «${r.title}». Revisalo y respondé desde Fixy.` }),
    },
  });
  if (!verified) {
    const [p] = await tx<{ display_name: string }[]>`select display_name from providers where id = ${providerId}`;
    await notify(tx, await staffRecipients(tx), {
      type: "invitation", title: `Verificación prioritaria: ${p.display_name} tiene un pedido (${r.code})`,
      body: "Un cliente lo eligió y todavía no está verificado. Revisá su documentación lo antes posible.", link: `/admin/proveedores/${providerId}`, email: false,
    });
  }
  return inserted[0].id;
}

/** Corre el matching e invita a un grupo acotado. Devuelve cuántos proveedores se invitaron. */
export async function runMatchingTx(tx: Tx, requestId: string, actor: Actor | null): Promise<number> {
  const [r] = await tx<{ status: RequestStatus; code: string; request_mode: string }[]>`select status, code, request_mode from service_requests where id = ${requestId} for update`;
  // Con presupuesto del cliente se abre a más profesionales de la zona: compiten por precio.
  const limit = r.request_mode === "budget"
    ? Number(await getSetting<number>(tx, "matching.budget_invite_limit", 15))
    : await getSetting<number>(tx, "matching.invite_limit", 4);
  // Pedido de presupuestos: se invita primero a verificados; si no hay, a los demás (deberán verificarse para responder).
  const verified = await findCandidates(tx, requestId, { excludeInvited: true, verifiedOnly: true });
  const candidates = verified.length ? verified : await findCandidates(tx, requestId, { excludeInvited: true });
  const chosen = candidates.slice(0, limit);
  let invited = 0;
  for (const [i, c] of chosen.entries()) {
    const id = await inviteProviderTx(tx, requestId, c.providerId, "matching", actor?.id ?? null, { position: i + 1, score: c.score, reasons: c.reasons }, null, c.verified);
    if (id) invited++;
  }
  const [{ total }] = await tx<{ total: number }[]>`select count(*)::int as total from request_invitations where request_id = ${requestId} and status not in ('declined','expired')`;
  const side: ActorSide = actor && can(actor, "solicitudes", "manage") ? "staff" : "system";
  if (total > 0 && (r.status === "submitted" || r.status === "no_coverage")) {
    await transitionRequest(tx, requestId, r.status, "searching", side, actor);
  } else if (total === 0 && (r.status === "submitted" || r.status === "searching")) {
    await transitionRequest(tx, requestId, r.status, "no_coverage", side, actor, "Sin proveedores elegibles en la zona y categoría");
    await notify(tx, await clientRecipients(tx, requestId), {
      type: "request_received",
      title: `Estamos buscando un profesional para vos · ${r.code}`,
      body: "Nuestro equipo ya está viendo tu pedido para conectarte con un profesional. Te avisamos apenas lo tome.",
      link: `/app/solicitudes/${requestId}`,
    });
    await notify(tx, await staffRecipients(tx), { type: "request_received", title: `Pedido para conseguir a mano · ${r.code}`, link: `/admin/solicitudes/${requestId}` });
  }
  await recordEvent(tx, { entityType: "request", entityId: requestId, action: "matching_run", actorId: actor?.id ?? null, data: { candidates: candidates.length, invited } });
  return invited;
}

/**
 * Vuelve a buscar profesionales para pedidos abiertos que quedaron sin cobertura o con pocos invitados
 * (por ejemplo, porque el profesional se sumó después). Completa hasta el cupo de invitaciones activas;
 * nunca re-invita a quien ya fue invitado. Lo corre el cron y también se puede acotar a un profesional.
 */
export async function rematchOpenRequests(opts: { providerId?: string; requestId?: string } = {}): Promise<number> {
  const reqs = await sql()<{ id: string }[]>`
    select r.id from service_requests r
    where r.status in ('no_coverage','searching') and r.request_mode in ('quotes','budget') and not r.needs_review
      and r.category_id is not null and r.created_at > now() - interval '14 days'
      ${opts.requestId ? sql()`and r.id = ${opts.requestId}` : sql()``}
      ${opts.providerId ? sql()`and exists (
        select 1 from properties p join provider_zones pz on pz.zone_id = p.zone_id join provider_categories pc on pc.provider_id = pz.provider_id and pc.category_id = r.category_id
        where p.id = r.property_id and pz.provider_id = ${opts.providerId})
        and not exists (select 1 from request_invitations i where i.request_id = r.id and i.provider_id = ${opts.providerId})` : sql()``}
    order by r.created_at limit 50`;
  let invited = 0;
  for (const r of reqs) {
    invited += await systemTx(async (tx) => {
      const [cur] = await tx<{ status: RequestStatus; request_mode: string }[]>`select status, request_mode from service_requests where id = ${r.id} for update`;
      if (!["no_coverage", "searching"].includes(cur.status)) return 0;
      const limit = cur.request_mode === "budget"
        ? Number(await getSetting<number>(tx, "matching.budget_invite_limit", 15))
        : Number(await getSetting<number>(tx, "matching.invite_limit", 4));
      const [{ active }] = await tx<{ active: number }[]>`
        select count(*)::int as active from request_invitations where request_id = ${r.id} and status in ('invited','viewed','quoted')`;
      if (active >= limit) return 0;
      const verified = await findCandidates(tx, r.id, { excludeInvited: true, verifiedOnly: true });
      const all = verified.length ? verified : await findCandidates(tx, r.id, { excludeInvited: true });
      const chosen = all.slice(0, limit - active);
      if (!chosen.length) return 0;
      let n = 0;
      for (const [i, c] of chosen.entries()) {
        if (await inviteProviderTx(tx, r.id, c.providerId, "matching", null, { position: active + i + 1, score: c.score, reasons: c.reasons }, null, c.verified)) n++;
      }
      if (n && cur.status === "no_coverage") {
        await transitionRequest(tx, r.id, "no_coverage", "searching", "system", null);
        const [{ code }] = await tx<{ code: string }[]>`select code from service_requests where id = ${r.id}`;
        await notify(tx, await clientRecipients(tx, r.id), {
          type: "request_received", title: `Encontramos profesionales para tu pedido · ${code}`,
          body: `Le enviamos tu pedido a ${n} profesional${n === 1 ? "" : "es"} de tu zona. Te avisamos cuando respondan.`, link: `/app/solicitudes/${r.id}`,
        });
      }
      await recordEvent(tx, { entityType: "request", entityId: r.id, action: "rematch", data: { invited: n } });
      return n;
    });
  }
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
        answers, urgency, preferred_windows, status, needs_review, review_reason, safety_flag, target_provider_id, previous_job_id, request_mode, budget_minor)
      values (${actor.id}, ${orgId}, ${responsible}, ${d.propertyId}, ${categoryId}, ${serviceId}, ${maskContactInfo(d.title).text}, ${maskContactInfo(d.description).text},
        ${tx.json(d.answers as never)}, ${d.urgency}, ${tx.json(d.preferredWindows as never)}, 'draft',
        ${requiresReview}, ${reviewReason}, ${triage.safety?.level !== "none" ? triage.safety?.level ?? null : null},
        ${d.targetProviderId ?? null}, ${d.previousJobId ?? null}, ${d.targetProviderId ? "direct" : d.budgetMinor ? "budget" : "quotes"},
        ${d.targetProviderId ? null : d.budgetMinor ?? null})
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
      const target = (await findCandidates(tx, req.id)).find((c) => c.providerId === d.targetProviderId);
      if (target) {
        await inviteProviderTx(tx, req.id, d.targetProviderId, "client", actor.id, undefined, await respondBy(tx, d.urgency, target.verified), target.verified);
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
    const staff = can(actor, "solicitudes", "manage");
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
  if (!can(actor, "solicitudes", "manage")) throw forbidden();
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
  if (!can(actor, "solicitudes", "manage")) throw forbidden();
  return systemTx(async (tx) => {
    await audit(tx, actor, "request.run_matching", "request", requestId, reason || "Reintento de matching");
    await tx`update service_requests set needs_review = false where id = ${requestId}`;
    return runMatchingTx(tx, requestId, actor);
  });
}

/** Invitación manual por operación (respeta elegibilidad del proveedor). */
export async function operatorInvite(actor: Actor, requestId: string, providerId: string, reason: string) {
  if (!can(actor, "solicitudes", "manage")) throw forbidden();
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

export async function declineInvitation(actor: Actor, invitationId: string, reason: string, referral?: { toProviderId: string; note?: string } | null) {
  return systemTx(async (tx) => {
    const [i] = await tx<{ provider_id: string; status: string; request_id: string }[]>`select provider_id, status, request_id from request_invitations where id = ${invitationId} for update`;
    if (!i) throw notFound();
    await assertProviderAdmin(tx, actor, i.provider_id);
    if (!["invited", "viewed"].includes(i.status)) throw invalid("Esta invitación ya no está activa.");
    await tx`update request_invitations set status = 'declined', decline_reason = ${reason || null}, responded_at = now() where id = ${invitationId}`;
    await recordEvent(tx, { entityType: "request", entityId: i.request_id, action: "invitation_declined", actorId: actor.id, data: { providerId: i.provider_id } });
    const [r] = await tx<{ status: string; request_mode: string; code: string }[]>`select status, request_mode, code from service_requests where id = ${i.request_id}`;
    if (referral?.toProviderId) await proposeReferralTx(tx, actor, i.request_id, i.provider_id, referral.toProviderId, referral.note ?? "", r.code);
    if (r.request_mode === "direct") {
      // Reserva directa: el cliente elige otro profesional.
      await notify(tx, await clientRecipients(tx, i.request_id), {
        type: "request_received",
        title: `El profesional no puede tomar tu pedido · ${r.code}`,
        body: "Elegí otro profesional de la lista. No se te cobró nada.",
        link: `/app/solicitudes/${i.request_id}`,
      });
      return;
    }
    // Presupuestos a varios: si todos declinaron, se reintenta el matching con otros candidatos.
    const [{ active }] = await tx<{ active: number }[]>`select count(*)::int as active from request_invitations where request_id = ${i.request_id} and status in ('invited','viewed','quoted')`;
    if (active === 0 && r.status === "searching") await runMatchingTx(tx, i.request_id, null);
  });
}

// ───────────────────────── Reserva directa ─────────────────────────

async function respondBy(db: Db, urgency: string, providerVerified = true) {
  // Si el profesional todavía tiene que verificarse, le damos más tiempo para hacerlo y responder.
  if (!providerVerified) return new Date(Date.now() + Number(await getSetting<number>(db, "booking.respond_hours_unverified", 48)) * 3600_000);
  const hours = urgency === "urgent"
    ? await getSetting<number>(db, "booking.respond_hours_urgent", 2)
    : await getSetting<number>(db, "booking.respond_hours", 4);
  return new Date(Date.now() + Number(hours) * 3600_000);
}

/** El cliente elige (otro) profesional para su pedido. Solo si no hay otra reserva activa. */
export async function chooseProvider(actor: Actor, requestId: string, providerId: string, referralId?: string) {
  return systemTx(async (tx) => {
    if (!(await check(tx, "is_request_client", actor, requestId))) throw forbidden();
    const [r] = await tx<{ status: RequestStatus; urgency: string; request_mode: string }[]>`select status, urgency, request_mode from service_requests where id = ${requestId} for update`;
    if (!["submitted", "searching", "no_coverage", "with_quotes"].includes(r.status)) throw invalid("Este pedido ya no admite cambios de profesional.");
    const [{ active }] = await tx<{ active: number }[]>`
      select count(*)::int as active from request_invitations where request_id = ${requestId} and status in ('invited','viewed')`;
    if (r.request_mode === "direct" && active > 0) throw invalid("Ya hay un profesional evaluando tu pedido. Esperá su respuesta o el vencimiento del plazo.");
    let target: { verified: boolean } | undefined = (await findCandidates(tx, requestId, { excludeInvited: true })).find((c) => c.providerId === providerId);
    if (!target && referralId) {
      // Recomendado por un colega: alcanza con que ofrezca el rubro (validado al recomendar), aunque no tenga la zona cargada.
      const [rp] = await tx<{ verified: boolean }[]>`
        select (p.status = 'approved' and p.identity_status = 'verified') as verified from provider_referrals pr join providers p on p.id = pr.to_provider_id
        where pr.id = ${referralId} and pr.request_id = ${requestId} and pr.to_provider_id = ${providerId} and pr.status = 'proposed'
          and p.status in ('pending','in_review','approved') and p.accepting_jobs`;
      target = rp;
    }
    if (!target) throw invalid("Ese profesional no está disponible para este pedido.");
    // Si había un presupuesto de visita de otro profesional sin confirmar, se descarta.
    const old = await tx<{ id: string }[]>`update quotes set status = 'rejected', decided_at = now() where request_id = ${requestId} and status = 'sent' returning id`;
    for (const q of old) await recordEvent(tx, { entityType: "quote", entityId: q.id, action: "status", from: "sent", to: "rejected", reason: "El cliente eligió otro profesional" });
    await tx`update service_requests set request_mode = 'direct', target_provider_id = ${providerId}, needs_review = false where id = ${requestId}`;
    const invId = await inviteProviderTx(tx, requestId, providerId, "client", actor.id, undefined, await respondBy(tx, r.urgency, target.verified), target.verified, referralId);
    if (referralId && invId) {
      await tx`update provider_referrals set status = 'accepted', decided_at = now() where id = ${referralId} and request_id = ${requestId} and to_provider_id = ${providerId}`;
    }
    if (r.status !== "searching") {
      if (r.status === "with_quotes") await tx`update service_requests set status = 'searching' where id = ${requestId}`;
      else await transitionRequest(tx, requestId, r.status, "searching", "system", null, "El cliente eligió profesional");
    }
    await recordEvent(tx, { entityType: "request", entityId: requestId, action: "provider_chosen", actorId: actor.id, data: { providerId } });
  });
}

/** Opción secundaria: pasar a pedir presupuestos a varios profesionales. */
export async function switchToQuotes(actor: Actor, requestId: string) {
  return systemTx(async (tx) => {
    if (!(await check(tx, "is_request_client", actor, requestId))) throw forbidden();
    const [r] = await tx<{ status: RequestStatus }[]>`select status from service_requests where id = ${requestId} for update`;
    if (!["submitted", "searching", "no_coverage", "with_quotes"].includes(r.status)) throw invalid("Este pedido ya no admite cambios.");
    await tx`update service_requests set request_mode = 'quotes', needs_review = false where id = ${requestId}`;
    await recordEvent(tx, { entityType: "request", entityId: requestId, action: "switched_to_quotes", actorId: actor.id });
    return runMatchingTx(tx, requestId, null);
  });
}

/** Cron: reservas directas sin respuesta en plazo → vencen y se avisa al cliente para que elija otro. */
export async function expireDirectBookings() {
  return systemTx(async (tx) => {
    const expired = await tx<{ id: string; request_id: string; provider_id: string }[]>`
      update request_invitations i set status = 'expired', responded_at = now()
      from service_requests r
      where r.id = i.request_id and r.request_mode = 'direct' and i.status in ('invited','viewed') and i.respond_by is not null and i.respond_by < now()
      returning i.id, i.request_id, i.provider_id`;
    for (const e of expired) {
      const [r] = await tx<{ code: string }[]>`select code from service_requests where id = ${e.request_id}`;
      await recordEvent(tx, { entityType: "request", entityId: e.request_id, action: "booking_expired", data: { providerId: e.provider_id } });
      await notify(tx, await clientRecipients(tx, e.request_id), {
        type: "request_received",
        title: `El profesional no respondió a tiempo · ${r.code}`,
        body: "Elegí otro profesional de la lista. No se te cobró nada.",
        link: `/app/solicitudes/${e.request_id}`,
      });
      await notify(tx, await providerRecipients(tx, e.provider_id), { type: "invitation", title: `Venció el plazo para responder · ${r.code}`, link: "/proveedor/oportunidades", email: false });
    }
    return expired.length;
  });
}

// ───────────────────────── Detalles agregados después ─────────────────────────

/**
 * El cliente suma información a un pedido abierto (texto). Queda al final de la descripción, fechado,
 * y se avisa a los profesionales invitados o al del trabajo. Las fotos se adjuntan aparte (request_attachments).
 */
export async function addRequestDetails(actor: Actor, requestId: string, text: string) {
  const note = z.string().trim().min(3, "Contame qué querés sumar.").max(1000).parse(text);
  return systemTx(async (tx) => {
    if (!(await check(tx, "is_request_client", actor, requestId))) throw forbidden();
    const [r] = await tx<{ status: string; description: string; code: string }[]>`select status, description, code from service_requests where id = ${requestId} for update`;
    if (r.status === "cancelled") throw invalid("Ese pedido está cancelado.");
    const stamp = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
    // Lo ven los profesionales invitados antes de confirmar la visita: sin teléfonos, emails ni links.
    const next = `${r.description}\n\nAgregado por el cliente (${stamp}): ${maskContactInfo(note).text}`;
    if (next.length > 4000) throw invalid("El pedido ya tiene mucha información. Escribile al profesional por el chat del pedido.");
    await tx`update service_requests set description = ${next} where id = ${requestId}`;
    await recordEvent(tx, { entityType: "request", entityId: requestId, action: "details_added", actorId: actor.id });
    await notifyRequestUpdate(tx, requestId, r.code, "sumó detalles");
  });
}

/** Avisa a los profesionales que están evaluando o tienen el trabajo que el cliente actualizó el pedido. */
export async function notifyRequestUpdate(tx: Tx, requestId: string, code: string, what: string) {
  const provs = await tx<{ provider_id: string; inv_id: string | null; job_id: string | null }[]>`
    select i.provider_id, i.id as inv_id, (select j.id from jobs j where j.request_id = ${requestId} and j.provider_id = i.provider_id and j.status <> 'cancelled' limit 1) as job_id
    from request_invitations i where i.request_id = ${requestId} and i.status in ('invited','viewed','quoted')`;
  for (const p of provs) {
    await notify(tx, await providerRecipients(tx, p.provider_id), {
      type: "invitation", title: `El cliente ${what} · ${code}`, body: "Revisá el pedido actualizado.",
      link: p.job_id ? `/proveedor/trabajos/${p.job_id}` : `/proveedor/oportunidades/${p.inv_id}`,
    });
  }
}

// ───────────────────────── Recomendación entre colegas ─────────────────────────

/** Colegas que se pueden recomendar para un pedido: cubren el rubro, no están rechazados ni suspendidos. */
export async function referralCandidates(db: Db, requestId: string, fromProviderId: string) {
  return db<{ id: string; display_name: string; verified: boolean; covers_zone: boolean }[]>`
    select p.id, p.display_name, (p.status = 'approved' and p.identity_status = 'verified') as verified,
      exists (select 1 from provider_zones pz join properties pr on pr.zone_id = pz.zone_id join service_requests r on r.property_id = pr.id
        where r.id = ${requestId} and pz.provider_id = p.id) as covers_zone
    from providers p join service_requests r on r.id = ${requestId}
    where p.id <> ${fromProviderId} and p.status in ('pending','in_review','approved') and p.accepting_jobs
      and exists (select 1 from provider_categories pc where pc.provider_id = p.id and pc.category_id = r.category_id)
    order by covers_zone desc, verified desc, p.display_name limit 100`;
}

async function proposeReferralTx(tx: Tx, actor: Actor, requestId: string, fromProviderId: string, toProviderId: string, note: string, code: string) {
  const candidates = await referralCandidates(tx as unknown as Db, requestId, fromProviderId);
  const to = candidates.find((c) => c.id === toProviderId);
  if (!to) throw invalid("Ese colega no puede recibir este pedido (tiene que ofrecer el mismo rubro).");
  const feeBps = Number(await getSetting<number>(tx, "referrals.fee_bps", 1000));
  const [ref] = await tx<{ id: string }[]>`
    insert into provider_referrals (request_id, from_provider_id, to_provider_id, note, fee_bps, created_by)
    values (${requestId}, ${fromProviderId}, ${toProviderId}, ${note.trim().slice(0, 500) || null}, ${feeBps}, ${actor.id})
    on conflict (request_id, from_provider_id) do update set to_provider_id = excluded.to_provider_id, note = excluded.note, status = 'proposed', decided_at = null
    returning id`;
  const [names] = await tx<{ from_name: string; to_name: string }[]>`
    select (select display_name from providers where id = ${fromProviderId}) as from_name, (select display_name from providers where id = ${toProviderId}) as to_name`;
  await recordEvent(tx, { entityType: "request", entityId: requestId, action: "referral_proposed", actorId: actor.id, data: { referralId: ref.id, toProviderId } });
  await notify(tx, await clientRecipients(tx, requestId), {
    type: "request_received", title: `${names.from_name} no puede, pero te recomienda a ${names.to_name} · ${code}`,
    body: `${to.verified ? "" : "Todavía no verificó su identidad. "}Podés aceptar la recomendación o elegir otro profesional.`,
    link: `/app/solicitudes/${requestId}`,
  });
}

/** El cliente acepta la recomendación: se invita al colega recomendado (con el aviso del 10 % para quien recomendó). */
export async function acceptReferral(actor: Actor, referralId: string) {
  const [ref] = await sql()<{ request_id: string; to_provider_id: string; status: string }[]>`select request_id, to_provider_id, status from provider_referrals where id = ${referralId}`;
  if (!ref) throw notFound();
  if (ref.status !== "proposed") throw invalid("Esta recomendación ya no está disponible.");
  await chooseProvider(actor, ref.request_id, ref.to_provider_id, referralId);
}

export async function declineReferral(actor: Actor, referralId: string) {
  return systemTx(async (tx) => {
    const [ref] = await tx<{ request_id: string; status: string }[]>`select request_id, status from provider_referrals where id = ${referralId} for update`;
    if (!ref) throw notFound();
    if (!(await check(tx, "is_request_client", actor, ref.request_id))) throw forbidden();
    if (ref.status !== "proposed") throw invalid("Esta recomendación ya no está disponible.");
    await tx`update provider_referrals set status = 'declined', decided_at = now() where id = ${referralId}`;
  });
}
