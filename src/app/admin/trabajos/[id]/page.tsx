import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSection } from "@/server/auth/session";
import { getJobDetail, jobMoney } from "@/server/queries/shared";
import { jobMachine, type JobStatus } from "@/server/domain/state-machines";
import {
  chargeKindLabel, chargeStatusLabel, disputeReasonLabel, disputeStatusLabel, jobStatusLabelProvider, modeLabel, payoutStatusLabel, propertyKindLabel,
  quoteStatusLabel, urgencyLabel,
} from "@/server/domain/labels";
import { PageHeader, DefinitionList, Stat } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/form";
import { Timeline } from "@/components/domain/timeline";
import { MessageThread } from "@/components/domain/messages";
import { EvidenceGallery } from "@/components/domain/evidence";
import { ClientPriceBreakdown, ProviderNetBreakdown } from "@/components/domain/price";
import { BackLink, DataTable, Section, Td, Th } from "@/components/admin/ui";
import { formatDate, formatDateTime, formatMoney, minorToInput } from "@/lib/format";
import { cancelJobAction, moveJobAction, refundChargeAction } from "../../actions";

export const metadata = { title: "Trabajo" };

const EXTRA_STATUS: Record<string, string> = { proposed: "Propuesto", accepted: "Aceptado", rejected: "Rechazado", withdrawn: "Retirado" };
const RESCHEDULE_STATUS: Record<string, string> = EXTRA_STATUS;
const MOVE_HELP: Partial<Record<JobStatus, string>> = {
  completed: "Cierra el trabajo sin la conformidad del cliente y genera la liquidación pendiente al proveedor. Usalo solo con evidencia suficiente.",
  in_progress: "Devuelve el trabajo a ejecución (por ejemplo, si quedó algo por terminar). El cliente y el proveedor reciben el aviso.",
};

