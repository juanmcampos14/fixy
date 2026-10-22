"use server";

import { SOCIAL_NETWORKS } from "@/lib/social";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { ZodType } from "zod";
import { act, bool, files, str, strs } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";
import { forbidden } from "@/server/domain/errors";
import {
  acceptProviderTerms, addPortfolioItems, updateSocialLinks, coverageSchema, createProvider, documentSchema, providerProfileSchema, removePortfolioItem,
  setupPayouts, submitForReview, updateCoverage, updateProviderProfile, uploadProviderDocument, quickStartProvider, quickStartSchema, setProviderAvatar, removeProviderAvatar,
} from "@/server/modules/providers";
import { AVAILABILITY_PRESETS, draftProviderProfile, type AvailabilityPreset } from "@/server/assistant/provider-profile";
import { rateLimit } from "@/server/rate-limit";
import { sql } from "@/server/db/client";

/** El proveedor sobre el que se actúa sale siempre de la sesión (nunca del formulario). */
function adminProviderId(actor: Actor): string {
  const m = actor.providers.find((p) => p.role === "admin");
  if (!m) throw forbidden("Solo quien administra el perfil puede hacer este cambio.");
  return m.id;
}

/** Valida con Zod y devuelve los mensajes concretos (en vez de un "revisá los datos" genérico). */
function validate<T>(schema: ZodType<T>, input: unknown): { data: T } | { state: ActionState } {
  const r = schema.safeParse(input);
  if (r.success) return { data: r.data };
  const fieldErrors: Record<string, string[]> = {};
  for (const i of r.error.issues) (fieldErrors[String(i.path[0] ?? "_")] ??= []).push(i.message);
  const first = [...new Set(r.error.issues.map((i) => i.message))].slice(0, 3).join(" ");
  return { state: { error: first || "Revisá los datos marcados.", fieldErrors } };
}

function revalidateProvider() {
  revalidatePath("/proveedor", "layout");
}

function profileInput(f: FormData) {
  return {
    kind: str(f, "kind"),
    displayName: str(f, "displayName"),
    legalName: str(f, "legalName"),
    taxId: str(f, "taxId"),
    responsibleName: str(f, "responsibleName"),
    contactEmail: str(f, "contactEmail"),
    contactPhone: str(f, "contactPhone"),
    description: str(f, "description"),
    yearsExperience: str(f, "yearsExperience") === "" ? undefined : str(f, "yearsExperience"),
    billingInfo: str(f, "billingInfo"),
  };
}

export async function createProviderAction(_: ActionState, f: FormData): Promise<ActionState> {
  const r = await act(async () => {
    const actor = await requireActor("/proveedor/alta");
    const v = validate(providerProfileSchema, profileInput(f));
    if ("state" in v) return v.state;
    // Origen de campaña / referido guardado por /sumate/registrarme.
    let origin: { source?: string; referrerSlug?: string } = {};
    try {
      const c = JSON.parse((await cookies()).get("fixy_signup")?.value ?? "{}");
      origin = { source: typeof c.origen === "string" ? c.origen : undefined, referrerSlug: typeof c.ref === "string" && c.ref ? c.ref : undefined };
    } catch {}
    await createProvider(actor, v.data, origin);
    (await cookies()).delete("fixy_signup");
    revalidateProvider();
    return { ok: true };
  });
  if (r.ok) redirect("/proveedor/alta");
  return r;
}

export async function updateProfileAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const v = validate(providerProfileSchema, profileInput(f));
    if ("state" in v) return v.state;
    await updateProviderProfile(actor, adminProviderId(actor), v.data);
    revalidateProvider();
    return { ok: true, message: "Guardamos los datos del perfil." };
  });
}

