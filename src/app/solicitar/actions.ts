"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { act, files, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { getActor } from "@/server/auth/session";
import { triage } from "@/server/assistant";
import { rateLimit } from "@/server/rate-limit";
import { DRAFT_COOKIE, saveAnonymousDraft } from "@/server/modules/requests";
import { requestPayloadSchema, submitRequestPayload } from "@/server/modules/request-submit";
import { attachWhatsAppPhotos } from "@/server/whatsapp/bot";
import { sql } from "@/server/db/client";
import { headers } from "next/headers";

export async function triageAction(text: string, categorySlug: string | null) {
  const h = await headers();
  await rateLimit(`triage:${h.get("x-forwarded-for") ?? "local"}`, 60, 600).catch(() => null);
  const t = text.slice(0, 2000);
  if (t.trim().length < 3) return null;
  return triage(t, categorySlug);
}

export type { RequestPayload } from "@/server/modules/request-submit";

/** Sin sesión: guarda el borrador (sin fotos) y manda a registrarse. Con sesión: crea la solicitud. */
export async function submitRequestAction(_: ActionState, f: FormData): Promise<ActionState> {
  let target = "";
  const r = await act(async () => {
    const payload = requestPayloadSchema.parse(JSON.parse(str(f, "payload") || "{}"));
    const actor = await getActor();
    if (!actor) {
      const jar = await cookies();
      const token = await saveAnonymousDraft(jar.get(DRAFT_COOKIE)?.value ?? null, payload);
      jar.set(DRAFT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400 });
      target = "/registro?next=" + encodeURIComponent("/solicitar?borrador=1");
      return;
    }
    const id = await submitRequestPayload(actor, payload, await files(f, "photos"));
    // Fotos que mandó por WhatsApp antes de vincular su cuenta con el link (reservadas para esta cuenta).
    await attachWhatsAppPhotos(id, { claimedBy: actor.id }).catch(() => null);
    (await cookies()).delete(DRAFT_COOKIE);
    target = `/app/solicitudes/${id}?nueva=1`;
  });
  if (r.error) return r;
  redirect(target);
}

/** Profesionales elegibles para la categoría y zona (datos públicos). Funciona sin cuenta. */
export async function bookableProvidersAction(categorySlug: string, zoneId: string, windows: string[]) {
  const h = await headers();
  await rateLimit(`bookable:${h.get("x-forwarded-for") ?? "local"}`, 60, 600).catch(() => null);
  if (!/^[0-9a-f-]{36}$/.test(zoneId)) return [];
  const [cat] = await sql()<{ id: string }[]>`select id from categories where slug = ${categorySlug} and active and not requires_review`;
  if (!cat) return [];
  const { listBookableProviders } = await import("@/server/modules/booking");
  const list = await listBookableProviders(sql(), { categoryId: cat.id, zoneId, preferredWindows: windows.filter((w) => ["morning", "afternoon", "evening", "weekend"].includes(w)) });
  return list.map((p) => ({
    slug: p.slug, displayName: p.displayName, kind: p.kind, isDemo: p.isDemo, description: p.description, yearsExperience: p.yearsExperience,
    rating: p.rating, reviews: p.reviews, completedJobs: p.completedJobs, identityVerified: p.identityVerified, credentials: p.credentials,
    visitFeeMinor: p.visitFeeMinor, visitFeeCredited: p.visitFeeCredited, priceRefs: p.priceRefs, availabilityMatch: p.availabilityMatch, sameZone: p.sameZone,
  }));
}
