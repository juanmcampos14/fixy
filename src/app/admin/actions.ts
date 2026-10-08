"use server";

import { revalidatePath } from "next/cache";
import { act, bool, files, str, strs } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requirePlatformAdmin, requireStaff } from "@/server/auth/session";
import { invalid } from "@/server/domain/errors";
import { parseArsToMinor } from "@/server/domain/money";
import type { JobStatus } from "@/server/domain/state-machines";
import { reviewDocument, reviewProvider, type ReviewAction } from "@/server/modules/providers";
import { cancelRequest, operatorInvite, operatorRunMatching, operatorSetCategory } from "@/server/modules/requests";
import { cancelJob, operatorMoveJob } from "@/server/modules/jobs";
import { executePayout, postManualAdjustment, refundCharge, releasePayoutWithoutReview, resyncCharge, setPayoutHold } from "@/server/modules/payments";
import { moveDispute, replyDispute, resolveDispute } from "@/server/modules/disputes";
import * as admin from "@/server/modules/admin";
import { sql } from "@/server/db/client";

const refresh = () => revalidatePath("/admin", "layout");

function money(f: FormData, key: string, label = "el importe"): number {
  const v = parseArsToMinor(str(f, key));
  if (v == null || v <= 0) throw invalid(`Revisá ${label}: usá el formato 12.500,50.`);
  return v;
}

function optionalMoney(f: FormData, key: string): number | null {
  if (!str(f, key).trim()) return null;
  const v = parseArsToMinor(str(f, key));
  if (v == null || v <= 0) throw invalid("Revisá el importe: usá el formato 12.500,50.");
  return v;
}

// ───────────────────────── Proveedores ─────────────────────────

const REVIEW_ACTIONS: ReviewAction[] = ["approve", "observe", "reject", "suspend", "reinstate"];
const REVIEW_MESSAGES: Record<ReviewAction, string> = {
  approve: "Proveedor aprobado.",
  observe: "Enviamos la observación: el perfil vuelve a pendiente.",
  reject: "Alta rechazada.",
  suspend: "Proveedor suspendido.",
  reinstate: "Proveedor rehabilitado.",
};

export async function reviewProviderAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    const op = str(f, "op") as ReviewAction;
    if (!REVIEW_ACTIONS.includes(op)) throw invalid("Acción inválida.");
    await reviewProvider(actor, str(f, "providerId"), op, str(f, "reason"));
    refresh();
    return { ok: true, message: REVIEW_MESSAGES[op] };
  });
}

export async function reviewDocumentAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    const decision = str(f, "decision");
    if (decision !== "approved" && decision !== "rejected") throw invalid("Decisión inválida.");
    const expires = str(f, "expiresOn");
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) throw invalid("Fecha de vencimiento inválida.");
    await reviewDocument(actor, str(f, "documentId"), decision, str(f, "reason").trim(), expires || null);
    refresh();
    return { ok: true, message: decision === "approved" ? "Documento aprobado." : "Documento rechazado." };
  });
}

// ───────────────────────── Solicitudes ─────────────────────────

export async function setCategoryAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    if (!str(f, "categoryId")) throw invalid("Elegí una categoría.");
    const invited = await operatorSetCategory(actor, str(f, "requestId"), str(f, "categoryId"), str(f, "reason"));
    refresh();
    return { ok: true, message: invited ? `Categoría asignada. Invitamos a ${invited} proveedor(es).` : "Categoría asignada. No hubo proveedores elegibles para invitar." };
  });
}

export async function runMatchingAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    if (str(f, "reason").trim().length < 3) throw invalid("Indicá el motivo.");
    const invited = await operatorRunMatching(actor, str(f, "requestId"), str(f, "reason"));
    refresh();
    return { ok: true, message: invited ? `Invitamos a ${invited} proveedor(es) nuevo(s).` : "No hubo nuevos proveedores elegibles." };
  });
}

export async function inviteProviderAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    await operatorInvite(actor, str(f, "requestId"), str(f, "providerId"), str(f, "reason"));
    refresh();
    return { ok: true, message: "Invitación enviada." };
  });
}

export async function cancelRequestAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    await cancelRequest(actor, str(f, "requestId"), str(f, "reason"));
    refresh();
    return { ok: true, message: "Solicitud cancelada." };
  });
}

// ───────────────────────── Trabajos ─────────────────────────

export async function moveJobAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    await operatorMoveJob(actor, str(f, "jobId"), str(f, "to") as JobStatus, str(f, "reason"));
    refresh();
    return { ok: true, message: "Estado actualizado." };
  });
}

