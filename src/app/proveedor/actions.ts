"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { act, bool, files, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import type { Actor } from "@/server/auth/actor";
import { forbidden, invalid } from "@/server/domain/errors";
import { parseArsToMinor } from "@/server/domain/money";
import { declineInvitation } from "@/server/modules/requests";
import { acceptBooking, createQuote, quoteSchema, withdrawQuote } from "@/server/modules/quotes";
import {
  addEvidence, assignTechnician, cancelJob, confirmJob, decideReschedule, finishJob, markOnTheWay, proposeExtra, proposeReschedule,
  startJob, withdrawExtra,
} from "@/server/modules/jobs";
import { replyDispute, replyReview } from "@/server/modules/disputes";
import { openReviewDispute } from "@/server/modules/review-disputes";
import { addPriceRef, addProviderMember, deactivateProviderMember, removePriceRef, updateVisitSettings } from "@/server/modules/providers";
import { requestWithdrawal, saveBankAccount } from "@/server/modules/withdrawals";
import { formatMoney } from "@/lib/format";

function adminProviderId(actor: Actor): string {
  const m = actor.providers.find((p) => p.role === "admin");
  if (!m) throw forbidden();
  return m.id;
}

function money(v: string, label: string, allowEmpty = false): number {
  if (allowEmpty && !v.trim()) return 0;
  const n = parseArsToMinor(v);
  if (n == null) throw invalid(`Revisá el importe de ${label} (por ejemplo: 12.500 o 12.500,50).`);
  return n;
}

const jobPath = (id: string) => `/proveedor/trabajos/${id}`;

// ───────────────────────── Oportunidades ─────────────────────────

type QuoteItemPayload = { kind: string; description: string; quantity: string | number; unitPrice: string };

export async function createQuoteAction(_: ActionState, f: FormData): Promise<ActionState> {
  const invitationId = str(f, "invitationId");
  const r = await act(async () => {
    const actor = await requireActor();
    let raw: QuoteItemPayload[] = [];
    try {
      raw = JSON.parse(str(f, "items") || "[]");
    } catch {
      return { error: "No pudimos leer los conceptos del presupuesto." };
    }
    const items = raw.map((i, idx) => ({
      kind: i.kind,
      description: String(i.description ?? ""),
      quantity: Number(i.quantity),
      unitPriceMinor: money(String(i.unitPrice ?? ""), `el concepto ${idx + 1}`),
    }));
    const parsed = quoteSchema.safeParse({
      invitationId,
      mode: str(f, "mode"),
      scope: str(f, "scope"),
      exclusions: str(f, "exclusions"),
      materialsIncluded: str(f, "materialsIncluded") === "yes",
      proposedDate: str(f, "proposedDate"),
      proposedWindow: str(f, "proposedWindow"),
      validDays: str(f, "validDays") || "7",
      items,
    });
    if (!parsed.success) {
      return { error: [...new Set(parsed.error.issues.map((i) => i.message))].slice(0, 3).join(" ") };
    }
    await createQuote(actor, parsed.data);
    revalidatePath("/proveedor", "layout");
    return { ok: true };
  });
  if (r.ok) redirect(`/proveedor/oportunidades/${invitationId}?enviado=1`);
  return r;
}

export async function declineInvitationAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await declineInvitation(actor, str(f, "invitationId"), str(f, "reason"));
    revalidatePath("/proveedor", "layout");
    return { ok: true, message: "Registramos que no tomás esta oportunidad." };
  });
}

export async function withdrawQuoteAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await withdrawQuote(actor, str(f, "quoteId"), str(f, "reason"));
    revalidatePath("/proveedor", "layout");
    return { ok: true, message: "Retiraste el presupuesto." };
  });
}

// ───────────────────────── Trabajos ─────────────────────────

export async function confirmJobAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const id = str(f, "jobId");
    await confirmJob(actor, id);
    revalidatePath(jobPath(id));
    revalidatePath("/proveedor");
    return { ok: true, message: "Confirmaste el trabajo. Ya podés ver la dirección y los datos de acceso." };
  });
}

