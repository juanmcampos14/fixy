"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { act, files, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { getActor } from "@/server/auth/session";
import { triage } from "@/server/assistant";
import { rateLimit } from "@/server/rate-limit";
import { createProperty, propertySchema } from "@/server/modules/properties";
import { createRequest, DRAFT_COOKIE, saveAnonymousDraft } from "@/server/modules/requests";
import { sql } from "@/server/db/client";
import { headers } from "next/headers";

export async function triageAction(text: string, categorySlug: string | null) {
  const h = await headers();
  await rateLimit(`triage:${h.get("x-forwarded-for") ?? "local"}`, 60, 600).catch(() => null);
  const t = text.slice(0, 2000);
  if (t.trim().length < 3) return null;
  return triage(t, categorySlug);
}

const payloadSchema = z.object({
  description: z.string(),
  title: z.string(),
  categorySlug: z.string().nullable(),
  serviceId: z.string().nullable().optional(),
  answers: z.record(z.string(), z.union([z.string(), z.boolean()])),
  urgency: z.enum(["flexible", "normal", "soon", "urgent"]),
  windows: z.array(z.enum(["morning", "afternoon", "evening", "weekend"])),
  propertyId: z.string().nullable(),
  newProperty: z.record(z.string(), z.string()).nullable(),
  organizationId: z.string().nullable().optional(),
  responsibleUserId: z.string().nullable().optional(),
  accessInfo: z.string().optional(),
  targetProviderSlug: z.string().nullable().optional(),
  previousJobId: z.string().nullable().optional(),
});
export type RequestPayload = z.infer<typeof payloadSchema>;

/** Sin sesión: guarda el borrador (sin fotos) y manda a registrarse. Con sesión: crea la solicitud. */
export async function submitRequestAction(_: ActionState, f: FormData): Promise<ActionState> {
  let target = "";
  const r = await act(async () => {
    const payload = payloadSchema.parse(JSON.parse(str(f, "payload") || "{}"));
    const actor = await getActor();
    if (!actor) {
      const jar = await cookies();
      const token = await saveAnonymousDraft(jar.get(DRAFT_COOKIE)?.value ?? null, payload);
      jar.set(DRAFT_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 7 * 86400 });
      target = "/registro?next=" + encodeURIComponent("/solicitar?borrador=1");
      return;
    }
    let propertyId = payload.propertyId;
    if (!propertyId) {
      if (!payload.newProperty) return { error: "Indicá dónde es el trabajo.", fieldErrors: { property: ["Indicá dónde es el trabajo."] } };
      propertyId = await createProperty(actor, propertySchema.parse(payload.newProperty), payload.organizationId ?? null);
    }
    const [cat] = payload.categorySlug ? await sql()<{ id: string }[]>`select id from categories where slug = ${payload.categorySlug}` : [];
    const [prov] = payload.targetProviderSlug ? await sql()<{ id: string }[]>`select id from providers where slug = ${payload.targetProviderSlug} and status = 'approved'` : [];
    const id = await createRequest(
      actor,
      {
        propertyId,
        categoryId: cat?.id ?? null,
        serviceId: payload.serviceId ?? null,
        title: payload.title,
        description: payload.description,
        answers: payload.answers,
        urgency: payload.urgency,
        preferredWindows: payload.windows,
        accessInfo: payload.accessInfo ?? "",
        targetProviderId: prov?.id ?? null,
        previousJobId: payload.previousJobId ?? null,
        responsibleUserId: payload.responsibleUserId ?? null,
      },
      await files(f, "photos"),
    );
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
