import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Paperclip } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { getClientDispute } from "@/server/queries/client";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Timeline } from "@/components/domain/timeline";
import { disputeReasonLabel, disputeResolutionLabel, disputeStatusLabel } from "@/server/domain/labels";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { replyDisputeAction } from "../../actions";

export default async function ClientDispute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const data = await getClientDispute(actor.id, id);
  if (!data) notFound();
  const { d, messages } = data;
  return (
    <>
      <PageHeader
        back={<Link href={`/app/trabajos/${d.job_id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />{d.job_code}</Link>}
        eyebrow="Reclamo"
        title={disputeReasonLabel[d.reason_code]}
        description={d.title}
        action={<StatusBadge status={d.status} labels={disputeStatusLabel} className="text-sm" />}
      />
      {d.status === "resolved" || d.status === "closed" ? (
        <Alert tone="ok" className="mb-6" title={`Resolución: ${d.resolution ? disputeResolutionLabel[d.resolution] : "Cerrado"}`}>{d.resolution_note}</Alert>
      ) : (
        <Alert tone="info" className="mb-6" title="Vamos a revisar el caso">Una persona del equipo de Fixy lo analiza con la información del trabajo, los mensajes y las evidencias. Te avisamos cada novedad.</Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Conversación del reclamo" />
          <p className="mb-4 rounded-2xl bg-cream/60 p-3 text-[15px]"><span className="font-semibold">Tu reclamo:</span> {d.description}</p>
          <ol className="space-y-3">
            {messages.map((m) => (
              <li key={m.id} className={cn("rounded-2xl p-3 text-[15px]", m.author_side === "platform" ? "bg-info-bg" : m.author_side === "client" ? "bg-fixy-50" : "bg-cream-2")}>
                <p className="text-xs font-semibold text-muted">{m.author_side === "platform" ? "Equipo Fixy" : m.author}{" · "}{formatDateTime(m.created_at)}</p>
                <p className="mt-0.5 whitespace-pre-line">{m.body}</p>
                {m.url && <a href={m.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 underline"><Paperclip className="h-3.5 w-3.5" aria-hidden />{m.file_name}</a>}
              </li>
            ))}
          </ol>
          {d.status !== "closed" && (
            <ActionForm action={replyDisputeAction} className="mt-4 space-y-2" resetOnSuccess>
              <input type="hidden" name="disputeId" value={id} />
              <label htmlFor="body" className="sr-only">Respuesta</label>
              <textarea id="body" name="body" required rows={3} maxLength={4000} placeholder="Sumá información o respondé al equipo…" className="block w-full rounded-2xl border border-control px-4 py-3 focus:border-fixy-600 focus:outline-none focus:ring-3 focus:ring-fixy-500/25" />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input type="file" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="text-sm" aria-label="Adjuntar evidencia" />
                <SubmitButton size="sm">Responder</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>
        <Card>
          <CardHeader title="Estado" />
          <Timeline events={data.events} kind="dispute" />
          <p className="mt-3 text-xs text-muted">El historial del trabajo se conserva completo. Reembolsos o pausas de liquidación solo se aplican según la resolución del equipo.</p>
        </Card>
      </div>
    </>
  );
}
