"use server";

import { revalidatePath } from "next/cache";
import { act, bool, files, str, strs } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireRecentMfa, requireSection } from "@/server/auth/session";
import { invalid } from "@/server/domain/errors";
import { parseArsToMinor } from "@/server/domain/money";
import { parseCsv } from "@/lib/csv";
import * as supply from "@/server/modules/supply";
import { audit } from "@/server/audit";
import { sql } from "@/server/db/client";
import * as campaigns from "@/server/modules/supply-campaigns";
import { createApiKey, revokeApiKey } from "@/server/modules/api-keys";

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
    if (!inputs.length) throw invalid(issues[0]?.problem ?? "El archivo no tiene filas con Nombre.");
    const consented = bool(f, "consent");
    const consentSource = str(f, "consentSource").trim();
    if (consented && consentSource.length < 5) throw invalid("Contá de dónde sale el consentimiento (por ejemplo: «Padrón de matriculados de …, autorizaron recibir comunicaciones»).");
    const r = await supply.importLeads(inputs, {
      source: "research", sourceDetail: `Archivo ${file.name.slice(0, 120)}`, trigger: "upload", actor, preIssues: issues,
      ...(consented ? { consent: { source: consentSource } } : {}),
    });
    refresh();
    return { ok: true, message: `Listo: ${r.inserted} nuevos, ${r.updated} actualizados, ${r.unchanged} sin cambios, ${r.skipped} salteados.${consented ? " El consentimiento quedó registrado en cada contacto." : ""}` };
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

// ───────── Campañas ─────────

export async function createCampaignAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    const zoneOrRegion = strs(f, "where");
    const r = await campaigns.createCampaign(actor, {
      name: str(f, "name"), channel: (["email", "whatsapp_api"].includes(str(f, "channel")) ? str(f, "channel") : "whatsapp") as "whatsapp" | "whatsapp_api" | "email",
      categoryIds: strs(f, "categoryIds"),
      regions: zoneOrRegion.filter((v) => v.startsWith("region:")).map((v) => v.slice(7)),
      zoneIds: zoneOrRegion.filter((v) => v.startsWith("zone:")).map((v) => v.slice(5)),
      size: Number(str(f, "size")), firstMessage: str(f, "firstMessage"), followupMessage: str(f, "followupMessage"), emailSubject: str(f, "emailSubject"),
      followupDays: Number(str(f, "followupDays") || 4), maxAttempts: Number(str(f, "maxAttempts") || 2), dailyCap: Number(str(f, "dailyCap") || 20),
      onlyConsented: bool(f, "onlyConsented"),
    });
    revalidatePath("/admin/captacion/campanas");
    return { ok: true, message: `Campaña creada en borrador con ${r.leads} candidatos. Revisala antes de activarla.`, data: { id: r.id } };
  });
}

export async function setCampaignStatusAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    const id = str(f, "campaignId");
    const to = str(f, "to");
    if (!["active", "paused", "closed"].includes(to)) throw invalid("Estado inválido.");
    await campaigns.setCampaignStatus(actor, id, to as "active");
    revalidatePath("/admin/captacion/campanas");
    revalidatePath(`/admin/captacion/campanas/${id}`);
    return { ok: true, message: to === "active" ? "Campaña activa." : to === "paused" ? "Campaña pausada." : "Campaña cerrada." };
  });
}

export async function removeFromCampaignAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    await campaigns.removeFromCampaign((await requireSection("captacion", "manage")).actor, str(f, "campaignLeadId"));
    revalidatePath(`/admin/captacion/campanas/${str(f, "campaignId")}`);
    return { ok: true, message: "Lo sacamos de la campaña." };
  });
}

export async function resolveQueueItemAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    const outcome = str(f, "outcome");
    if (!["sent", "skip", "interested", "not_interested", "opt_out"].includes(outcome)) throw invalid("Acción inválida.");
    await campaigns.resolveQueueItem(actor, str(f, "campaignLeadId"), outcome as campaigns.QueueOutcome, str(f, "reason") || str(f, "note") || undefined);
    revalidatePath(`/admin/captacion/campanas/${str(f, "campaignId")}`);
    revalidatePath("/admin/captacion");
    const msg: Record<string, string> = { sent: "Anotado como enviado.", skip: "Salteado.", interested: "Anotado: le interesa.", not_interested: "Anotado: no le interesa.", opt_out: "Anotada la baja: no se lo vuelve a contactar." };
    return { ok: true, message: msg[outcome] };
  });
}

export async function setComplianceAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    await requireRecentMfa(actor);
    await campaigns.setCompliance(actor, {
      commercialNumber: str(f, "commercialNumber"), aaipRegistration: str(f, "aaipRegistration"),
      metaPolicyReviewed: bool(f, "metaPolicyReviewed"), emailPolicyReviewed: bool(f, "emailPolicyReviewed"),
    });
    revalidatePath("/admin/captacion/campanas");
    return { ok: true, message: "Requisitos guardados." };
  });
}

// ───────── API de solo lectura ─────────

export async function createApiKeyAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    await requireRecentMfa(actor);
    const days = str(f, "expiresDays");
    const { key } = await createApiKey(actor, { name: str(f, "name"), expiresDays: days ? Number(days) : null });
    revalidatePath("/admin/captacion");
    return { ok: true, message: "Clave creada. Copiala ahora: no se vuelve a mostrar.", data: { key } };
  });
}

export async function revokeApiKeyAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    await revokeApiKey(actor, str(f, "keyId"));
    revalidatePath("/admin/captacion");
    return { ok: true, message: "Clave revocada: deja de funcionar ya." };
  });
}

// ───────── WhatsApp automático (Meta + Kommo) ─────────

export async function createSupplyTemplatesAction(): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    const { createSupplyTemplates } = await import("@/server/whatsapp/supply-number");
    const results = await createSupplyTemplates();
    await audit(sql(), actor, "supply.templates_create", "platform_settings", null, "Plantillas de captación", { results });
    revalidatePath("/admin/captacion/campanas");
    return { ok: true, message: results.join(" · ") };
  });
}

export async function setupKommoAction(): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    const { kommoConfigured, setupKommoPipeline } = await import("@/server/integrations/kommo");
    if (!kommoConfigured()) throw invalid("Falta conectar Kommo: cargá KOMMO_TOKEN y KOMMO_SUBDOMINIO en Vercel.");
    const done = await setupKommoPipeline();
    await audit(sql(), actor, "supply.kommo_setup", "platform_settings", null, "Embudo Captación Fixy", { done });
    revalidatePath("/admin/captacion/campanas");
    return { ok: true, message: done.join(" ") };
  });
}

export async function sendCampaignNowAction(_: ActionState, f: FormData): Promise<ActionState> {
  return act(async () => {
    const actor = (await requireSection("captacion", "manage")).actor;
    const id = str(f, "campaignId");
    const r = await campaigns.sendCampaignNow(actor, id);
    revalidatePath(`/admin/captacion/campanas/${id}`);
    const extra = r.notes.filter((n) => n.startsWith("WhatsApp frenado")).join(" ");
    return { ok: true, message: `Enviados: ${r.sent}. Con error: ${r.failed}.${extra ? ` ${extra}` : ""}` };
  });
}
