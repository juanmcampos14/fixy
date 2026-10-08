"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { act, bool, files, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import * as quotes from "@/server/modules/quotes";
import * as requests from "@/server/modules/requests";
import * as jobs from "@/server/modules/jobs";
import * as disputes from "@/server/modules/disputes";
import * as props from "@/server/modules/properties";

export async function acceptQuoteAction(_: ActionState, f: FormData): Promise<ActionState> {
  let target = "";
  const r = await act(async () => {
    const actor = await requireActor();
    const res = await quotes.acceptQuote(actor, str(f, "quoteId"), { totalMinor: Number(str(f, "totalMinor")), acceptedTerms: bool(f, "acceptTerms") });
    target = res.checkoutUrl ?? `/app/trabajos/${res.jobId}`;
  });
  if (r.error) return r;
  redirect(target);
}

export async function rejectQuoteAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await quotes.rejectQuote(actor, str(f, "quoteId"), str(f, "reason"));
    revalidatePath(`/app/solicitudes/${str(f, "requestId")}`);
    return { ok: true };
  });
}

export async function cancelRequestAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await requests.cancelRequest(actor, str(f, "requestId"), str(f, "reason"));
    revalidatePath(`/app/solicitudes/${str(f, "requestId")}`);
    return { ok: true };
  });
}

const jobPath = (f: FormData) => `/app/trabajos/${str(f, "jobId")}`;

export async function approveJobAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await jobs.approveJob(await requireActor(), str(f, "jobId"));
    revalidatePath(jobPath(f));
    return { ok: true };
  });
}

export async function cancelJobAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await jobs.cancelJob(await requireActor(), str(f, "jobId"), str(f, "reason"));
    revalidatePath(jobPath(f));
    return { ok: true };
  });
}

export async function decideExtraAction(_: ActionState, f: FormData): Promise<ActionState> {
  let target = "";
  const r = await act(async () => {
    const decision = str(f, "decision") === "accepted" ? "accepted" : "rejected";
    const res = await jobs.decideExtra(await requireActor(), str(f, "extraId"), decision, str(f, "reason"), Number(str(f, "totalMinor")));
    revalidatePath(jobPath(f));
    if (res.checkoutUrl) target = res.checkoutUrl;
  });
  if (r.error) return r;
  if (target) redirect(target);
  return { ok: true };
}

export async function proposeRescheduleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await jobs.proposeReschedule(await requireActor(), str(f, "jobId"), { newDate: str(f, "newDate"), newWindow: str(f, "newWindow"), reason: str(f, "reason") });
    revalidatePath(jobPath(f));
    return { ok: true, message: "Enviamos tu propuesta. La fecha cambia solo si la otra parte la acepta." };
  });
}

export async function decideRescheduleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const d = str(f, "decision") as "accepted" | "rejected" | "withdrawn";
    await jobs.decideReschedule(await requireActor(), str(f, "rescheduleId"), d);
    revalidatePath(jobPath(f));
    return { ok: true };
  });
}

export async function openDisputeAction(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  const r = await act(async () => {
    const [file] = await files(f, "file");
    id = await disputes.openDispute(await requireActor(), str(f, "jobId"), { reasonCode: str(f, "reasonCode") as never, description: str(f, "description") }, file);
  });
  if (r.error) return r;
  redirect(`/app/reclamos/${id}`);
}

export async function replyDisputeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const [file] = await files(f, "file");
    await disputes.replyDispute(await requireActor(), str(f, "disputeId"), str(f, "body"), {}, file);
    revalidatePath(`/app/reclamos/${str(f, "disputeId")}`);
    return { ok: true };
  });
}

export async function createReviewAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await disputes.createReview(await requireActor(), str(f, "jobId"), { rating: Number(str(f, "rating")), comment: str(f, "comment") });
    revalidatePath(jobPath(f));
    return { ok: true, message: "¡Gracias! Tu reseña ayuda a otras personas a elegir." };
  });
}

function propertyInput(f: FormData) {
  return {
    kind: str(f, "kind") as "home", label: str(f, "label"), addressLine: str(f, "addressLine"), addressExtra: str(f, "addressExtra"),
    zoneId: str(f, "zoneId"), contactName: str(f, "contactName"), contactPhone: str(f, "contactPhone"), accessNotes: str(f, "accessNotes"),
  };
}

export async function createPropertyAction(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  const r = await act(async () => {
    id = await props.createProperty(await requireActor(), props.propertySchema.parse(propertyInput(f)), str(f, "organizationId") || null);
  });
  if (r.error) return r;
  redirect(str(f, "organizationId") ? `/app/organizaciones/${str(f, "organizationId")}` : `/app/propiedades/${id}`);
}

export async function updatePropertyAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await props.updateProperty(await requireActor(), str(f, "propertyId"), props.propertySchema.parse(propertyInput(f)));
    revalidatePath(`/app/propiedades/${str(f, "propertyId")}`);
    return { ok: true, message: "Guardamos los cambios." };
  });
}

function orgInput(f: FormData) {
  return { name: str(f, "name"), taxId: str(f, "taxId"), billingEmail: str(f, "billingEmail"), billingAddress: str(f, "billingAddress"), contactPhone: str(f, "contactPhone") };
}

export async function createOrganizationAction(_: ActionState, f: FormData): Promise<ActionState> {
  let id = "";
  const r = await act(async () => {
    id = await props.createOrganization(await requireActor(), props.organizationSchema.parse(orgInput(f)));
  });
  if (r.error) return r;
  redirect(`/app/organizaciones/${id}`);
}

export async function updateOrganizationAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await props.updateOrganization(await requireActor(), str(f, "organizationId"), props.organizationSchema.parse(orgInput(f)));
    revalidatePath(`/app/organizaciones/${str(f, "organizationId")}`);
    return { ok: true, message: "Datos actualizados." };
  });
}

export async function addMemberAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await props.addOrganizationMember(await requireActor(), str(f, "organizationId"), str(f, "email"), str(f, "role") === "admin" ? "admin" : "member");
    revalidatePath(`/app/organizaciones/${str(f, "organizationId")}`);
    return { ok: true, message: "Miembro agregado." };
  });
}

export async function removeMemberAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await props.removeOrganizationMember(await requireActor(), str(f, "organizationId"), str(f, "userId"));
    revalidatePath(`/app/organizaciones/${str(f, "organizationId")}`);
    return { ok: true };
  });
}
