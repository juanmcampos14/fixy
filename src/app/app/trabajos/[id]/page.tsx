import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, CreditCard, FileText, MapPin, RotateCcw, Star, UserRound } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { getJobDetail, jobMoney } from "@/server/queries/shared";
import { chargeKindLabel, chargeStatusLabel, disputeReasonLabel, disputeStatusLabel, jobStatusLabel, modeLabel } from "@/server/domain/labels";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/card";
import { Badge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Mascot } from "@/components/brand/mascot";
import { ClientPriceBreakdown } from "@/components/domain/price";
import { MessageThread } from "@/components/domain/messages";
import { Timeline } from "@/components/domain/timeline";
import { EvidenceGallery } from "@/components/domain/evidence";
import { formatDate, formatDateTime, formatMoney, todayInBuenosAires } from "@/lib/format";
import { RatingInput } from "@/components/client/rating-input";
import { retryChargeAction } from "@/app/pagos/prueba/[ref]/actions";
import {
  approveAndReviewAction, cancelJobAction, createReviewAction, decideExtraAction, decideRescheduleAction, openDisputeAction, proposeRescheduleAction,
} from "../../actions";

export const metadata = { title: "Trabajo" };

export default async function ClientJob({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ pago?: string }> }) {
  const { id } = await params;
  const { pago } = await searchParams;
  const actor = await requireActor(`/app/trabajos/${id}`);
  const d = await getJobDetail(actor.id, id);
  if (!d) notFound();
  const { job, request, provider } = d;
  const money = jobMoney(d);
  const snap = job.contract_snapshot;
  const pendingCharges = d.charges.filter((c) => c.status === "pending");
  const lastFailed = [...d.charges].reverse().find((c) => c.status === "failed");
  const hasLiveForFailed = lastFailed && d.charges.some((c) => c.kind === lastFailed.kind && c.extra_id === lastFailed.extra_id && c.status !== "failed");
  const openDispute = d.disputes.find((x) => ["open", "in_review", "awaiting_response"].includes(x.status));
  const proposedExtras = d.extras.filter((e) => e.status === "proposed");
  const openReschedule = d.reschedules.find((r) => r.status === "proposed");
  const canReschedule = ["pending_confirmation", "confirmed", "on_the_way"].includes(job.status);
  const isTest = d.charges.some((c) => c.is_test);
  const path = `/app/trabajos/${id}`;

  return (
    <>
      <PageHeader
        back={<Link href="/app/trabajos" className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Trabajos</Link>}
        eyebrow={`${job.code} · ${request.code}`}
        title={request.title}
        description={<>Con <Link className="font-semibold text-ink underline" href={`/profesionales/${provider.slug}`}>{provider.display_name}</Link> · {modeLabel[job.mode]}</>}
        action={<StatusBadge status={job.status} labels={jobStatusLabel} className="text-sm" />}
      />

      {pago === "procesado" && (pendingCharges.length === 0
        ? <Alert tone="ok" className="mb-6" title="Pago registrado">La pasarela confirmó el pago{isTest ? " (modo de prueba)" : ""}. Un pago aprobado no implica que el trabajo esté terminado.</Alert>
        : <Alert tone="info" className="mb-6" title="Estamos esperando la confirmación de la pasarela">Actualizá en unos segundos.</Alert>)}
      {pago === "rechazado" && <Alert tone="danger" className="mb-6" title="El pago no se pudo completar">No se cobró nada. Podés reintentarlo cuando quieras.</Alert>}

      {/* Acciones pendientes */}
      <div className="mb-6 space-y-4">
        {pendingCharges.map((c) => (
          <Card key={c.id} className="flex flex-wrap items-center justify-between gap-4 ring-2 ring-warn/30">
            <div>
              <p className="flex items-center gap-2 font-bold"><CreditCard className="h-5 w-5 text-warn" aria-hidden />Pago pendiente · {chargeKindLabel[c.kind]}</p>
              <p className="mt-0.5 text-ink-2">Vas a pagar <strong>{formatMoney(c.amount_minor)}</strong> en total. Incluye {formatMoney(c.client_fee_minor + c.tax_minor)} de cargo de servicio.</p>
              {c.kind === "job_total" || c.kind === "visit" ? <p className="text-sm text-muted">El profesional confirma el trabajo cuando se registra el pago.</p> : null}
            </div>
            <div className="flex items-center gap-2">{c.is_test && <TestModeBadge />}{c.checkout_url && <ButtonLink href={c.checkout_url}>Ir a pagar</ButtonLink>}</div>
          </Card>
        ))}
        {lastFailed && !hasLiveForFailed && job.status !== "cancelled" && (
          <Card className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-bold">El último pago no se completó</p>
              <p className="text-ink-2">{chargeKindLabel[lastFailed.kind]} · {formatMoney(lastFailed.amount_minor)}. No se cobró nada.</p>
            </div>
            <ActionForm action={retryChargeAction}><input type="hidden" name="chargeId" value={lastFailed.id} /><SubmitButton>Reintentar pago</SubmitButton></ActionForm>
          </Card>
        )}

        {job.visit_code && !(job as { checked_in_at?: Date | null }).checked_in_at && ["confirmed", "on_the_way"].includes(job.status) && (
          <Card className="flex flex-wrap items-center gap-4 ring-2 ring-fixy-500/30">
            <div className="grid h-16 min-w-28 place-items-center rounded-2xl bg-ink px-4 font-display text-3xl font-extrabold tracking-[0.25em] text-white" aria-label={`Código de visita ${job.visit_code.split("").join(" ")}`}>{job.visit_code}</div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">Tu código de visita</h2>
              <p className="text-ink-2">Dáselo al profesional cuando llegue: así queda registrado que la visita ocurrió. No lo compartas antes.</p>
            </div>
          </Card>
        )}

        {proposedExtras.map((e) => (
          <Card key={e.id} className="ring-2 ring-warn/30">
            <CardHeader title={(e as { is_main_quote?: boolean }).is_main_quote ? "Presupuesto del arreglo" : "El profesional propone un adicional"} description={(e as { is_main_quote?: boolean }).is_main_quote ? "El profesional vio el problema y te presupuesta el arreglo. No se hace ni se cobra nada hasta que lo apruebes." : "No se cobra nada hasta que lo aceptes. Si lo rechazás, el trabajo sigue según lo contratado."} />
            <p className="font-semibold">{e.description}</p>
            <p className="mt-1 text-[15px] text-ink-2"><span className="font-semibold">Por qué:</span> {e.reason}</p>
            <ClientPriceBreakdown className="mt-3" title={null} discountMinor={(e as { discount_minor?: number }).discount_minor ?? 0} a={{ laborMinor: e.labor_minor, materialsMinor: e.materials_minor, visitMinor: 0, clientFeeMinor: e.client_fee_minor, clientFeeTaxMinor: e.client_fee_tax_minor, totalMinor: e.total_minor, clientRateBps: snap.amounts.clientRateBps }} />
            <div className="mt-4 flex flex-wrap gap-2">
              <ConfirmAction action={decideExtraAction} label={(e as { is_main_quote?: boolean }).is_main_quote ? "Aprobar presupuesto" : "Aceptar adicional"} title={(e as { is_main_quote?: boolean }).is_main_quote ? "Aprobar el presupuesto del arreglo" : "Aceptar el adicional"} confirmLabel={e.total_minor > 0 ? `Aprobar y pagar ${formatMoney(e.total_minor)}` : "Aprobar"}
                description={<>Vas a pagar <strong>{formatMoney(e.total_minor)}</strong> adicionales, en un cobro separado{isTest ? " (modo de prueba)" : ""}.</>}
                hidden={{ extraId: e.id, jobId: id, decision: "accepted", totalMinor: e.total_minor }} />
              <ConfirmAction action={decideExtraAction} variant="secondary" label="Rechazar" title="Rechazar el adicional" confirmLabel="Rechazar adicional" requireReason reasonLabel="Contale al profesional por qué"
                hidden={{ extraId: e.id, jobId: id, decision: "rejected", totalMinor: e.total_minor }} />
            </div>
          </Card>
        ))}

        {openReschedule && (
          <Card className="ring-2 ring-info/20">
            <CardHeader title="Propuesta de reprogramación" description={`Propuesta por ${openReschedule.proposer ?? (openReschedule.proposed_side === "client" ? "vos" : "el profesional")}`} />
            <p>Nueva fecha: <strong>{formatDate(openReschedule.new_date)}</strong>{openReschedule.new_window && ` · ${openReschedule.new_window}`} {openReschedule.previous_date && <span className="text-muted">(antes: {formatDate(openReschedule.previous_date)})</span>}</p>
            <p className="mt-1 text-ink-2">Motivo: {openReschedule.reason}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {openReschedule.proposed_side === "provider" ? (
                <>
                  <ConfirmAction action={decideRescheduleAction} label="Aceptar nueva fecha" title="Aceptar la reprogramación" confirmLabel="Aceptar" hidden={{ rescheduleId: openReschedule.id, jobId: id, decision: "accepted" }} />
                  <ConfirmAction action={decideRescheduleAction} variant="secondary" label="No me sirve" title="Rechazar la reprogramación" confirmLabel="Rechazar" hidden={{ rescheduleId: openReschedule.id, jobId: id, decision: "rejected" }} />
                </>
              ) : (
                <ConfirmAction action={decideRescheduleAction} variant="secondary" label="Retirar mi propuesta" title="Retirar la propuesta" confirmLabel="Retirar" hidden={{ rescheduleId: openReschedule.id, jobId: id, decision: "withdrawn" }} />
              )}
            </div>
          </Card>
        )}

        {job.status === "pending_approval" && !openDispute && (
          <Card className="ring-2 ring-fixy-500/30">
            <CardHeader title="El profesional informó que terminó" description="Revisá el trabajo y los avances. Si quedó como se acordó, confirmalo y calificalo: tu reseña es necesaria para liberar el pago al profesional." />
            <ActionForm action={approveAndReviewAction} className="space-y-4">
              <input type="hidden" name="jobId" value={id} />
              <RatingInput />
              <Field label="Comentario" htmlFor="approve-comment" hint="Se publica sin tu nombre, días después, para que puedas opinar con libertad.">
                <Textarea id="approve-comment" name="comment" maxLength={2000} rows={3} />
              </Field>
              <div className="flex flex-wrap gap-2">
                <SubmitButton pendingText="Confirmando…">Confirmar y calificar</SubmitButton>
                <a href="#reclamo" className="inline-flex h-11 items-center rounded-full px-5 font-semibold text-ink ring-1 ring-inset ring-line hover:bg-cream-2">Algo no quedó bien</a>
              </div>
            </ActionForm>
          </Card>
        )}

        {job.status === "completed" && (
          <Card className="flex flex-wrap items-center gap-4">
            <Mascot pose="celebrate" className="h-24 w-auto" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">¡Trabajo completado!</h2>
              <p className="text-ink-2">Quedó guardado en el historial de {d.property?.label ?? "tu propiedad"}.</p>
            </div>
            <ButtonLink variant="secondary" href={`/solicitar?antecedente=${id}&proveedor=${provider.slug}`}><RotateCcw className="h-4 w-4" aria-hidden />Volver a contratar</ButtonLink>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.45fr_1fr]">
        <div className="space-y-6">
          {/* Contrato */}
          <Card>
            <CardHeader title="Lo que contrataste" description={`Copia inmutable del presupuesto aceptado el ${formatDateTime(snap.acceptedAt)}`} />
            <p className="whitespace-pre-line text-[15px]">{snap.quote.scope}</p>
            <ul className="mt-3 space-y-1 text-sm">
              {snap.items.map((i, n) => <li key={n} className="flex justify-between gap-3"><span>{i.description}{i.quantity > 1 && ` × ${i.quantity}`}</span><span className="tabular text-muted">{formatMoney(i.amount_minor)}</span></li>)}
            </ul>
            <p className="mt-3 text-sm">{snap.quote.materialsIncluded ? "Incluye los materiales detallados." : "No incluye materiales."}{snap.quote.exclusions && <> <span className="font-semibold">No incluye:</span> {snap.quote.exclusions}</>}</p>
            <ClientPriceBreakdown className="mt-4" a={{ ...snap.amounts }} title="Precio confirmado" />
            <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-fixy-800">Condiciones de cancelación y reembolso</summary><p className="mt-1 text-ink-2">{snap.cancellationTerms}</p></details>
          </Card>

          <Card>
            <CardHeader title="Avances y evidencias" />
            <EvidenceGallery items={d.evidence} />
          </Card>

          <Card>
            <CardHeader title="Mensajes" description="Coordiná con el profesional por acá: todo queda registrado." />
            {d.conversationId ? <MessageThread conversationId={d.conversationId} messages={d.messages} path={path} disabled={job.status === "cancelled"} /> : <p className="text-muted">Sin conversación.</p>}
          </Card>

          {/* Reclamo */}
          <Card id="reclamo">
            <CardHeader title="Reclamos" description="Si algo no quedó bien, contanos qué pasó. Vamos a revisar el caso." />
            {d.disputes.length > 0 && (
              <ul className="mb-4 space-y-2">
                {d.disputes.map((x) => (
                  <li key={x.id}><Link href={`/app/reclamos/${x.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-cream/60 p-3 ring-1 ring-line hover:ring-fixy-500">
                    <span><span className="font-semibold">{disputeReasonLabel[x.reason_code]}</span><span className="block text-sm text-muted">{formatDate(x.created_at)}</span></span>
                    <StatusBadge status={x.status} labels={disputeStatusLabel} />
                  </Link></li>
                ))}
              </ul>
            )}
            {!openDispute && ["confirmed", "on_the_way", "in_progress", "pending_approval", "completed"].includes(job.status) && (
              <details>
                <summary className="cursor-pointer font-semibold text-fixy-800">Abrir un reclamo</summary>
                <ActionForm action={openDisputeAction} className="mt-4 space-y-4">
                  <input type="hidden" name="jobId" value={id} />
                  <Field label="Motivo" htmlFor="reasonCode" required>
                    <Select id="reasonCode" name="reasonCode" required defaultValue="">
                      <option value="" disabled>Elegí un motivo</option>
                      {Object.entries(disputeReasonLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </Field>
                  <Field label="Contanos qué pasó" htmlFor="description" required>
                    <Textarea id="description" name="description" required minLength={10} maxLength={4000} />
                  </Field>
                  <Field label="Evidencia" htmlFor="dispute-file" hint="Foto o PDF (máx. 8 MB).">
                    <input id="dispute-file" type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block text-sm" />
                  </Field>
                  <p className="text-sm text-muted">Mientras se revisa el reclamo, la liquidación al profesional queda en pausa. No ofrecemos devoluciones automáticas: cada caso lo resuelve el equipo.</p>
                  <SubmitButton>Enviar reclamo</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Card>

          {job.status === "completed" && (
            <Card>
              <CardHeader title="Tu reseña" />
              {d.review ? (
                <div>
                  <p className="flex items-center gap-1" aria-label={`${d.review.rating} de 5`}>{Array.from({ length: 5 }, (_, i) => <Star key={i} className={i < d.review!.rating ? "h-5 w-5 fill-spark text-spark" : "h-5 w-5 text-line"} aria-hidden />)}</p>
                  {d.review.comment && <p className="mt-2">{d.review.comment}</p>}
                  <p className="mt-2 text-xs text-muted">Tu reseña se publica de forma anónima, en los próximos días. Solo vos la ves con tu nombre.</p>
                  {d.review.provider_reply && <p className="mt-2 rounded-xl bg-cream/60 p-3 text-sm"><span className="font-semibold">Respuesta del profesional:</span> {d.review.provider_reply}</p>}
                </div>
              ) : (
                <ActionForm action={createReviewAction} className="space-y-4">
                  <input type="hidden" name="jobId" value={id} />
                  <Alert tone="warn">Tu reseña es necesaria para liberar el pago al profesional. Se publica sin tu nombre y días después, así podés opinar con libertad.</Alert>
                  <fieldset>
                    <legend className="text-[15px] font-semibold">¿Cómo calificarías el trabajo?</legend>
                    <div className="mt-2 flex flex-row-reverse justify-end gap-1">
                      {[5, 4, 3, 2, 1].map((n) => (
                        <label key={n} className="cursor-pointer">
                          <input type="radio" name="rating" value={n} required className="peer sr-only" />
                          <span className="grid h-11 w-11 place-items-center rounded-full ring-1 ring-line peer-checked:bg-spark-100 peer-checked:ring-spark peer-focus-visible:ring-3 peer-focus-visible:ring-fixy-500/40" aria-label={`${n} estrella${n > 1 ? "s" : ""}`}>
                            <span aria-hidden className="font-bold">{n}★</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <Field label="Comentario" htmlFor="comment"><Textarea id="comment" name="comment" maxLength={2000} rows={3} /></Field>
                  <SubmitButton>Publicar reseña</SubmitButton>
                </ActionForm>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Coordinación" />
            <DefinitionList items={[
              [<span key="d" className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" aria-hidden />Fecha acordada</span>, job.scheduled_date ? `${formatDate(job.scheduled_date)}${job.scheduled_window ? ` · ${job.scheduled_window}` : ""}` : "A coordinar"],
              [<span key="l" className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" aria-hidden />Lugar</span>, d.property ? `${d.property.label} · ${d.property.address_line}` : d.zoneName],
              [<span key="t" className="inline-flex items-center gap-1.5"><UserRound className="h-4 w-4" aria-hidden />Técnico</span>, d.technicianName ?? provider.display_name],
            ]} />
            {canReschedule && !openReschedule && (
              <details className="mt-4">
                <summary className="cursor-pointer font-semibold text-fixy-800">Proponer otra fecha</summary>
                <ActionForm action={proposeRescheduleAction} className="mt-3 space-y-3">
                  <input type="hidden" name="jobId" value={id} />
                  <Field label="Nueva fecha" htmlFor="newDate" required><Input id="newDate" name="newDate" type="date" min={todayInBuenosAires()} required /></Field>
                  <Field label="Franja" htmlFor="newWindow"><Input id="newWindow" name="newWindow" placeholder="Ej.: mañana" maxLength={60} /></Field>
                  <Field label="Motivo" htmlFor="rs-reason" required><Input id="rs-reason" name="reason" required minLength={3} /></Field>
                  <SubmitButton size="sm">Enviar propuesta</SubmitButton>
                </ActionForm>
              </details>
            )}
          </Card>

          <Card>
            <CardHeader title="Pagos" action={isTest ? <TestModeBadge /> : undefined} />
            <DefinitionList items={[
              ["Total acordado", <span key="a" className="tabular">{formatMoney(money.agreed)}</span>],
              ["Pagado", <span key="p" className="tabular">{formatMoney(money.paid)}</span>],
              ["Saldo pendiente", <span key="s" className="tabular">{formatMoney(money.balance)}</span>],
              ...(money.refunded ? [["Reembolsado", <span key="r" className="tabular">{formatMoney(money.refunded)}</span>] as [string, React.ReactNode]] : []),
            ]} />
            <h3 className="mt-4 text-sm font-semibold text-muted">Movimientos</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {d.charges.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span>{chargeKindLabel[c.kind]} · {formatMoney(c.amount_minor)}<span className="block text-xs text-muted">{formatDateTime(c.created_at)}</span></span>
                  <span className="flex items-center gap-2">
                    <StatusBadge status={c.status} labels={chargeStatusLabel} />
                    {["approved", "partially_refunded", "refunded"].includes(c.status) && <Link href={`/app/pagos/${c.id}`} className="text-fixy-800 underline" aria-label="Ver comprobante"><FileText className="h-4 w-4" aria-hidden /></Link>}
                  </span>
                </li>
              ))}
              {d.refunds.map((r) => (
                <li key={r.id} className="flex justify-between gap-2 text-ok"><span>Reembolso · {r.reason}</span><span className="tabular">− {formatMoney(r.amount_minor)}</span></li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Los comprobantes de pago no son facturas fiscales. Fixy no custodia fondos: el pago se procesa a través de la pasarela.</p>
          </Card>

          {job.status === "pending_confirmation" && (
            <Card>
              <CardHeader title="¿Necesitás cancelar?" description="Mientras el profesional no confirme, podés cancelar sin cargo. Si ya pagaste, se reintegra el total." />
              <ConfirmAction action={cancelJobAction} variant="danger" label="Cancelar trabajo" title="Cancelar el trabajo" confirmLabel="Cancelar trabajo" requireReason hidden={{ jobId: id }} />
            </Card>
          )}
          {["confirmed", "on_the_way", "in_progress"].includes(job.status) && (
            <p className="text-sm text-muted">Para cancelar un trabajo ya confirmado, escribile al profesional o abrí un reclamo: lo gestiona el equipo de Fixy.</p>
          )}

          <Card>
            <CardHeader title="Línea de tiempo" />
            <Timeline events={d.events} />
          </Card>
          {provider && <p className="text-xs text-muted">Proveedor: {provider.display_name} {provider.identity_status === "verified" && <Badge tone="ok" icon={false}>Identidad verificada</Badge>}</p>}
        </div>
      </div>
    </>
  );
}