export default async function JobAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = (await requireSection("trabajos")).actor;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getJobDetail(actor.id, id);
  if (!d) notFound();
  const m = jobMoney(d);
  const { job } = d;
  const status = job.status as JobStatus;
  const staffMoves = (Object.entries(jobMachine[status] ?? {}) as [JobStatus, readonly string[]][])
    .filter(([to, sides]) => to !== "cancelled" && sides.includes("staff"))
    .map(([to]) => to);
  const canCancel = !!jobMachine[status]?.cancelled?.includes("staff");
  const anyTest = d.charges.some((c) => c.is_test);
  const a = job.contract_snapshot.amounts;
  const openDispute = d.disputes.find((x) => ["open", "in_review", "awaiting_response"].includes(x.status));

  return (
    <>
      <PageHeader
        back={<BackLink href="/admin/trabajos">Trabajos</BackLink>}
        eyebrow={<>{job.code} · <Link href={`/admin/solicitudes/${job.request_id}`} className="hover:underline">{d.request.code}</Link></>}
        title={d.request.title}
        description={<>Cliente: {d.clientName} · Proveedor: <Link href={`/admin/proveedores/${job.provider_id}`} className="font-semibold text-fixy-800 hover:underline">{d.provider?.display_name}</Link>{d.technicianName && ` · Técnico: ${d.technicianName}`}</>}
        action={
          <>
            {staffMoves.map((to) => (
              <ConfirmAction
                key={to}
                action={moveJobAction}
                label={`Pasar a «${jobStatusLabelProvider[to]}»`}
                variant="secondary"
                title={`Cambiar estado a «${jobStatusLabelProvider[to]}»`}
                description={MOVE_HELP[to]}
                confirmLabel="Cambiar estado"
                hidden={{ jobId: job.id, to }}
                requireReason
                reasonLabel="Motivo (lo ven cliente y proveedor)"
              />
            ))}
            {canCancel && (
              <ConfirmAction
                action={cancelJobAction}
                label="Cancelar trabajo"
                variant="danger"
                title="Cancelar el trabajo"
                description="Los cobros pendientes se anulan. Lo cobrado solo se reembolsa si lo marcás; también podés reembolsar cobros puntuales desde Pagos."
                confirmLabel="Cancelar trabajo"
                hidden={{ jobId: job.id }}
                requireReason
                reasonLabel="Motivo (lo ven cliente y proveedor)"
              >
                <label className="mt-4 flex items-start gap-3 text-[15px]">
                  <input type="checkbox" name="refundAll" className="mt-0.5 h-5 w-5 accent-fixy-700" />
                  <span>Reembolsar todo lo cobrado ({formatMoney(m.paid - m.refunded)}){anyTest && " · modo de prueba"}</span>
                </label>
              </ConfirmAction>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <StatusBadge status={job.status} labels={jobStatusLabelProvider} />
        <Badge tone="neutral" icon={false}>{modeLabel[job.mode] ?? job.mode}</Badge>
        {anyTest && <TestModeBadge />}
        {openDispute && <Link href={`/admin/reclamos/${openDispute.id}`}><Badge tone="warn">Reclamo abierto</Badge></Link>}
      </div>
      {job.cancel_reason && <Alert tone="info" className="mb-5" title="Motivo de cancelación">{job.cancel_reason}</Alert>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total pactado" value={formatMoney(m.agreed)} hint="Contrato + adicionales aceptados" />
        <Stat label="Cobrado (aprobado)" value={formatMoney(m.paid)} hint={m.pending ? `${formatMoney(m.pending)} pendiente de pago` : "Sin cobros pendientes"} tone="ok" />
        <Stat label="Reembolsado" value={formatMoney(m.refunded)} />
        <Stat label="Neto proveedor" value={formatMoney(m.providerNet)} hint={`Bruto ${formatMoney(m.grossProvider)} − comisión ${formatMoney(m.providerFees)}`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Section title="Pagos" description="Cobro aprobado no es trabajo completado. Los reembolsos se registran en la pasarela y en el registro financiero.">
            {d.charges.length === 0 ? <p className="text-sm text-muted">Sin cobros.</p> : (
              <DataTable caption="Cobros del trabajo" minWidth={640}>
                <thead><tr><Th>Concepto</Th><Th>Estado</Th><Th>Importe</Th><Th>Reembolsado</Th><Th>Acción</Th></tr></thead>
                <tbody>
                  {d.charges.map((c) => {
                    const refundable = c.amount_minor - c.refunded_minor;
                    return (
                      <tr key={c.id}>
                        <Td>
                          <span className="font-semibold">{chargeKindLabel[c.kind] ?? c.kind}</span>
                          <div className="text-xs text-muted">{c.external_reference} · {formatDateTime(c.created_at)}</div>
                          {c.is_test && <TestModeBadge className="mt-1" />}
                        </Td>
                        <Td><StatusBadge status={c.status} labels={chargeStatusLabel} /></Td>
                        <Td className="tabular">{formatMoney(c.amount_minor)}<div className="text-xs text-muted">Cargo cliente {formatMoney(c.client_fee_minor)} · comisión {formatMoney(c.provider_fee_minor)}</div></Td>
                        <Td className="tabular">{c.refunded_minor ? formatMoney(c.refunded_minor) : "—"}</Td>
                        <Td>
                          {["approved", "partially_refunded"].includes(c.status) && refundable > 0 ? (
                            <ConfirmAction
                              action={refundChargeAction}
                              label="Reembolsar"
                              size="sm"
                              variant="danger"
                              title={`Reembolsar ${chargeKindLabel[c.kind] ?? "cobro"}`}
                              description={<>Máximo reembolsable: <strong>{formatMoney(refundable)}</strong>.{c.is_test && " Modo de prueba: no se devuelve dinero real."} Si la liquidación no se pagó, se ajusta su neto.</>}
                              confirmLabel="Reembolsar"
                              hidden={{ chargeId: c.id, refundKey: crypto.randomUUID() }}
                              requireReason
                              reasonLabel="Motivo (lo ve el cliente)"
                            >
                              <div className="mt-4 space-y-1.5">
                                <label htmlFor={`amt-${c.id}`} className="block text-[15px] font-semibold">Importe a reembolsar (ARS)</label>
                                <input id={`amt-${c.id}`} name="amount" inputMode="decimal" required defaultValue={minorToInput(refundable)} className="block h-12 w-full rounded-xl border border-control px-3.5" aria-describedby={`amt-${c.id}-hint`} />
                                <p id={`amt-${c.id}-hint`} className="text-sm text-muted">Formato 12.500,50</p>
                              </div>
                            </ConfirmAction>
                          ) : <span className="text-sm text-muted">—</span>}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </DataTable>
            )}
            {d.refunds.length > 0 && (
              <>
                <h3 className="mb-1 mt-4 text-sm font-semibold text-muted">Reembolsos</h3>
                <ul className="divide-y divide-line text-[15px]">
                  {d.refunds.map((r) => (
                    <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2"><span>{r.reason}<span className="block text-xs text-muted">{formatDateTime(r.created_at)}</span></span><span className="tabular font-semibold">{formatMoney(r.amount_minor)}</span></li>
                  ))}
                </ul>
              </>
            )}
            <h3 className="mb-1 mt-4 text-sm font-semibold text-muted">Liquidación al proveedor</h3>
            {d.payout ? (
              <div className="rounded-2xl p-4 ring-1 ring-line">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={d.payout.status} labels={payoutStatusLabel} />
                  {d.payout.on_hold && <Badge tone="danger">Retenida{d.payout.hold_reason ? `: ${d.payout.hold_reason}` : ""}</Badge>}
                  {d.payout.is_test && <TestModeBadge />}
                </div>
                <ProviderNetBreakdown className="mt-2" grossMinor={d.payout.gross_minor} feeMinor={d.payout.fee_minor} netMinor={d.payout.gross_minor - d.payout.fee_minor} adjustmentsMinor={d.payout.adjustments_minor} />
                <p className="mt-2 text-sm text-muted">{d.payout.paid_at ? `Liquidada ${formatDateTime(d.payout.paid_at)}` : "Todavía no liquidada."} <Link href="/admin/finanzas?tab=liquidaciones" className="font-semibold text-fixy-800 hover:underline">Gestionar en Finanzas</Link></p>
              </div>
            ) : <p className="text-sm text-muted">Se genera cuando el trabajo se completa.</p>}
          </Section>

          <Section title="Contrato" description="Alcance y precio aceptados: no se modifican.">
            <p className="whitespace-pre-line text-[15px]">{job.contract_snapshot.quote.scope}</p>
            {job.contract_snapshot.quote.exclusions && <p className="mt-2 text-sm text-ink-2"><strong>No incluye:</strong> {job.contract_snapshot.quote.exclusions}</p>}
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <ClientPriceBreakdown a={a} title="Lo que paga el cliente" />
              <div>
                <h3 className="mb-1 text-sm font-semibold text-muted">Lo que recibe el proveedor</h3>
                <ProviderNetBreakdown grossMinor={a.subtotalMinor} feeMinor={a.providerFeeMinor} netMinor={a.providerNetMinor} rateBps={a.providerRateBps} />
              </div>
            </div>
            <p className="mt-3 text-sm text-muted">Condiciones de cancelación: {job.contract_snapshot.cancellationTerms}</p>
          </Section>

          {d.extras.length > 0 && (
            <Section title="Adicionales">
              <ul className="space-y-3">
                {d.extras.map((e) => (
                  <li key={e.id} className="rounded-2xl p-4 ring-1 ring-line">
                    <div className="flex flex-wrap justify-between gap-2">
                      <p className="font-semibold">{e.description}</p>
                      <Badge tone={e.status === "accepted" ? "ok" : e.status === "proposed" ? "warn" : "neutral"}>{EXTRA_STATUS[e.status] ?? e.status}</Badge>
                    </div>
                    <p className="text-sm text-ink-2">Motivo: {e.reason}</p>
                    <p className="tabular mt-1 text-sm">Total cliente {formatMoney(e.total_minor)} · neto proveedor {formatMoney(e.provider_net_minor)}</p>
                    {e.decision_note && <p className="mt-1 text-sm text-muted">Nota: {e.decision_note}</p>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Avances y evidencias">
            <EvidenceGallery items={d.evidence} />
          </Section>

          <Section title="Mensajes" description="Solo lectura: la conversación entre cliente y proveedor.">
            {d.conversationId ? (
              <MessageThread conversationId={d.conversationId} messages={d.messages} path={`/admin/trabajos/${job.id}`} disabled emptyText="Sin mensajes." />
            ) : <p className="text-sm text-muted">No hay conversación asociada.</p>}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Coordinación">
            <DefinitionList
              items={[
                ["Fecha", job.scheduled_date ? `${formatDate(job.scheduled_date)}${job.scheduled_window ? ` · ${job.scheduled_window}` : ""}` : "Sin fecha"],
                ["Urgencia", urgencyLabel[d.request.urgency] ?? d.request.urgency],
                ["Propiedad", d.property ? `${d.property.label} (${propertyKindLabel[d.property.kind] ?? d.property.kind})` : "—"],
                ["Dirección", d.property ? `${d.property.address_line}${d.property.address_extra ? `, ${d.property.address_extra}` : ""}` : "—"],
                ["Zona", d.zoneName],
                ["Contacto", d.property?.contact_name ? `${d.property.contact_name}${d.property.contact_phone ? ` · ${d.property.contact_phone}` : ""}` : "—"],
                ["Acceso", d.accessInfo ?? d.property?.access_notes ?? "—"],
                ["Contratado", formatDateTime(job.created_at)],
                ["Confirmado", job.confirmed_at ? formatDateTime(job.confirmed_at) : "—"],
                ["Completado", job.completed_at ? formatDateTime(job.completed_at) : "—"],
              ]}
            />
          </Section>

          {d.reschedules.length > 0 && (
            <Section title="Reprogramaciones">
              <ul className="divide-y divide-line text-[15px]">
                {d.reschedules.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>{r.previous_date ? `${formatDate(r.previous_date)} → ` : ""}{formatDate(r.new_date)}{r.new_window && ` · ${r.new_window}`}</span>
                      <Badge tone={r.status === "accepted" ? "ok" : r.status === "proposed" ? "warn" : "neutral"}>{RESCHEDULE_STATUS[r.status] ?? r.status}</Badge>
                    </div>
                    <p className="text-sm text-muted">Propuso {r.proposer ?? (r.proposed_side === "client" ? "el cliente" : "el proveedor")}: {r.reason}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Reclamos">
            {d.disputes.length === 0 ? <p className="text-sm text-muted">Sin reclamos.</p> : (
              <ul className="divide-y divide-line">
                {d.disputes.map((x) => (
                  <li key={x.id}>
                    <Link href={`/admin/reclamos/${x.id}`} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-2 hover:underline">
                      <span>{disputeReasonLabel[x.reason_code] ?? x.reason_code}<span className="block text-xs text-muted">{formatDateTime(x.created_at)}</span></span>
                      <StatusBadge status={x.status} labels={disputeStatusLabel} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {d.review && (
            <Section title="Reseña">
              <p className="font-semibold">{d.review.rating} de 5</p>
              {d.review.comment && <p className="text-[15px]">{d.review.comment}</p>}
              {d.review.provider_reply && <p className="mt-2 text-sm text-muted">Respuesta: {d.review.provider_reply}</p>}
            </Section>
          )}

          <Section title="Historial del trabajo">
            <Timeline events={d.events} kind="job" audience="staff" />
          </Section>
          <Section title="Historial de la solicitud">
            <Timeline events={d.requestEvents} kind="request" />
            <p className="mt-3 text-xs text-muted">Presupuesto aceptado: {quoteStatusLabel.accepted} · {formatDateTime(job.contract_snapshot.acceptedAt)}</p>
          </Section>
        </div>
      </div>
    </>
  );
}