export async function assignTechnicianAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const id = str(f, "jobId");
    await assignTechnician(actor, id, str(f, "userId") || null);
    revalidatePath(jobPath(id));
    return { ok: true, message: "Actualizamos la asignación." };
  });
}

export async function jobStepAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const id = str(f, "jobId");
    const step = str(f, "step");
    if (step === "on_the_way") await markOnTheWay(actor, id);
    else if (step === "start") await startJob(actor, id, str(f, "visitCode"));
    else if (step === "finish") await finishJob(actor, id, str(f, "note") || str(f, "reason"));
    else return { error: "Acción desconocida." };
    revalidatePath(jobPath(id));
    revalidatePath("/proveedor/agenda");
    return { ok: true };
  });
}

export async function addEvidenceAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const id = str(f, "jobId");
    const [file] = await files(f, "photo");
    const kind = str(f, "kind") as "before" | "progress" | "after" | "note";
    if (!["before", "progress", "after", "note"].includes(kind)) return { error: "Elegí el tipo de avance." };
    await addEvidence(actor, id, { kind, note: str(f, "note") }, file);
    revalidatePath(jobPath(id));
    return { ok: true, message: "Registramos el avance. El cliente lo puede ver." };
  });
}

export async function proposeExtraAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const id = str(f, "jobId");
    await proposeExtra(actor, id, {
      description: str(f, "description"),
      reason: str(f, "reason"),
      laborMinor: money(str(f, "labor"), "mano de obra", true),
      materialsMinor: money(str(f, "materials"), "materiales", true),
      isMainQuote: str(f, "isMainQuote") === "1",
    });
    revalidatePath(jobPath(id));
    return { ok: true, message: str(f, "isMainQuote") === "1" ? "Enviamos el presupuesto al cliente para que lo apruebe en la app." : "Enviamos el adicional al cliente. No se cobra hasta que lo acepte." };
  });
}

export async function withdrawExtraAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await withdrawExtra(actor, str(f, "extraId"));
    revalidatePath(jobPath(str(f, "jobId")));
    return { ok: true, message: "Retiraste el adicional." };
  });
}

export async function proposeRescheduleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const id = str(f, "jobId");
    await proposeReschedule(actor, id, { newDate: str(f, "newDate"), newWindow: str(f, "newWindow"), reason: str(f, "reason") });
    revalidatePath(jobPath(id));
    return { ok: true, message: "Enviamos la propuesta. La fecha cambia cuando el cliente la acepte." };
  });
}

export async function decideRescheduleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const decision = str(f, "decision");
    if (decision !== "accepted" && decision !== "rejected" && decision !== "withdrawn") return { error: "Decisión inválida." };
    await decideReschedule(actor, str(f, "rescheduleId"), decision);
    revalidatePath(jobPath(str(f, "jobId")));
    revalidatePath("/proveedor/agenda");
    return { ok: true };
  });
}

export async function cancelJobAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const id = str(f, "jobId");
    await cancelJob(actor, id, str(f, "reason"));
    revalidatePath(jobPath(id));
    revalidatePath("/proveedor", "layout");
    return { ok: true, message: "Cancelaste el trabajo. Si el cliente había pagado, se le reintegra el total." };
  });
}

// ───────────────────────── Reclamos y reseñas ─────────────────────────

export async function replyDisputeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const id = str(f, "disputeId");
    const [file] = await files(f, "file");
    await replyDispute(actor, id, str(f, "body"), {}, file);
    revalidatePath(`/proveedor/reclamos/${id}`);
    return { ok: true, message: "Enviamos tu respuesta." };
  });
}

export async function replyReviewAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const reply = str(f, "reply");
    if (reply.trim().length < 2) return { error: "Escribí tu respuesta." };
    await replyReview(actor, str(f, "reviewId"), reply);
    revalidatePath("/proveedor/resenas");
    return { ok: true, message: "Publicamos tu respuesta." };
  });
}

