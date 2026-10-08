"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodType } from "zod";
import { act, bool, files, str, strs } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";
import { forbidden } from "@/server/domain/errors";
import {
  acceptProviderTerms, addPortfolioItem, coverageSchema, createProvider, documentSchema, providerProfileSchema, removePortfolioItem,
  setupPayouts, submitForReview, updateCoverage, updateProviderProfile, uploadProviderDocument,
} from "@/server/modules/providers";

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
    await createProvider(actor, v.data);
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
    const [file] = await files(f, "photo");
    if (!file) return { error: "Elegí una foto (JPG, PNG o WEBP)." };
    await addPortfolioItem(actor, adminProviderId(actor), file, str(f, "caption"));
    revalidateProvider();
    return { ok: true, message: "Sumamos la foto a tu portfolio." };
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
