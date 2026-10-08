import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, MapPin } from "lucide-react";
import { getJobDetail, jobMoney } from "@/server/queries/shared";
import { listTeam, requireProviderContext } from "@/server/queries/provider";
import { TIME_WINDOWS } from "@/server/modules/requests";
import {
  disputeReasonLabel, disputeStatusLabel, jobStatusLabelProvider, modeLabel, payoutStatusLabel, propertyKindLabel, chargeStatusLabel, chargeKindLabel,
} from "@/server/domain/labels";
import { formatDate, formatDateTime, formatMoney, todayInBuenosAires } from "@/lib/format";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Timeline } from "@/components/domain/timeline";
import { MessageThread } from "@/components/domain/messages";
import { EvidenceGallery } from "@/components/domain/evidence";
import { ProviderNetBreakdown } from "@/components/domain/price";
import { ExtraForm } from "@/components/provider/extra-form";
import { EVIDENCE_KIND_LABEL, ITEM_KIND_LABEL } from "@/components/provider/constants";
import {
  addEvidenceAction, assignTechnicianAction, cancelJobAction, confirmJobAction, decideRescheduleAction, jobStepAction, proposeRescheduleAction, withdrawExtraAction,
} from "../../actions";

export const metadata: Metadata = { title: "Trabajo" };