export async function updateCoverageAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const availability: { weekday: number; startMinute: number; endMinute: number }[] = [];
    for (let d = 0; d < 7; d++) {
      if (!bool(f, `day_${d}`)) continue;
      availability.push({ weekday: d, startMinute: Number(str(f, `start_${d}`)) * 60, endMinute: Number(str(f, `end_${d}`)) * 60 });
    }
    const v = validate(coverageSchema, {
      categoryIds: strs(f, "categoryIds"),
      primaryCategoryId: str(f, "primaryCategoryId"),
      otherTrade: str(f, "otherTrade"),
      zoneIds: strs(f, "zoneIds"),
      baseZoneId: str(f, "baseZoneId"),
      acceptingJobs: bool(f, "acceptingJobs"),
      maxActiveJobs: str(f, "maxActiveJobs") || "5",
      availability,
    });
    if ("state" in v) return v.state;
    await updateCoverage(actor, adminProviderId(actor), v.data);
    revalidateProvider();
    return { ok: true, message: "Guardamos servicios, zonas y disponibilidad." };
  });
}

export async function addPortfolioAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const list = (await files(f, "photos")).concat(await files(f, "photo"));
    if (!list.length) return { error: "Elegí al menos una foto o un PDF." };
    await addPortfolioItems(actor, adminProviderId(actor), list, str(f, "caption"));
    revalidateProvider();
    return { ok: true, message: list.length === 1 ? "Lo sumamos a tu portfolio." : `Sumamos ${list.length} archivos a tu portfolio.` };
  });
}

export async function updateSocialLinksAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const input = Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n.key, str(f, n.key)]));
    await updateSocialLinks(actor, adminProviderId(actor), input);
    revalidateProvider();
    return { ok: true, message: "Guardamos tus redes." };
  });
}

export async function removePortfolioAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await removePortfolioItem(actor, adminProviderId(actor), str(f, "itemId"));
    revalidateProvider();
    return { ok: true };
  });
}

export async function uploadDocumentAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const [file] = await files(f, "file");
    if (!file) return { error: "Elegí el archivo (JPG, PNG, WEBP o PDF, hasta 8 MB)." };
    const v = validate(documentSchema, { kind: str(f, "kind"), credentialTypeId: str(f, "credentialTypeId"), expiresOn: str(f, "expiresOn") });
    if ("state" in v) return v.state;
    await uploadProviderDocument(actor, adminProviderId(actor), v.data, file);
    revalidateProvider();
    return { ok: true, message: "Recibimos el documento. Queda en revisión del equipo de Fixy." };
  });
}

export async function setupPayoutsAction(): Promise<ActionState> {
  let target: string | null = null;
  const r = await act(async () => {
    const actor = await requireActor();
    const { onboardingUrl } = await setupPayouts(actor, adminProviderId(actor));
    target = onboardingUrl;
    revalidateProvider();
    return { ok: true, message: "Configuramos la recepción de cobros." };
  });
  if (r.ok && target) redirect(target);
  return r;
}

export async function acceptTermsAction(): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    adminProviderId(actor);
    await acceptProviderTerms(actor);
    revalidateProvider();
    return { ok: true, message: "Registramos tu aceptación." };
  });
}

export async function submitForReviewAction(): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await submitForReview(actor, adminProviderId(actor));
    revalidateProvider();
    return { ok: true, message: "Enviamos tu perfil a revisión. Te avisamos cuando haya novedades." };
  });
}

// ───────── Alta rápida ─────────

export type QuickDraft = {
  displayName: string; description: string; yearsExperience: string; categoryIds: string[]; zoneIds: string[]; baseZoneId: string;
  availability: AvailabilityPreset | ""; priceRefs: { categoryId: string; title: string; fromPesos: string }[]; tips: string[];
};

