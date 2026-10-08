import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Paperclip } from "lucide-react";
import { getDisputeForProvider, requireProviderContext } from "@/server/queries/provider";
import { disputeReasonLabel, disputeResolutionLabel, disputeStatusLabel } from "@/server/domain/labels";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Textarea } from "@/components/ui/field";
import { Timeline } from "@/components/domain/timeline";
import { replyDisputeAction } from "../../actions";

export const metadata: Metadata = { title: "Reclamo" };

const SIDE: Record<string, string> = { client: "Cliente", provider: "Tu equipo", platform: "Equipo de Fixy" };

export default async function DisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { actor } = await requireProviderContext({ adminOnly: true });
  const data = await getDisputeForProvider(actor.id, id);
  if (!data) notFound();
  const { dispute, job, messages, events } = data;
  if (!actor.providers.some((p) => p.id === job.provider_id && p.role === "admin")) notFound();
  const closed = dispute.status === "closed";
  // El componente Timeline etiqueta estados de trabajos; para reclamos traducimos acá.
  const disputeEvents = events.map((e) => ({
    ...e,
    action:
      e.action === "status" ? `Estado: ${disputeStatusLabel[e.to_state ?? ""] ?? e.to_state}`
      : e.action === "opened" ? "Reclamo abierto"
      : e.action === "resolved" ? "Reclamo resuelto"
      : e.action,
  }));
  return (
    <>
      <PageHeader
        back={<Link href={`/proveedor/trabajos/${job.id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800"><ArrowLeft className="h-4 w-4" aria-hidden /> Trabajo {job.code}</Link>}
        eyebrow={`Reclamo · ${job.code}`}
        title={disputeReasonLabel[dispute.reason_code] ?? dispute.reason_code}
        description={job.title}
        action={<StatusBadge status={dispute.status} labels={disputeStatusLabel} />}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Qué se reclama" description={`Abierto por ${dispute.opened_side === "client" ? "el cliente" : "tu equipo"} · ${formatDateTime(dispute.created_at)}`} />
            <p className="whitespace-pre-line text-[15px]">{dispute.description}</p>
          </Card>
          {dispute.resolution && (
            <Alert tone="info" title={`Resolución: ${disputeResolutionLabel[dispute.resolution] ?? dispute.resolution}`}>
              {dispute.resolution_note}
            </Alert>
          )}
          <Card>
            <CardHeader title="Conversación del reclamo" description="La ven el cliente, tu equipo y el equipo de Fixy." />
            <ol className="space-y-3" aria-label="Mensajes del reclamo">
              {messages.length === 0 && <li className="text-sm text-muted">Todavía no hay respuestas.</li>}
              {messages.map((m) => (
                <li key={m.id} className={cn("flex", m.mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px]", m.mine ? "bg-fixy-700 text-white" : m.author_side === "platform" ? "bg-info-bg" : "bg-cream-2")}>
                    {!m.mine && <p className="mb-0.5 text-xs font-semibold opacity-80">{SIDE[m.author_side] ?? m.author_side}{m.author_name ? ` · ${m.author_name}` : ""}</p>}
                    <p className="whitespace-pre-line break-words">{m.body}</p>
                    {m.file_url && <a href={m.file_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm underline"><Paperclip className="h-3.5 w-3.5" aria-hidden />{m.file_name}</a>}
                    <p className={cn("mt-1 text-[11px]", m.mine ? "text-white/75" : "text-muted")}>{formatDateTime(m.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
            {!closed ? (
              <ActionForm action={replyDisputeAction} className="mt-5 space-y-3" resetOnSuccess>
                <input type="hidden" name="disputeId" value={id} />
                <Field label="Tu respuesta" htmlFor="dr-body" required hint="Contá tu versión con datos concretos. Podés adjuntar fotos o comprobantes.">
                  <Textarea id="dr-body" name="body" required maxLength={4000} />
                </Field>
                <Field label="Adjunto (JPG, PNG, WEBP o PDF)" htmlFor="dr-file">
                  <input id="dr-file" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="block w-full text-sm" />
                </Field>
                <SubmitButton pendingText="Enviando…">Enviar respuesta</SubmitButton>
              </ActionForm>
            ) : (
              <p className="mt-4 text-sm text-muted">El reclamo está cerrado.</p>
            )}
          </Card>
        </div>
        <aside className="space-y-5">
          <Card>
            <CardHeader title="Resumen" />
            <DefinitionList items={[
              ["Estado", disputeStatusLabel[dispute.status] ?? dispute.status],
              ["Trabajo", <Link key="j" href={`/proveedor/trabajos/${job.id}`} className="underline">{job.code}</Link>],
              ["Resuelto", dispute.resolved_at ? formatDateTime(dispute.resolved_at) : "—"],
            ]} />
            <p className="mt-3 text-sm text-muted">Mientras el reclamo está abierto, la liquidación de este trabajo queda en pausa.</p>
          </Card>
          <Card>
            <CardHeader title="Historial" />
            <Timeline events={disputeEvents} />
          </Card>
        </aside>
      </div>
    </>
  );
}