export async function cancelJobAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    await cancelJob(actor, str(f, "jobId"), str(f, "reason"), { refundAll: bool(f, "refundAll"), asStaff: true });
    refresh();
    return { ok: true, message: "Trabajo cancelado." };
  });
}

export async function refundChargeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    await refundCharge(actor, { chargeId: str(f, "chargeId"), amountMinor: money(f, "amount", "el importe del reembolso"), reason: str(f, "reason") });
    refresh();
    return { ok: true, message: "Reembolso registrado." };
  });
}

// ───────────────────────── Reclamos ─────────────────────────

export async function replyDisputeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    const [file] = await files(f, "file");
    const internal = bool(f, "internal");
    await replyDispute(actor, str(f, "disputeId"), str(f, "body"), { internal }, file);
    refresh();
    return { ok: true, message: internal ? "Nota interna guardada." : "Respuesta enviada a ambas partes." };
  });
}

export async function moveDisputeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    const to = str(f, "to");
    if (to !== "in_review" && to !== "awaiting_response" && to !== "closed") throw invalid("Estado inválido.");
    await moveDispute(actor, str(f, "disputeId"), to, str(f, "reason"));
    refresh();
    return { ok: true, message: "Estado del reclamo actualizado." };
  });
}

export async function resolveDisputeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    const resolution = str(f, "resolution");
    const refundMinor = resolution === "partial_refund" ? money(f, "refund", "el importe a reembolsar") : 0;
    await resolveDispute(actor, str(f, "disputeId"), {
      resolution: resolution as "no_action",
      note: str(f, "reason"),
      refundMinor,
      completeJob: bool(f, "completeJob"),
    });
    refresh();
    return { ok: true, message: "Reclamo resuelto." };
  });
}

// ───────────────────────── Finanzas ─────────────────────────

export async function executePayoutAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    const r = await executePayout(actor, str(f, "payoutId"), str(f, "reason"));
    refresh();
    return r.status === "paid"
      ? { ok: true, message: "Liquidación simulada registrada como pagada." }
      : { error: "La transferencia simulada falló. La liquidación quedó como fallida y se puede reintentar." };
  });
}

export async function payoutHoldAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    const hold = str(f, "hold") === "1";
    await setPayoutHold(actor, str(f, "payoutId"), hold, str(f, "reason"));
    refresh();
    return { ok: true, message: hold ? "Liquidación retenida." : "Liquidación liberada." };
  });
}

export async function resyncChargeAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    const r = await resyncCharge(actor, str(f, "chargeId"));
    refresh();
    const msg: Record<string, string> = {
      applied: "Cobro actualizado con el estado de la pasarela.",
      ignored_stale: "Sin cambios: el estado interno ya está al día o la pasarela informa un estado que no se aplica automáticamente.",
      rejected: `La pasarela no confirmó el pago${r.error ? `: ${r.error}` : ""}.`,
      ignored_duplicate: "Sin cambios.",
      error: "No se pudo sincronizar.",
    };
    return { ok: r.result !== "error", message: msg[r.result] ?? "Listo." };
  });
}

export async function manualAdjustmentAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    const [job] = await sql()<{ id: string; provider_id: string }[]>`select id, provider_id from jobs where id = ${str(f, "jobId")}`;
    if (!job) throw invalid("Elegí un trabajo.");
    const amount = money(f, "amount");
    const direction = str(f, "direction");
    if (direction !== "credit" && direction !== "debit") throw invalid("Elegí el sentido del ajuste.");
    // Positivo: aumenta lo adeudado al proveedor (sale de ingresos de plataforma). Negativo: lo reduce.
    await postManualAdjustment(actor, { jobId: job.id, providerId: job.provider_id, amountMinor: direction === "credit" ? amount : -amount, reason: str(f, "reason") });
    refresh();
    return { ok: true, message: "Ajuste registrado en el registro financiero." };
  });
}

// ───────────────────────── Catálogo ─────────────────────────

export async function saveCategoryAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    await admin.saveCategory(
      actor,
      {
        id: str(f, "id") || undefined,
        slug: str(f, "slug") || undefined,
        name: str(f, "name"),
        description: str(f, "description"),
        icon: str(f, "icon") || "wrench",
        sort: Number(str(f, "sort") || 0),
        active: bool(f, "active"),
        requiresReview: bool(f, "requiresReview"),
        safetyNote: str(f, "safetyNote"),
      },
      str(f, "reason"),
    );
    refresh();
    return { ok: true, message: str(f, "id") ? "Categoría actualizada." : "Categoría creada." };
  });
}

