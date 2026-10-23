import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { requireSection } from "@/server/auth/session";
import { invitationText, LEAD_SOURCE_LABEL, LEAD_STAGE_LABEL, type LeadStage } from "@/server/modules/supply";
import { leadDetail, supplyOwners } from "@/server/queries/supply";
import { PageHeader, DefinitionList } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Field, Select, Textarea, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/alert";
import { ActionForm, ConfirmAction, ReadOnly, SubmitButton } from "@/components/ui/form";
import { BackLink, EventList, Section, type EventItem } from "@/components/admin/ui";
import { buttonClass } from "@/components/ui/button";
import { REGION_LABEL } from "@/lib/regions";
import { formatDateTime } from "@/lib/format";
import { CONTACT_CHANNELS, STAGE_TONE } from "../labels";
import { checkSource, domainOf, SOURCE_CHECK_LABEL } from "@/lib/lead-source";
import { addLeadNoteAction, assignLeadOwnerAction, doNotContactAction, recordContactAction, setLeadStageAction } from "../actions";

export const metadata = { title: "Candidato" };
export const dynamic = "force-dynamic";

const COMMERCIAL: LeadStage[] = ["candidate", "contacted", "interested", "discarded"];

function eventTitle(kind: string, d: Record<string, unknown>): { title: string; reason: string | null } {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  switch (kind) {
    case "import": return { title: `Entró desde ${s(d.source) || "la planilla"}`, reason: d.linkedProvider ? "Ya tenía perfil en Fixy: quedó vinculado." : null };
    case "sync_update": return { title: "La planilla completó datos", reason: Array.isArray(d.fields) ? `Campos: ${(d.fields as string[]).join(", ")}` : null };
    case "stage": return { title: `${LEAD_STAGE_LABEL[s(d.from) as LeadStage] ?? s(d.from)} → ${LEAD_STAGE_LABEL[s(d.to) as LeadStage] ?? s(d.to)}${d.auto ? " (según su perfil)" : ""}`, reason: s(d.reason) || null };
    case "contact": return { title: `Contacto por ${CONTACT_CHANNELS[s(d.channel)] ?? s(d.channel)}`, reason: s(d.note) || null };
    case "note": return { title: "Nota", reason: s(d.note) || null };
    case "link": return { title: "Se registró en Fixy", reason: `Vinculado por ${s(d.by) || "—"}${d.source ? ` · origen ${s(d.source)}` : ""}` };
    case "opt_out": return { title: "Pidió no ser contactado", reason: s(d.reason) || null };
    case "click": return { title: `Abrió el link de invitación (${s(d.via) === "web" ? "web" : "WhatsApp"})`, reason: null };
    case "campaign": {
      const what: Record<string, string> = {
        sent: `Invitación enviada${Number(d.attempt) > 1 ? ` (seguimiento ${Number(d.attempt) - 1})` : ""}`, skipped: "Salteado en la campaña",
        replied_interested: "Respondió: le interesa", replied_not_interested: "Respondió: no le interesa", opted_out: "Pidió la baja en la campaña",
      };
      return { title: `${what[s(d.action)] ?? s(d.action)} · ${s(d.name)}`, reason: s(d.reason) || s(d.note) || null };
    }
    case "consent": return { title: "Consentimiento para recibir WhatsApp registrado", reason: s(d.source) || null };
    case "assign": return { title: d.ownerId ? "Cambió el responsable" : "Quedó sin responsable", reason: null };
    default: return { title: kind, reason: null };
  }
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { readOnly } = await requireSection("captacion");
  const [data, owners] = await Promise.all([leadDetail(id), supplyOwners()]);
  if (!data) notFound();
  const { lead, events } = data;
  const registered = !!lead.provider_id;
  const wa = lead.whatsapp_e164 && !lead.do_not_contact ? `https://wa.me/${lead.whatsapp_e164}?text=${encodeURIComponent(invitationText(lead))}` : null;
  const items: EventItem[] = events.map((e) => ({ id: e.id, created_at: e.created_at, actor_name: e.actor_name, actor_role: e.actor_role, ...eventTitle(e.kind, e.detail) }));
  const raw = Object.entries(lead.research_data ?? {}).filter(([, v]) => v);
  const sourceCheck = checkSource(lead.source_url, lead.website);

  return (
    <>
      <BackLink href="/admin/captacion">Captación</BackLink>
      <PageHeader eyebrow={`${lead.code} · ${LEAD_SOURCE_LABEL[lead.source] ?? lead.source}`} title={lead.business_name}
        description={lead.categories.length ? lead.categories.join(", ") : lead.trades_raw ?? undefined}
        action={<div className="flex flex-wrap gap-2">
          <Badge tone={STAGE_TONE[lead.stage]} icon={false}>{LEAD_STAGE_LABEL[lead.stage]}</Badge>
          {lead.do_not_contact && <Badge tone="danger">No contactar</Badge>}
        </div>} />

      {lead.do_not_contact && <Alert tone="danger" className="mb-5">Pidió no ser contactado{lead.opt_out_at ? ` (${formatDateTime(lead.opt_out_at)})` : ""}. No le escribas ni lo llames.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Section title="Datos">
            <DefinitionList items={[
              ["Contacto", lead.contact_name ?? "—"],
              ["Teléfono", lead.phone_raw ?? "Sin teléfono"],
              ["Email", lead.email ?? "—"],
              ["Web o red", lead.website ? <a href={lead.website.startsWith("http") ? lead.website : `https://${lead.website}`} target="_blank" rel="noopener noreferrer nofollow" className="text-fixy-800 underline break-all">{lead.website}</a> : "—"],
              ["Localidad base", `${lead.zone ?? lead.base_locality ?? "—"}${lead.base_region ? ` · ${REGION_LABEL[lead.base_region] ?? lead.base_region}` : ""}`],
              ["Origen", `${LEAD_SOURCE_LABEL[lead.source] ?? lead.source}${lead.source_detail ? ` · ${lead.source_detail}` : ""}`],
              ["Fuente del dato", lead.source_url ? <span key="src">
                <a href={lead.source_url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-fixy-800 underline">{domainOf(lead.source_url) ?? lead.source_url}</a>
                {sourceCheck && <span className="ml-2 text-xs text-muted">({SOURCE_CHECK_LABEL[sourceCheck]})</span>}
              </span> : "Sin registrar (sumá la columna «Fuente» en la planilla)"],
              ...(Object.keys(lead.utm ?? {}).length ? [["Campaña", Object.entries(lead.utm).map(([k, v]) => `${k.replace("utm_", "")}: ${v}`).join(" · ")] as [string, string]] : []),
              ["Perfil en Fixy", registered ? <Link href={`/admin/proveedores/${lead.provider_id}`} className="text-fixy-800 underline">{lead.provider_name ?? "Ver perfil"}</Link> : "Todavía no se registró"],
              ["Responsable", lead.owner ?? "Sin asignar"],
              ["Consentimiento para WhatsApp", lead.wa_consent_at ? `Sí, desde ${formatDateTime(lead.wa_consent_at)}${lead.wa_consent_source ? ` · ${lead.wa_consent_source}` : ""}` : "No registrado"],
            ]} />
          </Section>

          <Section title="Historial">
            <EventList items={items} empty="Sin movimientos todavía." />
          </Section>

          {raw.length > 0 && (
            <Section title="Fila original de la planilla">
              <details><summary className="cursor-pointer text-sm text-muted">Ver todos los campos</summary>
                <DefinitionList className="mt-2" items={raw.map(([k, v]) => [k, <span key={k} className="break-all">{v}</span>])} />
              </details>
            </Section>
          )}
        </div>

        <ReadOnly when={readOnly}>
          <div className="space-y-6">
            <Section title="Contactar" description="El primer mensaje lo manda una persona desde el WhatsApp comercial, nunca el número del bot.">
              {wa ? (
                <a href={wa} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md", "w-full justify-center")}>
                  <MessageCircle className="h-5 w-5" aria-hidden />Abrir WhatsApp con la invitación
                </a>
              ) : <p className="text-sm text-muted">{lead.do_not_contact ? "No se lo puede contactar." : "No tiene un celular válido para WhatsApp."}</p>}
              {!lead.do_not_contact && (
                <ActionForm action={recordContactAction} resetOnSuccess className="mt-4 space-y-3">
                  <input type="hidden" name="leadId" value={lead.id} />
                  <Field label="¿Por dónde lo contactaste?" htmlFor="c-ch">
                    <Select id="c-ch" name="channel" defaultValue="whatsapp">
                      {Object.entries(CONTACT_CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                  <Field label="Qué pasó (opcional)" htmlFor="c-note"><Input id="c-note" name="note" maxLength={500} placeholder="Le interesa, lo llamo el lunes" /></Field>
                  <SubmitButton variant="secondary">Anotar contacto</SubmitButton>
                </ActionForm>
              )}
            </Section>

            <Section title="Etapa" description={registered ? "Ya se registró: la etapa sale de su perfil (verificado cuando validamos el DNI; activo cuando está aprobado y aceptando trabajos)." : undefined}>
              {!registered && (
                <div className="flex flex-wrap gap-2">
                  {COMMERCIAL.filter((s) => s !== lead.stage && s !== "discarded").map((s) => (
                    <ConfirmAction key={s} action={setLeadStageAction} label={LEAD_STAGE_LABEL[s]} size="sm" variant="secondary" title={`Pasar a «${LEAD_STAGE_LABEL[s]}»`}
                      confirmLabel="Cambiar" hidden={{ leadId: lead.id, stage: s }} />
                  ))}
                  {lead.stage !== "discarded" && (
                    <ConfirmAction action={setLeadStageAction} label="Descartar" size="sm" variant="ghost" title="Descartar candidato" requireReason reasonLabel="¿Por qué?"
                      confirmLabel="Descartar" hidden={{ leadId: lead.id, stage: "discarded" }} />
                  )}
                </div>
              )}
              {lead.discard_reason && <p className="mt-2 text-sm text-muted">Motivo: {lead.discard_reason}</p>}
            </Section>

            <Section title="Nota">
              <ActionForm action={addLeadNoteAction} resetOnSuccess className="space-y-3">
                <input type="hidden" name="leadId" value={lead.id} />
                <Textarea name="note" required minLength={2} maxLength={1000} aria-label="Nota" placeholder="Trabaja solo en zona norte; tiene camioneta" />
                <SubmitButton variant="secondary">Guardar nota</SubmitButton>
              </ActionForm>
            </Section>

            <Section title="Responsable">
              <ActionForm action={assignLeadOwnerAction} className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="leadId" value={lead.id} />
                <Select name="ownerId" defaultValue={lead.owner_id ?? ""} aria-label="Responsable" className="min-w-48 flex-1">
                  <option value="">Sin asignar</option>
                  {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                </Select>
                <SubmitButton variant="secondary">Asignar</SubmitButton>
              </ActionForm>
            </Section>

            {!lead.do_not_contact && (
              <ConfirmAction action={doNotContactAction} label="Pidió que no lo contactemos" variant="danger" size="sm" title="Marcar «no contactar»" requireReason
                reasonLabel="¿Cómo lo pidió?" description="Queda marcado para siempre y nadie del equipo lo puede volver a contactar." confirmLabel="Marcar" hidden={{ leadId: lead.id }} />
            )}
          </div>
        </ReadOnly>
      </div>
    </>
  );
}