const EXTRA_STATUS: Record<string, string> = { proposed: "Esperando al cliente", accepted: "Aceptado", rejected: "Rechazado", withdrawn: "Retirado" };
const EXTRA_TONE = { proposed: "warn", accepted: "ok", rejected: "neutral", withdrawn: "neutral" } as const;
const RESCHEDULE_STATUS: Record<string, string> = { proposed: "Pendiente", accepted: "Acordada", rejected: "Rechazada", withdrawn: "Retirada" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { actor } = await requireProviderContext();
  const d = await getJobDetail(actor.id, id);
  if (!d) notFound();
  const membership = actor.providers.find((p) => p.id === d.job.provider_id);
  if (!membership) notFound(); // este panel es solo para el proveedor del trabajo
  const isAdmin = membership.role === "admin";
  const { job, request } = d;
  const snap = job.contract_snapshot;
  const status = job.status;
  const paid = d.charges.some((c) => ["visit", "job_total", "deposit"].includes(c.kind) && ["approved", "partially_refunded", "refunded"].includes(c.status));
  const active = ["confirmed", "on_the_way", "in_progress", "pending_approval"].includes(status);
  const closed = status === "completed" || status === "cancelled";
  const pendingReschedule = d.reschedules.find((r) => r.status === "proposed");
  const team = isAdmin ? (await listTeam(actor.id, job.provider_id)).filter((m) => m.active) : [];
  const path = `/proveedor/trabajos/${id}`;
  const money = isAdmin ? jobMoney(d) : null;
  const anyTest = d.charges.some((c) => c.is_test) || !!d.payout?.is_test;

  return (
    <>
      <PageHeader
        back={<Link href="/proveedor/trabajos" className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800"><ArrowLeft className="h-4 w-4" aria-hidden /> Trabajos</Link>}
        eyebrow={`${job.code} · ${modeLabel[job.mode] ?? job.mode}`}
        title={request.title}
        description={`Cliente: ${d.clientName || "—"}${d.technicianName ? ` · Técnico: ${d.technicianName}` : ""}`}
        action={<StatusBadge status={status} labels={jobStatusLabelProvider} />}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          {/* Próximo paso */}
          <Card>
            <CardHeader title="Próximo paso" />
            {status === "pending_confirmation" && (
              isAdmin ? (
                paid ? (
                  <div className="space-y-3">
                    <Alert tone="ok" title="El pago del cliente está aprobado">Confirmá el trabajo para comprometerte con la fecha. Ya podés ver la dirección y los datos de acceso más abajo.</Alert>
                    <ActionForm action={confirmJobAction}>
                      <input type="hidden" name="jobId" value={id} />
                      <SubmitButton size="lg" pendingText="Confirmando…">Confirmar trabajo</SubmitButton>
                    </ActionForm>
                  </div>
                ) : (
                  <Alert tone="info" title="Esperando el pago del cliente">Vas a poder confirmar cuando el pago esté aprobado. Te avisamos.</Alert>
                )
              ) : (
                <Alert tone="info">Quien administra la cuenta tiene que confirmar el trabajo.</Alert>
              )
            )}
            {status === "confirmed" && (
              <div className="flex flex-wrap gap-2">
                <StepButton jobId={id} step="on_the_way" label="Estoy en camino" />
                <StepButton jobId={id} step="start" label="Empezar trabajo" variant="secondary" />
              </div>
            )}
            {status === "on_the_way" && <StepButton jobId={id} step="start" label="Empezar trabajo" />}
            {status === "in_progress" && (
              <ConfirmAction action={jobStepAction} label="Informar que terminé" title="¿Terminaste el trabajo?" confirmLabel="Informar finalización"
                description="El cliente revisa y da su conformidad. Si hay un adicional pendiente, retiralo o esperá la respuesta antes." hidden={{ jobId: id, step: "finish" }}>
                <div className="mt-4 space-y-1.5">
                  <label htmlFor="finish-note" className="block text-[15px] font-semibold">Nota para el cliente <span className="text-sm font-normal text-muted">(opcional)</span></label>
                  <textarea id="finish-note" name="note" maxLength={1000} className="block min-h-24 w-full rounded-xl border border-[#d3dfdc] px-3.5 py-3 focus:border-fixy-600 focus:outline-none focus:ring-3 focus:ring-fixy-500/25" />
                </div>
              </ConfirmAction>
            )}
            {status === "pending_approval" && <Alert tone="info" title="Esperando la conformidad del cliente">Cuando el cliente confirme, el trabajo se completa y se genera la liquidación pendiente.</Alert>}
            {status === "completed" && <Alert tone="ok" title="Trabajo completado">El cliente dio conformidad {formatDateTime(job.completed_at)}.</Alert>}
            {status === "cancelled" && <Alert tone="danger" title="Trabajo cancelado">{job.cancel_reason ?? ""}</Alert>}
          </Card>

          {/* Contrato */}
          <Card>
            <CardHeader title="Lo acordado" description={`Aceptado el ${formatDateTime(snap.acceptedAt)} · Este alcance no cambia; los cambios se hacen como adicionales.`} />
            <DefinitionList items={[
              ["Fecha", job.scheduled_date ? `${formatDate(job.scheduled_date)}${job.scheduled_window ? ` · ${job.scheduled_window}` : ""}` : "A coordinar"],
              ["Materiales", snap.quote.materialsIncluded ? "Incluidos" : "No incluidos"],
            ]} />
            <h3 className="mt-4 text-sm font-semibold text-muted">Alcance</h3>
            <p className="whitespace-pre-line text-[15px]">{snap.quote.scope}</p>
            {snap.quote.exclusions && (<><h3 className="mt-3 text-sm font-semibold text-muted">No incluye</h3><p className="whitespace-pre-line text-[15px]">{snap.quote.exclusions}</p></>)}
            <ul className="tabular mt-4 divide-y divide-line text-[15px]">
              {snap.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span><span className="text-muted">{ITEM_KIND_LABEL[it.kind] ?? it.kind}:</span> {it.description}{it.quantity > 1 && ` × ${it.quantity}`}</span>
                  {isAdmin && <span>{formatMoney(it.amount_minor)}</span>}
                </li>
              ))}
            </ul>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer font-semibold text-fixy-800">Pedido original del cliente</summary>
              <p className="mt-2 whitespace-pre-line text-ink-2">{request.description}</p>
            </details>
          </Card>

          {/* Avances */}
          <Card>
            <CardHeader title="Avances y evidencias" description="Fotos y notas que ve el cliente. Sin filtros que oculten detalles." />
            <EvidenceGallery items={d.evidence} />
            {active && (
              <ActionForm action={addEvidenceAction} className="mt-5 space-y-4 rounded-2xl bg-cream/60 p-4 ring-1 ring-line" resetOnSuccess>
                <input type="hidden" name="jobId" value={id} />
                <h3 className="font-bold">Registrar un avance</h3>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Tipo" htmlFor="ev-kind" required>
                    <Select id="ev-kind" name="kind" defaultValue="progress">
                      {Object.entries(EVIDENCE_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </Select>
                  </Field>
                  <Field label="Foto (JPG, PNG o WEBP)" htmlFor="ev-photo">
                    <input id="ev-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-sm file:mr-3 file:h-11 file:rounded-full file:border-0 file:bg-fixy-50 file:px-4 file:font-semibold file:text-fixy-800" />
                  </Field>
                </div>
                <Field label="Nota" htmlFor="ev-note" hint="Agregá una foto, una nota o ambas.">
                  <Textarea id="ev-note" name="note" maxLength={1000} className="min-h-20" />
                </Field>
                <SubmitButton variant="soft" pendingText="Guardando…">Registrar avance</SubmitButton>
              </ActionForm>
            )}
          </Card>

          {/* Adicionales */}
          {(isAdmin || d.extras.length > 0) && (
            <Card>
              <CardHeader title="Adicionales" description="Trabajo extra fuera del alcance acordado. Solo se hace y se cobra si el cliente lo acepta." />
              {d.extras.length > 0 && (
                <ul className="mb-4 divide-y divide-line">
                  {d.extras.map((e) => (
                    <li key={e.id} className="py-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="font-semibold">{e.description}</p>
                        <Badge tone={EXTRA_TONE[e.status as keyof typeof EXTRA_TONE] ?? "neutral"}>{EXTRA_STATUS[e.status] ?? e.status}</Badge>
                      </div>
                      <p className="text-sm text-muted">{e.reason}</p>
                      {isAdmin && <p className="tabular mt-1 text-sm">Bruto {formatMoney(e.subtotal_minor)} · comisión {formatMoney(e.provider_fee_minor)} · <strong>neto {formatMoney(e.provider_net_minor)}</strong></p>}
                      {e.decision_note && <p className="mt-1 text-sm">Respuesta del cliente: {e.decision_note}</p>}
                      {isAdmin && e.status === "proposed" && (
                        <ActionForm action={withdrawExtraAction} className="mt-2">
                          <input type="hidden" name="extraId" value={e.id} />
                          <input type="hidden" name="jobId" value={id} />
                          <SubmitButton variant="secondary" size="sm" pendingText="Retirando…">Retirar adicional</SubmitButton>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {isAdmin && ["confirmed", "on_the_way", "in_progress"].includes(status) ? (
                <ExtraForm jobId={id} rule={{ providerRateBps: snap.amounts.providerRateBps, clientRateBps: snap.amounts.clientRateBps, clientFeeTaxBps: snap.amounts.clientFeeTaxBps }} />
              ) : isAdmin && d.extras.length === 0 ? (
                <p className="text-sm text-muted">Los adicionales se proponen con el trabajo confirmado o en curso.</p>
              ) : null}
            </Card>
          )}

          {/* Reprogramaciones (solo administradores: el servicio no habilita a técnicos) */}
          {isAdmin && (
            <Card>
              <CardHeader title="Fecha y reprogramaciones" />
              {d.reschedules.length > 0 && (
                <ul className="mb-4 divide-y divide-line">
                  {d.reschedules.map((r) => (
                    <li key={r.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{formatDate(r.new_date)}{r.new_window ? ` · ${r.new_window}` : ""}</p>
                        <Badge tone={r.status === "proposed" ? "warn" : r.status === "accepted" ? "ok" : "neutral"}>{RESCHEDULE_STATUS[r.status] ?? r.status}</Badge>
                      </div>
                      <p className="text-sm text-muted">Propuesta por {r.proposed_side === "client" ? "el cliente" : "tu equipo"}{r.proposer ? ` (${r.proposer})` : ""} · {r.reason}</p>
                      {r.status === "proposed" && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {r.proposed_side === "client" ? (
                            <>
                              <DecideButton rescheduleId={r.id} jobId={id} decision="accepted" label="Aceptar nueva fecha" />
                              <DecideButton rescheduleId={r.id} jobId={id} decision="rejected" label="Rechazar" variant="secondary" />
                            </>
                          ) : (
                            <DecideButton rescheduleId={r.id} jobId={id} decision="withdrawn" label="Retirar propuesta" variant="secondary" />
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!pendingReschedule && ["pending_confirmation", "confirmed", "on_the_way"].includes(status) ? (
                <ActionForm action={proposeRescheduleAction} className="space-y-4" resetOnSuccess>
                  <input type="hidden" name="jobId" value={id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nueva fecha" htmlFor="rs-date" required>
                      <Input id="rs-date" name="newDate" type="date" min={todayInBuenosAires()} required />
                    </Field>
                    <Field label="Franja" htmlFor="rs-window">
                      <Select id="rs-window" name="newWindow" defaultValue="">
                        <option value="">A coordinar</option>
                        {TIME_WINDOWS.map((w) => <option key={w.key} value={w.label}>{w.label}</option>)}
                      </Select>
                    </Field>
                  </div>
                  <Field label="Motivo" htmlFor="rs-reason" required>
                    <Input id="rs-reason" name="reason" required minLength={3} maxLength={500} />
                  </Field>
                  <SubmitButton variant="soft" pendingText="Enviando…">Proponer nueva fecha</SubmitButton>
                </ActionForm>
              ) : !pendingReschedule && !closed ? (
                <p className="text-sm text-muted">En este estado ya no se puede reprogramar.</p>
              ) : null}
            </Card>
          )}

          {isAdmin && d.disputes.length > 0 && (
            <Card>
              <CardHeader title="Reclamos" />
              <ul className="divide-y divide-line">
                {d.disputes.map((x) => (
                  <li key={x.id}>
                    <Link href={`/proveedor/reclamos/${x.id}`} className="flex min-h-12 flex-wrap items-center justify-between gap-2 py-3 hover:bg-cream/50">
                      <span>
                        <span className="block font-semibold">{disputeReasonLabel[x.reason_code] ?? x.reason_code}</span>
                        <span className="text-sm text-muted">Abierto por {x.opened_side === "client" ? "el cliente" : "tu equipo"} · {formatDateTime(x.created_at)}</span>
                      </span>
                      <StatusBadge status={x.status} labels={disputeStatusLabel} />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {d.conversationId && (
            <Card>
              <CardHeader title="Mensajes con el cliente" />
              <MessageThread conversationId={d.conversationId} messages={d.messages} path={path} disabled={closed} />
            </Card>
          )}

          <Card>
            <CardHeader title="Historial" />
            <Timeline events={d.events} audience="provider" />
          </Card>
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Dónde" />
            {d.property ? (
              <div className="space-y-2 text-[15px]">
                <p className="flex gap-2 font-semibold"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />{d.property.address_line}{d.property.address_extra ? `, ${d.property.address_extra}` : ""}</p>
                <p className="text-muted">{d.property.zone_name} · {propertyKindLabel[d.property.kind] ?? d.property.kind}</p>
                {(d.property.contact_name || d.property.contact_phone) && <p>Contacto: {[d.property.contact_name, d.property.contact_phone].filter(Boolean).join(" · ")}</p>}
                {d.property.access_notes && <p>Acceso: {d.property.access_notes}</p>}
                {d.accessInfo && <p>Indicaciones del pedido: {d.accessInfo}</p>}
              </div>
            ) : (
              <div className="space-y-2 text-[15px]">
                <p>{d.zoneName}</p>
                <p className="flex gap-2 text-sm text-muted"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Se revela cuando el pago esté aprobado.</p>
              </div>
            )}
          </Card>

          {isAdmin && status !== "completed" && status !== "cancelled" && (
            <Card>
              <CardHeader title="Técnico asignado" />
              <ActionForm action={assignTechnicianAction} className="space-y-3">
                <input type="hidden" name="jobId" value={id} />
                <Field label="Quién va" htmlFor="as-user">
                  <Select id="as-user" name="userId" defaultValue={job.assigned_user_id ?? ""}>
                    <option value="">Sin asignar (lo hago yo)</option>
                    {team.map((m) => <option key={m.user_id} value={m.user_id}>{m.full_name} · {m.role === "admin" ? "Administración" : "Técnico"}</option>)}
                  </Select>
                </Field>
                <SubmitButton variant="secondary" size="sm" pendingText="Guardando…">Guardar asignación</SubmitButton>
              </ActionForm>
            </Card>
          )}

          {isAdmin && money && (
            <Card>
              <CardHeader title="Dinero" action={anyTest ? <TestModeBadge /> : undefined} />
              <ProviderNetBreakdown grossMinor={money.grossProvider} feeMinor={money.providerFees} netMinor={money.providerNet} rateBps={snap.amounts.providerRateBps} adjustmentsMinor={d.payout?.adjustments_minor ?? 0} />
              {money.grossProvider === 0 && <p className="mt-1 text-sm text-muted">Todavía no hay pagos aprobados. Neto previsto según lo acordado: {formatMoney(job.provider_net_minor)}.</p>}
              <h3 className="mt-4 text-sm font-semibold text-muted">Pagos del cliente</h3>
              {d.charges.length === 0 ? <p className="text-sm text-muted">Sin pagos registrados.</p> : (
                <ul className="mt-1 space-y-1 text-sm">
                  {d.charges.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>{chargeKindLabel[c.kind] ?? c.kind} · {formatMoney(c.amount_minor)}</span>
                      <StatusBadge status={c.status} labels={chargeStatusLabel} />
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="mt-4 text-sm font-semibold text-muted">Liquidación</h3>
              {d.payout ? (
                <div className="mt-1 space-y-1 text-sm">
                  <p className="flex flex-wrap items-center gap-2"><StatusBadge status={d.payout.status} labels={payoutStatusLabel} /> {formatMoney(d.payout.amount_minor)}</p>
                  {d.payout.on_hold && <p className="text-warn">En pausa: {d.payout.hold_reason ?? "en revisión"}</p>}
                  {d.payout.paid_at && <p>Liquidada {formatDateTime(d.payout.paid_at)}</p>}
                  {d.payout.scheduled_for && !d.payout.paid_at && <p>Programada para {formatDate(d.payout.scheduled_for)}</p>}
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">Se genera cuando el cliente da conformidad. Pago aprobado no es lo mismo que liquidación realizada.</p>
              )}
            </Card>
          )}

          {isAdmin && status === "pending_confirmation" && (
            <Card>
              <CardHeader title="Cancelar" description="Solo antes de confirmar. Si el cliente pagó, se le reintegra el total." />
              <ConfirmAction action={cancelJobAction} label="Cancelar trabajo" variant="danger" title="¿Cancelar este trabajo?" description="El cliente recibe el reintegro total de lo pagado. Esta acción no se puede deshacer." requireReason hidden={{ jobId: id }} confirmLabel="Cancelar trabajo" />
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}

function StepButton({ jobId, step, label, variant = "primary" }: { jobId: string; step: string; label: string; variant?: "primary" | "secondary" }) {
  return (
    <ActionForm action={jobStepAction}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="step" value={step} />
      <SubmitButton variant={variant} pendingText="Guardando…">{label}</SubmitButton>
    </ActionForm>
  );
}

function DecideButton({ rescheduleId, jobId, decision, label, variant = "primary" }: { rescheduleId: string; jobId: string; decision: string; label: string; variant?: "primary" | "secondary" }) {
  return (
    <ActionForm action={decideRescheduleAction}>
      <input type="hidden" name="rescheduleId" value={rescheduleId} />
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="decision" value={decision} />
      <SubmitButton variant={variant} size="sm" pendingText="Guardando…">{label}</SubmitButton>
    </ActionForm>
  );
}