/** Borrador con IA a partir del texto libre. Devuelve ids del catálogo; nunca guarda nada. */
export async function draftProfileWithAi(input: { kind: "individual" | "company"; name: string; text: string }): Promise<{ draft?: QuickDraft; error?: string }> {
  const actor = await requireActor("/proveedor/alta");
  if (input.text.trim().length < 20) return { error: "Contanos un poco más (al menos una oración) para que la IA pueda ayudarte." };
  try {
    await rateLimit(`profile-ai:${actor.id}`, 8, 3600);
  } catch {
    return { error: "Usaste el asistente muchas veces seguidas. Probá en un rato o completalo a mano." };
  }
  const cats = await sql()<{ id: string; slug: string; name: string }[]>`select id, slug, name from categories where active order by sort, name`;
  const zones = await sql()<{ id: string; code: string; name: string; region: string }[]>`select id, code, name, region from zones where active order by sort, name`;
  const d = await draftProviderProfile(input.text, { kind: input.kind, name: input.name, categories: cats, zones });
  if (!d) return { error: "El asistente no está disponible ahora. Completá los datos a mano: es rápido." };
  const catId = (slug: string) => cats.find((c) => c.slug === slug)?.id;
  const zoneId = (code: string | null) => zones.find((z) => z.code === code)?.id;
  return {
    draft: {
      displayName: input.name.trim() || d.displayName,
      description: d.description,
      yearsExperience: d.yearsExperience?.toString() ?? "",
      categoryIds: d.categorySlugs.map(catId).filter((x): x is string => !!x),
      zoneIds: d.zoneCodes.map(zoneId).filter((x): x is string => !!x),
      baseZoneId: zoneId(d.baseZoneCode) ?? "",
      availability: d.availability ?? "",
      priceRefs: d.priceRefs.map((p) => ({ categoryId: catId(p.categorySlug) ?? "", title: p.title, fromPesos: String(p.fromPesos) })).filter((p) => p.categoryId),
      tips: d.tips,
    },
  };
}

export async function quickStartAction(payload: {
  kind: "individual" | "company"; displayName: string; contactPhone: string; description: string; yearsExperience: string;
  categoryIds: string[]; primaryCategoryId?: string; otherTrade?: string; zoneIds: string[]; baseZoneId: string; availability: AvailabilityPreset | "";
  priceRefs: { categoryId: string; title: string; fromPesos: string }[]; aiAssisted: boolean;
}): Promise<ActionState> {
  const r = await act(async () => {
    const actor = await requireActor("/proveedor/alta");
    const preset = payload.availability ? AVAILABILITY_PRESETS[payload.availability] : null;
    const v = validate(quickStartSchema, {
      kind: payload.kind, displayName: payload.displayName, contactPhone: payload.contactPhone, description: payload.description,
      yearsExperience: payload.yearsExperience === "" ? undefined : payload.yearsExperience,
      categoryIds: payload.categoryIds, primaryCategoryId: payload.primaryCategoryId ?? "", otherTrade: payload.otherTrade ?? "", zoneIds: payload.zoneIds, baseZoneId: payload.baseZoneId,
      availability: preset ? preset.days.map((weekday) => ({ weekday, startMinute: preset.start, endMinute: preset.end })) : [],
      priceRefs: payload.priceRefs.filter((p) => p.categoryId && p.title.trim() && Number(p.fromPesos) > 0)
        .map((p) => ({ categoryId: p.categoryId, title: p.title, fromMinor: Math.round(Number(p.fromPesos) * 100) })),
      aiAssisted: payload.aiAssisted,
    });
    if ("state" in v) return v.state;
    let origin: { source?: string; referrerSlug?: string } = {};
    try {
      const c = JSON.parse((await cookies()).get("fixy_signup")?.value ?? "{}");
      origin = { source: typeof c.origen === "string" ? c.origen : undefined, referrerSlug: typeof c.ref === "string" && c.ref ? c.ref : undefined };
    } catch {}
    await quickStartProvider(actor, v.data, origin);
    (await cookies()).delete("fixy_signup");
    revalidateProvider();
    return { ok: true };
  });
  if (r.ok) redirect("/proveedor/alta?bienvenida=1");
  return r;
}

export async function setAvatarAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const [file] = await files(f, "avatar");
    if (!file) return { error: "Elegí una foto (JPG, PNG o WEBP)." };
    await setProviderAvatar(actor, adminProviderId(actor), file);
    revalidateProvider();
    return { ok: true, message: "¡Listo! Tu foto ya se ve en tu perfil." };
  });
}

export async function removeAvatarAction(): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await removeProviderAvatar(actor, adminProviderId(actor));
    revalidateProvider();
    return { ok: true, message: "Quitamos la foto." };
  });
}
