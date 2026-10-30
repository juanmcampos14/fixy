import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSection } from "@/server/auth/session";
import { CHANNEL_LABEL, complianceGaps, getCompliance, nextInQueue, previewCampaign } from "@/server/modules/supply-campaigns";
import { campaignDetail } from "@/server/queries/supply";
import { LEAD_STAGE_LABEL } from "@/server/modules/supply";
import { PageHeader, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ConfirmAction, ReadOnly } from "@/components/ui/form";
import { BackLink, DataTable, Section, Td, Th } from "@/components/admin/ui";
import { QueueCard } from "@/components/admin/supply/queue-card";
import { REGION_LABEL } from "@/lib/regions";
import { formatDate, formatDateTime } from "@/lib/format";
import { CAMPAIGN_LEAD_STATUS, CAMPAIGN_STATUS, STAGE_TONE } from "../../labels";
import { removeFromCampaignAction, resolveQueueItemAction, setCampaignStatusAction } from "../../actions";

export const metadata = { title: "Campaña" };
export const dynamic = "force-dynamic";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { readOnly } = await requireSection("captacion");
  const data = await campaignDetail(id);
  if (!data) notFound();
  const { campaign: c, leads } = data;
  const [compliance, queue, preview] = await Promise.all([getCompliance(), nextInQueue(id), c.status === "draft" ? previewCampaign(id) : null]);
  const gaps = complianceGaps(compliance, c.channel);
  const where = [...c.regions.map((r) => REGION_LABEL[r] ?? r), ...c.zones].join(", ") || "Todas las zonas";

  return (
    <>
      <BackLink href="/admin/captacion/campanas">Campañas</BackLink>
      <PageHeader eyebrow={`${CHANNEL_LABEL[c.channel]} · utm_campaign=${c.slug}`} title={c.name}
        description={`${c.categories.join(", ") || "Todos los oficios"} · ${where}${c.only_consented ? " · solo con consentimiento" : ""}. Seguimiento a los ${c.followup_days} días, hasta ${c.max_attempts} ${c.max_attempts === 1 ? "intento" : "intentos"}, máximo ${c.daily_cap} por día.`}
        action={<Badge tone={CAMPAIGN_STATUS[c.status].tone} icon={false}>{CAMPAIGN_STATUS[c.status].label}</Badge>} />

      <ReadOnly when={readOnly}>
        {c.status !== "closed" && (
          <div className="mb-6 flex flex-wrap gap-2">
            {(c.status === "draft" || c.status === "paused") && (
              <ConfirmAction action={setCampaignStatusAction} label={c.status === "draft" ? "Activar campaña" : "Reanudar"} title="Activar la campaña"
                description={c.channel === "email" ? `Los emails empiezan a salir solos en horario comercial, hasta ${c.daily_cap} por día.`
                  : c.channel === "whatsapp_api" ? `Los WhatsApp salen solos desde el número comercial, en horario comercial (lunes a sábado de 9 a 19), hasta ${c.daily_cap} por día. Cada uno queda como lead en Kommo, donde llegan las respuestas.`
                  : "Aparece la cola para mandar las invitaciones desde el WhatsApp comercial."}
                confirmLabel="Activar" hidden={{ campaignId: c.id, to: "active" }} />
            )}
            {c.status === "active" && <ConfirmAction action={setCampaignStatusAction} label="Pausar" variant="secondary" title="Pausar la campaña" description="No sale nada más hasta reanudarla." confirmLabel="Pausar" hidden={{ campaignId: c.id, to: "paused" }} />}
            <ConfirmAction action={setCampaignStatusAction} label="Cerrar" variant="ghost" title="Cerrar la campaña"
              description="Termina para siempre. Los candidatos sin respuesta quedan libres para otra campaña dentro de 60 días." confirmLabel="Cerrar" hidden={{ campaignId: c.id, to: "closed" }} />
          </div>
        )}
        {c.status !== "closed" && c.status !== "active" && gaps.length > 0 && (
          <Alert tone="warn" className="mb-6">Para activarla falta: {gaps.join("; ")}. Se completa en <Link href="/admin/captacion/campanas" className="underline">Campañas › Requisitos</Link>.</Alert>
        )}

        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Candidatos" value={c.total} hint={`${c.queued} en cola`} />
          <Stat label="Enviados" value={c.sent} hint={c.followups_due ? `${c.followups_due} seguimientos pendientes` : undefined} />
          <Stat label="Abrieron el link" value={c.clicked} hint={pct(c.clicked, c.sent)} />
          <Stat label="Respondieron" value={c.replied} hint={`${c.interested} interesados`} />
          <Stat label="Registrados" value={c.registered} hint={pct(c.registered, c.sent)} tone="ok" />
          <Stat label="Activos" value={c.active} tone="ok" />
          <Stat label="Bajas y sin respuesta" value={c.opted_out + c.no_response} hint={`${c.opted_out} bajas`} />
        </div>

        {c.channel === "whatsapp" && c.status === "active" && (
          <Section className="mb-6" title="Cola de envío" description={`Hoy: ${queue.sentToday} de ${queue.dailyCap}. Primero van los seguimientos vencidos.`}>
            {queue.item ? <QueueCard key={queue.item.campaignLeadId} item={queue.item} campaignId={c.id} action={resolveQueueItemAction} />
              : <p className="text-[15px] text-ink-2">{queue.capReached ? `Listo por hoy: ya se mandaron los ${queue.dailyCap}. Mandar muchos seguidos desde un número nuevo hace que WhatsApp lo bloquee.` : "No hay nada para mandar ahora. Los seguimientos aparecen cuando se cumple el plazo."}</p>}
          </Section>
        )}

        {preview && (
          <Section className="mb-6" title="Así le llega" description={`Ejemplo con ${preview.to}.`}>
            {preview.subject && <p className="mb-2 text-sm"><strong>Asunto:</strong> {preview.subject}</p>}
            <pre className="whitespace-pre-wrap rounded-2xl bg-cream-2 p-4 font-sans text-[15px] leading-relaxed">{preview.first}</pre>
            {preview.followup && (
              <details className="mt-3"><summary className="cursor-pointer text-sm font-semibold">Ver el seguimiento</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-2xl bg-cream-2 p-4 font-sans text-[15px] leading-relaxed">{preview.followup}</pre>
              </details>
            )}
          </Section>
        )}

        <Section title="Candidatos de la campaña" description="Cuando alguien responde al número comercial, anotalo acá: así se cortan los seguimientos y se mide la respuesta. Los registros se detectan solos.">
          <DataTable caption="Candidatos de la campaña" minWidth={980}>
            <thead><tr><Th>Candidato</Th><Th>En la campaña</Th><Th>Intentos</Th><Th>Último envío</Th><Th>Link</Th><Th>Etapa</Th>{!readOnly && c.status !== "closed" && <Th>Acción</Th>}</tr></thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <Td>
                    <Link href={`/admin/captacion/${l.lead_id}`} className="font-semibold text-fixy-800 hover:underline">{l.business_name}</Link>
                    <div className="text-xs text-muted">{l.code} · {[l.trade, l.place].filter(Boolean).join(" · ")}</div>
                  </Td>
                  <Td className="text-sm">{CAMPAIGN_LEAD_STATUS[l.status] ?? l.status}{l.skip_reason && <div className="text-xs text-muted">{l.skip_reason}</div>}{l.last_error && <div className="text-xs text-danger">{l.last_error}</div>}</Td>
                  <Td className="tabular">{l.attempts}</Td>
                  <Td className="text-sm">{l.last_sent_at ? formatDateTime(l.last_sent_at) : "—"}{l.status === "sent" && l.next_followup_at && <div className="text-xs text-muted">Sigue: {formatDate(l.next_followup_at)}</div>}</Td>
                  <Td className="text-sm">{l.clicked_at ? formatDate(l.clicked_at) : "—"}</Td>
                  <Td><Badge tone={STAGE_TONE[l.stage]} icon={false}>{LEAD_STAGE_LABEL[l.stage]}</Badge></Td>
                  {!readOnly && c.status !== "closed" && (
                    <Td>
                      <div className="flex flex-wrap gap-1.5">
                        {c.status === "draft" && <ConfirmAction action={removeFromCampaignAction} label="Sacar" size="sm" variant="ghost" title={`Sacar a ${l.business_name}`} confirmLabel="Sacar" hidden={{ campaignLeadId: l.id, campaignId: c.id }} />}
                        {c.status !== "draft" && ["sent", "queued", "no_response"].includes(l.status) && !l.registered && (
                          <>
                            <ConfirmAction action={resolveQueueItemAction} label="Le interesa" size="sm" variant="secondary" title="Respondió: le interesa" description="Pasa a «Interesado» y se cortan los seguimientos." confirmLabel="Anotar" hidden={{ campaignLeadId: l.id, campaignId: c.id, outcome: "interested" }} />
                            <ConfirmAction action={resolveQueueItemAction} label="No le interesa" size="sm" variant="ghost" title="Respondió: no le interesa" requireReason reasonLabel="¿Qué dijo?" confirmLabel="Anotar" hidden={{ campaignLeadId: l.id, campaignId: c.id, outcome: "not_interested" }} />
                            <ConfirmAction action={resolveQueueItemAction} label="Pidió BAJA" size="sm" variant="danger" title="Pidió que no le escribamos más" description="Queda marcado para siempre: nadie lo vuelve a contactar." confirmLabel="Marcar baja" hidden={{ campaignLeadId: l.id, campaignId: c.id, outcome: "opt_out" }} />
                          </>
                        )}
                      </div>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Section>
      </ReadOnly>
    </>
  );
}