export async function openReviewDisputeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await openReviewDispute(actor, str(f, "reviewId"), { reasonCode: str(f, "reasonCode") as never, statement: str(f, "statement") });
    revalidatePath("/proveedor/resenas");
    return { ok: true, message: "Recibimos tu impugnación. Vamos a consultar al cliente y te avisamos el resultado." };
  });
}

// ───────────────────────── Equipo ─────────────────────────

export async function addMemberAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const role = str(f, "role") === "admin" ? "admin" : "technician";
    const email = str(f, "email");
    if (!email.includes("@")) return { error: "Ingresá un email válido." };
    await addProviderMember(actor, adminProviderId(actor), email, role);
    revalidatePath("/proveedor/equipo");
    return { ok: true, message: "Sumamos a la persona a tu equipo." };
  });
}

export async function deactivateMemberAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await deactivateProviderMember(actor, adminProviderId(actor), str(f, "userId"));
    revalidatePath("/proveedor/equipo");
    return { ok: true, message: "Desactivamos a la persona. Sus trabajos abiertos quedaron sin asignar." };
  });
}

export async function acceptBookingAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await acceptBooking(actor, str(f, "invitationId"), { proposedDate: str(f, "proposedDate"), proposedWindow: str(f, "proposedWindow"), note: str(f, "note"), accessAcknowledged: bool(f, "accessAcknowledged") });
    revalidatePath(`/proveedor/oportunidades/${str(f, "invitationId")}`);
    return { ok: true, message: "Aceptaste el pedido. Le avisamos al cliente para que confirme la visita." };
  });
}

export async function updateVisitSettingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const fee = parseArsToMinor(str(f, "visitFee") || "0");
    if (fee === null) return { error: "Revisá el precio de la visita.", fieldErrors: { visitFee: ["Usá un formato como 15.000 o 15000,50."] } };
    await updateVisitSettings(actor, adminProviderId(actor), { visitFeeMinor: fee, visitFeeCredited: f.get("visitFeeCredited") === "on" });
    revalidatePath("/proveedor/perfil");
    return { ok: true, message: fee === 0 ? "Listo: tu visita es sin cargo." : "Guardamos el precio de tu visita." };
  });
}

export async function addPriceRefAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const from = parseArsToMinor(str(f, "from"));
    if (!from) return { error: "Indicá un precio válido.", fieldErrors: { from: ["Usá un formato como 45.000."] } };
    await addPriceRef(actor, adminProviderId(actor), { categoryId: str(f, "categoryId"), title: str(f, "title"), fromMinor: from, note: str(f, "note") });
    revalidatePath("/proveedor/perfil");
    return { ok: true, message: "Precio agregado." };
  });
}

export async function removePriceRefAction(f: FormData) {
  const actor = await requireActor();
  await removePriceRef(actor, adminProviderId(actor), str(f, "id"));
  revalidatePath("/proveedor/perfil");
}

// ───────── Saldo y retiros ─────────

function bankInput(f: FormData) {
  return { holderName: str(f, "holderName"), holderTaxId: str(f, "holderTaxId"), cbu: str(f, "cbu"), alias: str(f, "alias"), bankName: str(f, "bankName") };
}

export async function saveBankAccountAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    await saveBankAccount(actor, adminProviderId(actor), bankInput(f));
    revalidatePath("/proveedor/cobros");
    return { ok: true, message: "Guardamos tus datos bancarios." };
  });
}

export async function requestWithdrawalAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireActor();
    const r = await requestWithdrawal(actor, adminProviderId(actor), bool(f, "withBank") ? bankInput(f) : null);
    revalidatePath("/proveedor/cobros");
    revalidatePath("/proveedor");
    const when = new Date(`${r.scheduledFor}T12:00:00-03:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long" });
    return { ok: true, message: `Listo: te transferimos ${formatMoney(r.amountMinor)} el ${when}.` };
  });
}
