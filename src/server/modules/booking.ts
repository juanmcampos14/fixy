/** Profesionales para que el cliente elija (solo datos públicos). */
import type { Db } from "@/server/db/client";
import { findCandidatesFor } from "./requests";
import { publicFileUrl } from "@/server/storage";

export type BookableProvider = {
  id: string; slug: string; displayName: string; kind: string; isDemo: boolean; description: string; yearsExperience: number | null;
  rating: number | null; reviews: number; completedJobs: number; identityVerified: boolean; verified: boolean; credentials: string[];
  visitFeeMinor: number; visitFeeCredited: boolean; priceRefs: { title: string; fromMinor: number; note: string }[];
  availabilityMatch: boolean; sameZone: boolean; approvedAt: Date | null; avatarUrl: string | null;
};

export async function listBookableProviders(
  db: Db,
  q: { categoryId: string; zoneId: string; preferredWindows: string[]; limit?: number; excludeInvitedFor?: string },
): Promise<BookableProvider[]> {
  const [z] = await db<{ region: string }[]>`select region from zones where id = ${q.zoneId}`;
  if (!z) return [];
  const candidates = await findCandidatesFor(db, { categoryId: q.categoryId, zoneId: q.zoneId, region: z.region, preferredWindows: q.preferredWindows, excludeInvitedFor: q.excludeInvitedFor });
  const top = candidates.slice(0, q.limit ?? 12);
  if (!top.length) return [];
  const ids = top.map((c) => c.providerId);
  const rows = await db<{ id: string; slug: string; display_name: string; kind: string; is_demo: boolean; description: string; years_experience: number | null; identity_status: string; visit_fee_minor: number; visit_fee_credited: boolean; base_zone_id: string | null; approved_at: Date | null; completed: number; avatar_file_id: string | null }[]>`
    select p.id, p.slug, p.display_name, p.kind, p.is_demo, p.description, p.years_experience, p.identity_status, p.visit_fee_minor, p.visit_fee_credited, p.base_zone_id, p.approved_at, p.avatar_file_id,
      (select count(*)::int from jobs j where j.provider_id = p.id and j.status = 'completed') as completed
    from providers p where p.id in ${db(ids)}`;
  const refs = await db<{ provider_id: string; title: string; from_minor: number; note: string }[]>`
    select provider_id, title, from_minor, note from provider_price_refs where provider_id in ${db(ids)} and category_id = ${q.categoryId} order by sort, from_minor`;
  const creds = await db<{ provider_id: string; name: string }[]>`
    select cp.provider_id, ct.name from provider_credentials_public cp join credential_types ct on ct.id = cp.credential_type_id where cp.provider_id in ${db(ids)}`;
  return top.map((c) => {
    const p = rows.find((r) => r.id === c.providerId)!;
    return {
      id: p.id, slug: p.slug, displayName: p.display_name, kind: p.kind, isDemo: p.is_demo, description: p.description, yearsExperience: p.years_experience,
      rating: c.rating, reviews: c.reviews, completedJobs: p.completed, identityVerified: p.identity_status === "verified", verified: c.verified,
      credentials: creds.filter((x) => x.provider_id === p.id).map((x) => x.name),
      visitFeeMinor: p.visit_fee_minor, visitFeeCredited: p.visit_fee_credited,
      priceRefs: refs.filter((r) => r.provider_id === p.id).slice(0, 4).map((r) => ({ title: r.title, fromMinor: r.from_minor, note: r.note })),
      availabilityMatch: c.reasons.some((r) => r.startsWith("Disponibilidad compatible")),
      sameZone: p.base_zone_id === q.zoneId,
      approvedAt: p.approved_at,
      avatarUrl: p.avatar_file_id ? publicFileUrl(p.avatar_file_id) : null,
    };
  });
}
