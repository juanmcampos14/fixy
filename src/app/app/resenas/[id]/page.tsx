import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Bot, ShieldCheck, Star } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { asUser } from "@/server/db/client";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/form";
import { Field, Textarea } from "@/components/ui/field";
import { RatingInput } from "@/components/client/rating-input";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { reviewDisputeDecideAction, reviewDisputeReplyAction } from "../../actions";

export const metadata = { title: "Revisión de tu reseña" };

const STATUS: Record<string, string> = { awaiting_client: "Esperando tu respuesta", ai_review: "En análisis", escalated: "En revisión del equipo de Fixy", resolved: "Resuelta", closed: "Cerrada" };

export default async function ReviewInquiry({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor(`/app/resenas/${id}`);
  const data = await asUser(actor.id, async (tx) => {
    const [d] = await tx<{ id: string; review_id: string; status: string; resolution: string | null; client_deadline: Date }[]>`
      select id, review_id, status, resolution, client_deadline from review_disputes_client where id = ${id}`;
    if (!d) return null;
    const [review] = await tx<{ rating: number; comment: string; job_id: string; withdrawn_at: Date | null; edited_at: Date | null }[]>`
      select rating, comment, job_id, withdrawn_at, edited_at from reviews where id = ${d.review_id}`;
    const [job] = await tx<{ code: string; title: string }[]>`select j.code, r.title from jobs j join service_requests r on r.id = j.request_id where j.id = ${review.job_id}`;
    const messages = await tx<{ id: string; author: string; body: string; created_at: Date }[]>`
      select id, author, body, created_at from review_dispute_messages where dispute_id = ${id} order by created_at`;
    return { d, review, job, messages };
  });
  if (!data) notFound();
  const { d, review, job, messages } = data;
  const open = ["awaiting_client", "ai_review", "escalated"].includes(d.status);
  const canDecide = open && !review.withdrawn_at;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        back={<Link href={`/app/trabajos/${review.job_id}`} className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />{job.code}</Link>}
        eyebrow="Revisión de reseña"
        title={job.title}
        action={<Badge tone={open ? "info" : "ok"}>{STATUS[d.status] ?? d.status}</Badge>}
      />
      <Alert tone="info" className="mb-6" title="Tu opinión es válida">
        El profesional pidió revisar tu reseña. No tenés obligación de cambiarla. El profesional no sabe quién escribió cada reseña y no ve esta conversación.
      </Alert>
      <Card className="mb-6">
        <CardHeader title="Tu reseña" />
        <p className="flex items-center gap-1" aria-label={`${review.rating} de 5`}>{Array.from({ length: 5 }, (_, i) => <Star key={i} className={i < review.rating ? "h-5 w-5 fill-spark text-spark" : "h-5 w-5 text-line"} aria-hidden />)}</p>
        {review.comment && <p className="mt-2">{review.comment}</p>}
        {review.withdrawn_at && <p className="mt-2 text-sm text-muted">Retiraste esta reseña.</p>}
        {review.edited_at && !review.withdrawn_at && <p className="mt-2 text-sm text-muted">Corregida el {formatDateTime(review.edited_at)}.</p>}
      </Card>
      <Card className="mb-6">
        <CardHeader title="Conversación" description={open && d.status === "awaiting_client" ? `Podés responder hasta el ${formatDateTime(d.client_deadline)}` : undefined} />
        <ol className="space-y-3">
          {messages.map((m) => (
            <li key={m.id} className={cn("rounded-2xl p-3 text-[15px]", m.author === "client" ? "ml-8 bg-fixy-50" : m.author === "admin" ? "bg-info-bg" : m.author === "system" ? "bg-cream-2 text-sm text-muted" : "mr-8 bg-cream-2")}>
              <p className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-muted">
                {m.author === "ai" && <><Bot className="h-3.5 w-3.5" aria-hidden />Asistente de Fixy (IA)</>}
                {m.author === "admin" && <><ShieldCheck className="h-3.5 w-3.5" aria-hidden />Equipo de Fixy</>}
                {m.author === "client" && "Vos"}
                {m.author === "system" && "Aviso"}
                {" · "}{formatDateTime(m.created_at)}
              </p>
              <p className="whitespace-pre-line">{m.body}</p>
            </li>
          ))}
        </ol>
        {open && (
          <ActionForm action={reviewDisputeReplyAction} className="mt-4 space-y-2" resetOnSuccess>
            <input type="hidden" name="disputeId" value={id} />
            <Field label="Tu respuesta" htmlFor="rd-body" required>
              <Textarea id="rd-body" name="body" required rows={4} maxLength={4000} placeholder="Contanos qué pasó, con el mayor detalle posible." />
            </Field>
            <SubmitButton pendingText="Enviando…">Enviar respuesta</SubmitButton>
            <p className="text-xs text-muted">Un asistente con IA analiza tu respuesta junto con el registro del trabajo. Si hace falta, el caso lo revisa una persona del equipo. Podés pedir hablar con una persona en tu respuesta.</p>
          </ActionForm>
        )}
      </Card>
      {canDecide && (
        <Card>
          <CardHeader title="¿Qué querés hacer con tu reseña?" description="Cualquiera de estas opciones es válida." />
          <div className="flex flex-wrap gap-2">
            {d.status === "awaiting_client" && (
              <ConfirmAction action={reviewDisputeDecideAction} variant="secondary" label="Mantenerla como está" title="Mantener tu reseña" confirmLabel="Mantener" hidden={{ disputeId: id, choice: "keep" }}
                description="Registramos que la mantenés. Si querés, antes podés sumar tu respuesta en la conversación." />
            )}
            <ConfirmAction action={reviewDisputeDecideAction} variant="secondary" label="Corregirla" title="Corregir tu reseña" confirmLabel="Guardar corrección" hidden={{ disputeId: id, choice: "edit" }}
              description="La versión anterior queda guardada en el historial interno.">
              <div className="mt-4 space-y-3">
                <RatingInput legend="Calificación" />
                <label htmlFor="rd-edit" className="block text-[15px] font-semibold">Comentario</label>
                <textarea id="rd-edit" name="comment" defaultValue={review.comment} maxLength={2000} className="block min-h-24 w-full rounded-xl border border-[#d3dfdc] px-3.5 py-3" />
              </div>
            </ConfirmAction>
            <ConfirmAction action={reviewDisputeDecideAction} variant="danger" label="Retirarla" title="Retirar tu reseña" confirmLabel="Retirar reseña" hidden={{ disputeId: id, choice: "withdraw" }}
              description="La reseña deja de publicarse. Esta acción no se puede deshacer." />
          </div>
        </Card>
      )}
    </div>
  );
}
