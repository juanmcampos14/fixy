"use server";

import { revalidatePath } from "next/cache";
import { act, files, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireSection } from "@/server/auth/session";
import { invalid } from "@/server/domain/errors";
import { parseArsToMinor } from "@/server/domain/money";
import { parseCsv } from "@/lib/csv";
import * as supply from "@/server/modules/supply";

const refresh = (leadId?: string) => {
  revalidatePath("/admin/captacion");
  if (leadId) revalidatePath(`/admin/captacion/${leadId}`);
};

export async function recordContactAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const id = str(f, "leadId");
    await supply.recordContact((await requireSection("captacion", "manage")).actor, id, { channel: str(f, "channel") || "whatsapp", note: str(f, "note") });
    refresh(id);
    return { ok: true, message: "Contacto anotado." };
  });
}

export async function setLeadStageAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const id = str(f, "leadId");
    const stage = str(f, "stage");
    if (!["candidate", "contacted", "interested", "discarded"].includes(stage)) throw invalid("Etapa inválida.");
    await supply.setLeadStage((await requireSection("captacion", "manage")).actor, id, stage as "candidate", str(f, "reason"));
    refresh(id);
    return { ok: true, message: "Etapa actualizada." };
  });
}

export async function addLeadNoteAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const id = str(f, "leadId");
    await supply.addLeadNote((await requireSection("captacion", "manage")).actor, id, str(f, "note"));
    refresh(id);
    return { ok: true, message: "Nota guardada." };
  });
}

export async function doNotContactAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const id = str(f, "leadId");
    await supply.setDoNotContact((await requireSection("captacion", "manage")).actor, id, str(f, "reason"));
    refresh(id);
    return { ok: true, message: "Marcado: no se lo vuelve a contactar." };
  });
}

export async function assignLeadOwnerAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const id = str(f, "leadId");
    await supply.assignLeadOwner((await requireSection("captacion", "manage")).actor, id, str(f, "ownerId") || null);
    refresh(id);
    return { ok: true, message: "Responsable actualizado." };
  });
}

export async function createManualLeadAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const code = await supply.createManualLead((await requireSection("captacion", "manage")).actor, {
      businessName: str(f, "businessName"), trades: str(f, "trades"), locality: str(f, "locality"), phone: str(f, "phone"),
      email: str(f, "email"), website: str(f, "website"), sourceDetail: str(f, "sourceDetail"),
    });
    refresh();
    return { ok: true, message: `Candidato ${code} cargado.` };
  });
}

export async function syncSheetNowAction(): Promise<ActionState> {
  return act(async () => {
    const r = await supply.syncSupplySheet("manual", (await requireSection("captacion", "manage")).actor);
    refresh();
    if ("error" in r) return { error: r.error };
    return { ok: true, message: `Listo: ${r.inserted} nuevos, ${r.updated} actualizados, ${r.unchanged} sin cambios, ${r.skipped} salteados.` };
  });
}

/** Planilla exportada como CSV (mismas columnas que la de research). */
export async function uploadLeadsCsvAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    const [file] = await files(f, "file");
    if (!file) throw invalid("Elegí el archivo CSV.");
    if (file.data.length > 5 * 1024 * 1024) throw invalid("El archivo es muy grande (máximo 5 MB).");
    const { inputs, issues } = supply.parseResearchRows(parseCsv(file.data.toString("utf8")));
    if (!inputs.length) throw invalid(issues[0]?.problem ?? "El archivo no tiene filas con ID (FX-001) y Nombre comercial.");
    const r = await supply.importLeads(inputs, { source: "research", sourceDetail: `Archivo ${file.name.slice(0, 120)}`, trigger: "upload", actor, preIssues: issues });
    refresh();
    return { ok: true, message: `Listo: ${r.inserted} nuevos, ${r.updated} actualizados, ${r.unchanged} sin cambios, ${r.skipped} salteados.` };
  });
}

export async function setMarketingSpendAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const amount = parseArsToMinor(str(f, "amount"));
    if (amount == null || amount < 0) throw invalid("Revisá el importe: usá el formato 125.000,00.");
    await supply.setMarketingSpend((await requireSection("captacion", "manage")).actor, { channel: str(f, "channel"), month: str(f, "month"), amountMinor: amount, note: str(f, "note") || undefined });
    refresh();
    return { ok: true, message: "Gasto guardado." };
  });
}