export async function saveCategoryCredentialsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    await admin.setCategoryCredentials(actor, str(f, "categoryId"), strs(f, "credentialTypeIds"), str(f, "reason"));
    refresh();
    return { ok: true, message: "Credenciales requeridas actualizadas." };
  });
}

export async function saveServiceAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    await admin.saveService(
      actor,
      {
        id: str(f, "id") || undefined,
        categoryId: str(f, "categoryId"),
        slug: str(f, "slug") || undefined,
        name: str(f, "name"),
        description: str(f, "description"),
        pricingMode: str(f, "pricingMode") as "quote",
        fixedPriceMinor: optionalMoney(f, "fixedPrice"),
        diagnosticPriceMinor: optionalMoney(f, "diagnosticPrice"),
        scope: str(f, "scope"),
        exclusions: str(f, "exclusions"),
        sort: Number(str(f, "sort") || 0),
        active: bool(f, "active"),
      },
      str(f, "reason"),
    );
    refresh();
    return { ok: true, message: str(f, "id") ? "Servicio actualizado." : "Servicio creado." };
  });
}

export async function saveQuestionAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    const options = str(f, "options")
      .split(/\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    await admin.saveQuestion(
      actor,
      {
        id: str(f, "id") || undefined,
        categoryId: str(f, "categoryId"),
        key: str(f, "key"),
        label: str(f, "label"),
        kind: str(f, "kind") as "text",
        options,
        required: bool(f, "required"),
        sort: Number(str(f, "sort") || 0),
      },
      str(f, "reason"),
    );
    refresh();
    return { ok: true, message: str(f, "id") ? "Pregunta actualizada." : "Pregunta agregada." };
  });
}

export async function deleteQuestionAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    await admin.deleteQuestion(actor, str(f, "id"), str(f, "reason"));
    refresh();
    return { ok: true, message: "Pregunta eliminada." };
  });
}

export async function createZoneAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    await admin.createZone(actor, { code: str(f, "code"), name: str(f, "name"), region: str(f, "region") as "CABA", sort: Number(str(f, "sort") || 0) }, str(f, "reason"));
    refresh();
    return { ok: true, message: "Zona agregada." };
  });
}

export async function zoneActiveAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    const active = str(f, "active") === "1";
    await admin.setZoneActive(actor, str(f, "zoneId"), active, str(f, "reason"));
    refresh();
    return { ok: true, message: active ? "Zona activada." : "Zona desactivada." };
  });
}

// ───────────────────────── Comisiones y parámetros ─────────────────────────

function pct(f: FormData, key: string, label: string): number {
  const v = admin.percentToBps(str(f, key) || "0");
  if (v == null) throw invalid(`Revisá ${label}: usá un porcentaje con hasta 2 decimales (ej.: 10 o 10,5).`);
  return v;
}

export async function replaceCommissionAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    const scope = str(f, "categoryId");
    await admin.replaceCommissionRule(
      actor,
      {
        categoryId: scope && scope !== "default" ? scope : null,
        providerRateBps: pct(f, "providerRate", "la comisión al proveedor"),
        clientRateBps: pct(f, "clientRate", "el cargo al cliente"),
        clientFeeTaxBps: pct(f, "clientFeeTax", "el impuesto sobre el cargo"),
      },
      str(f, "reason"),
    );
    refresh();
    return { ok: true, message: "Regla de comisión vigente actualizada. Aplica a presupuestos nuevos." };
  });
}

export async function removeCategoryRuleAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    await admin.removeCategoryCommissionRule(actor, str(f, "categoryId"), str(f, "reason"));
    refresh();
    return { ok: true, message: "La categoría vuelve a usar la regla general." };
  });
}

export async function updateSettingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    await admin.updatePlatformSettings(actor, { inviteLimit: str(f, "inviteLimit"), quoteValidDays: str(f, "quoteValidDays") }, str(f, "reason"));
    refresh();
    return { ok: true, message: "Parámetros actualizados." };
  });
}

export async function releaseWithoutReviewAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requireStaff();
    await releasePayoutWithoutReview(actor, str(f, "payoutId"), str(f, "reason"));
    revalidatePath("/admin/finanzas");
    return { ok: true, message: "Liquidación habilitada sin reseña (auditado)." };
  });
}

export async function updateReviewSettingsAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = await requirePlatformAdmin();
    await admin.updateReviewSettings(actor, { delays: str(f, "delays"), jitterHours: str(f, "jitterHours"), reminderDays: str(f, "reminderDays") }, str(f, "reason"));
    refresh();
    return { ok: true, message: "Regla de reseñas actualizada. Aplica a las reseñas nuevas." };
  });
}
