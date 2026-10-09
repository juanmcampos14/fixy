import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock, Paperclip } from "lucide-react";
import { requireSection } from "@/server/auth/session";
import { getDisputeAdmin } from "@/server/queries/admin";
import { disputeMachine, type DisputeStatus } from "@/server/domain/state-machines";
import {
  chargeKindLabel, chargeStatusLabel, disputeReasonLabel, disputeResolutionLabel, disputeStatusLabel, jobStatusLabelProvider, payoutStatusLabel,
} from "@/server/domain/labels";
import { PageHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Textarea } from "@/components/ui/field";
import { BackLink, Section } from "@/components/admin/ui";
import { AuditEntries, EntityHistory } from "@/components/admin/history";
import { formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import { moveDisputeAction, replyDisputeAction, resolveDisputeAction } from "../../actions";

export const metadata = { title: "Reclamo" };

const MOVE_LABEL: Record<string, { label: string; description: string }> = {
  in_review: { label: "Tomar en revisión", description: "El caso queda asignado a vos y en revisión." },
  awaiting_response: { label: "Pedir respuesta", description: "Quedás esperando información de alguna de las partes. Cuando respondan, vuelve a revisión." },
  closed: { label: "Cerrar", description: "Cierra el caso sin más cambios. No se puede reabrir." },
};
const SIDE: Record<string, string> = { client: "Cliente", provider: "Proveedor", platform: "Equipo Fixy" };

export default async function DisputeAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = (await requireSection("reclamos")).actor;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getDisputeAdmin(actor.id, id);
  if (!data) notFound();
  const { d, job, messages, charges, refunds, payout, events, audits } = data;
  const status = d.status as DisputeStatus;
  const moves = (["in_review", "awaiting_response", "closed"] as const).filter((to) => disputeMachine[status]?.[to]?.includes("staff"));
  const canResolve = !!disputeMachine[status]?.resolved?.includes("staff");
  const refundable = charges.filter((c) => ["approved", "partially_refunded"].includes(c.status)).reduce((s, c) => s + c.amount_minor - c.refunded_minor, 0);
  const anyTest = charges.some((c) => c.is_test);
  const path = `/admin/reclamos/${d.id}`;

  return (
    <>
      <PageHeader
        back={<BackLink href="/admin/reclamos">Reclamos</BackLink>}
        eyebrow={<>Reclamo · <Link href={`/admin/trabajos/${job.id}`} className="hover:underline">{job.code}</Link></>}
        title={disputeReasonLabel[d.reason_code] ?? d.reason_code}
        description={<>Abierto por {d.opened_by_name} ({SIDE[d.opened_side]}) · {formatDateTime(d.created_at)}{d.assigned_name && ` · Asignado a ${d.assigned_name}`}</>}
        action={
          <>
            {moves.map((to) => (
              <ConfirmAction
                key={to}
                action={moveDisputeAction}
                label={MOVE_LABEL[to].label}
                variant={to === "closed" ? "danger" : "secondary"}
                title={MOVE_LABEL[to].label}
                description={MOVE_LABEL[to].description}
                confirmLabel={MOVE_LABEL[to].label}
                hidden={{ disputeId: d.id, to }}
                requireReason
                reasonLabel="Nota (queda en el historial)"
              />
            ))}
            {canResolve && (
              <ConfirmAction
                action={resolveDisputeAction}
                label="Resolver"
                title="Resolver el reclamo"
                description={<>Se notifica a ambas partes. Reembolsable ahora: <strong>{formatMoney(refundable)}</strong>{anyTest && " (modo de prueba: no se devuelve dinero real)"}. Si no hay reembolso total, se libera la retención de la liquidación.</>}
                confirmLabel="Resolver"
                hidden={{ disputeId: d.id }}
                requireReason
                reasonLabel="Explicación de la resolución (mínimo 10 caracteres; la ven ambas partes)"
              >
                <div className="mt-4 space-y-1.5">
                  <label htmlFor="res-kind" className="block text-[15px] font-semibold">Resolución</label>
                  <select id="res-kind" name="resolution" required defaultValue="" className="block h-12 w-full rounded-xl border border-[#d3dfdc] bg-white px-3.5">
                    <option value="" disabled>Elegí una resolución</option>
                    {Object.entries(disputeResolutionLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="mt-4 space-y-1.5">
                  <label htmlFor="res-amount" className="block text-[15px] font-semibold">Importe a reembolsar (solo reembolso parcial)</label>
                  <input id="res-amount" name="refund" inputMode="decimal" placeholder="12.500,50" className="block h-12 w-full rounded-xl border border-[#d3dfdc] px-3.5" />
                  <p className="text-sm text-muted">El reembolso total devuelve {formatMoney(refundable)} sin necesidad de indicar importe.</p>
                </div>
                {job.status === "pending_approval" && (
                  <label className="mt-4 flex items-start gap-3 text-[15px]">
                    <input type="checkbox" name="completeJob" className="mt-0.5 h-5 w-5 accent-fixy-700" />
                    <span>Dar el trabajo por completado (genera la liquidación pendiente). No aplica si la resolución es rehacer el trabajo.</span>
                  </label>
                )}
              </ConfirmAction>
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <StatusBadge status={d.status} labels={disputeStatusLabel} />
        {d.resolution && <Badge tone="ok">{disputeResolutionLabel[d.resolution]}</Badge>}
        {payout?.on_hold && <Badge tone="danger">Liquidación retenida</Badge>}
      </div>
      {d.resolution_note && <Alert tone="ok" className="mb-5" title={`Resolución${d.resolved_at ? ` · ${formatDateTime(d.resolved_at)}` : ""}${d.resolved_by_name ? ` · ${d.resolved_by_name}` : ""}`}>{d.resolution_note}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Section title="Descripción del reclamo">
            <p className="whitespace-pre-line text-[15px]">{d.description}</p>
          </Section>

          <Section title="Conversación" description="Las notas internas solo las ve el equipo de Fixy.">
            {messages.length === 0 ? <p className="text-sm text-muted">Sin mensajes todavía.</p> : (
              <ol className="space-y-3">
                {messages.map((m) => (
                  <li key={m.id} className={cn("rounded-2xl px-4 py-3 text-[15px]", m.internal ? "bg-warn-bg/60 ring-1 ring-warn/20" : m.author_side === "platform" ? "bg-info-bg" : "bg-cream-2")}>
                    <p className="mb-0.5 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-ink-2">
                      {m.author_name} · {SIDE[m.author_side] ?? m.author_side}
                      {m.internal && <span className="inline-flex items-center gap-1 text-warn"><Lock className="h-3.5 w-3.5" aria-hidden />Nota interna</span>}
                    </p>
                    <p className="whitespace-pre-line break-words">{m.body}</p>
                    {m.file_url && <a href={m.file_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 underline"><Paperclip className="h-3.5 w-3.5" aria-hidden />{m.file_name}</a>}
                    <p className="mt-1 text-[11px] text-muted">{formatDateTime(m.created_at)}</p>
                  </li>
                ))}
              </ol>
            )}
            {d.status !== "closed" && (
              <ActionForm action={replyDisputeAction} className="mt-5 space-y-3" resetOnSuccess>
                <input type="hidden" name="disputeId" value={d.id} />
                <input type="hidden" name="path" value={path} />
                <Field label="Respuesta" htmlFor="reply-body" required>
                  <Textarea id="reply-body" name="body" required maxLength={4000} placeholder="Escribí una respuesta clara para las partes, o una nota interna." />
                </Field>
                <div className="space-y-1.5">
                  <label htmlFor="reply-file" className="block text-[15px] font-semibold">Adjunto <span className="text-sm font-normal text-muted">(opcional)</span></label>
                  <input id="reply-file" type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block text-sm" />
                </div>
                <Checkbox name="internal" label="Nota interna (no la ven el cliente ni el proveedor)" />
                <SubmitButton pendingText="Enviando…">Enviar</SubmitButton>
              </ActionForm>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Trabajo">
            <DefinitionList
              items={[
                ["Trabajo", <Link key="j" href={`/admin/trabajos/${job.id}`} className="text-fixy-800 hover:underline">{job.code} · {job.title}</Link>],
                ["Estado", <StatusBadge key="s" status={job.status} labels={jobStatusLabelProvider} />],
                ["Proveedor", <Link key="p" href={`/admin/proveedores/${job.provider_id}`} className="text-fixy-800 hover:underline">{job.provider_name}</Link>],
                ["Cliente", job.client_name],
                ["Total pactado", formatMoney(job.total_minor)],
                ["Completado", job.completed_at ? formatDateTime(job.completed_at) : "—"],
              ]}
            />
          </Section>

          <Section title="Dinero" description={anyTest ? "Modo de prueba: importes simulados." : undefined}>
            <ul className="divide-y divide-line text-[15px]">
              {charges.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{chargeKindLabel[c.kind] ?? c.kind} <StatusBadge status={c.status} labels={chargeStatusLabel} /></span>
                  <span className="tabular">{formatMoney(c.amount_minor)}{c.refunded_minor > 0 && <span className="block text-right text-xs text-muted">Reembolsado {formatMoney(c.refunded_minor)}</span>}</span>
                </li>
              ))}
            </ul>
            {charges.length === 0 && <p className="text-sm text-muted">Sin cobros.</p>}
            {refunds.length > 0 && (
              <p className="mt-2 text-sm text-ink-2">Reembolsos por este reclamo: <strong>{formatMoney(refunds.reduce((s, r) => s + r.amount_minor, 0))}</strong></p>
            )}
            <h3 className="mb-1 mt-4 text-sm font-semibold text-muted">Liquidación al proveedor</h3>
            {payout ? (
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={payout.status} labels={payoutStatusLabel} />
                {payout.on_hold ? <Badge tone="danger">Retenida{payout.hold_reason ? `: ${payout.hold_reason}` : ""}</Badge> : <Badge tone="ok">Sin retención</Badge>}
                {payout.is_test && <TestModeBadge />}
                <span className="tabular text-sm">{formatMoney(payout.amount_minor)}</span>
              </div>
            ) : <p className="text-sm text-muted">Todavía no hay liquidación (se genera al completar el trabajo; si hay un reclamo abierto nace retenida).</p>}
          </Section>

          <Section title="Historial">
            <EntityHistory events={events} labels={disputeStatusLabel} />
          </Section>
          <Section title="Auditoría">
            <AuditEntries rows={audits} />
          </Section>
        </div>
      </div>
    </>
  );
}
