import Link from "next/link";
import { notFound } from "next/navigation";
import { Bot, ShieldCheck, Star } from "lucide-react";
import { requireSection } from "@/server/auth/session";
import { getReviewDispute } from "@/server/queries/admin";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/form";
import { Field, Select, Textarea } from "@/components/ui/field";
import { BackLink } from "@/components/admin/ui";
import { REASON_LABEL } from "@/server/assistant/review-mediator";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { reviewDisputeMessageAction, reviewDisputeResolveAction } from "../../actions";
import { DISPUTE_STATUS } from "@/components/admin/review-labels";

export const metadata = { title: "Impugnación de reseña" };

export default async function AdminReviewDispute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = (await requireSection("resenas")).actor;
  const data = await getReviewDispute(actor.id, id);
  if (!data) notFound();
  const { d, review, job, client, provider, messages, revisions } = data;
  const open = !["resolved", "closed"].includes(d.status);
  const ai = d.ai_last_decision;
  return (
    <>
      <PageHeader back={<BackLink href="/admin/resenas">Reseñas</BackLink>} eyebrow="Impugnación de reseña" title={`${job.code} · ${provider.display_name}`}
        action={<Badge tone={d.status === "escalated" ? "warn" : open ? "info" : "ok"}>{DISPUTE_STATUS[d.status]}</Badge>} />
      {d.status === "escalated" && <Alert tone="warn" className="mb-6" title="Requiere revisión humana">{d.escalation_reason ?? "La IA no pudo resolver el caso."}</Alert>}
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Reseña impugnada" />
            <p className="flex items-center gap-1" aria-label={`${review.rating} de 5`}>{Array.from({ length: 5 }, (_, i) => <Star key={i} className={i < review.rating ? "h-5 w-5 fill-spark text-spark" : "h-5 w-5 text-line"} aria-hidden />)}</p>
            <p className="mt-2">{review.comment || <span className="text-muted">Sin comentario</span>}</p>
            <DefinitionList className="mt-4" items={[
              ["Trabajo", <Link key="j" href={`/admin/trabajos/${review.job_id}`} className="font-semibold text-fixy-800 underline">{job.code} · {job.title}</Link>],
              ["Cliente (autor)", `${client.full_name} · ${client.email}${client.phone ? ` · ${client.phone}` : ""}`],
              ["Profesional", <Link key="p" href={`/profesionales/${provider.slug}`} className="underline">{provider.display_name}</Link>],
              ["Recibida", formatDateTime(review.created_at)],
              ["Publicada", formatDateTime(review.visible_at)],
              ["Estado", review.withdrawn_at ? "Retirada por el cliente" : review.hidden_at ? "Ocultada" : review.edited_at ? "Visible (corregida)" : "Visible"],
            ]} />
            {revisions.length > 0 && (
              <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold text-fixy-800">Versiones anteriores ({revisions.length})</summary>
                <ul className="mt-2 space-y-1">{revisions.map((r, i) => <li key={i}>{r.rating}★ «{r.comment}» · {r.reason} · {formatDateTime(r.created_at)}</li>)}</ul>
              </details>
            )}
          </Card>
          <Card>
            <CardHeader title="Descargo del profesional" description={REASON_LABEL[d.reason_code]} />
            <p className="whitespace-pre-line text-[15px]">{d.provider_statement}</p>
          </Card>
          <Card>
            <CardHeader title="Conversación con el cliente" description="El profesional no ve esta conversación." />
            <ol className="space-y-3">
              {messages.map((m) => (
                <li key={m.id} className={cn("rounded-2xl p-3 text-[15px]", m.author === "client" ? "ml-8 bg-fixy-50" : m.author === "admin" ? "bg-info-bg" : m.author === "system" ? "bg-cream-2 text-sm text-muted" : "mr-8 bg-cream-2")}>
                  <p className="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-muted">
                    {m.author === "ai" ? <><Bot className="h-3.5 w-3.5" aria-hidden />Asistente (IA)</> : m.author === "admin" ? <><ShieldCheck className="h-3.5 w-3.5" aria-hidden />{m.author_name ?? "Equipo"}</> : m.author === "client" ? client.full_name : "Sistema"}
                    {" · "}{formatDateTime(m.created_at)}
                  </p>
                  <p className="whitespace-pre-line">{m.body}</p>
                </li>
              ))}
            </ol>
            {open && (
              <ActionForm action={reviewDisputeMessageAction} className="mt-4 space-y-2" resetOnSuccess>
                <input type="hidden" name="disputeId" value={id} />
                <Field label="Escribirle al cliente" htmlFor="ad-msg" hint="Al escribir, el caso queda a cargo de operación (la IA deja de intervenir).">
                  <Textarea id="ad-msg" name="body" required rows={3} maxLength={4000} />
                </Field>
                <SubmitButton size="sm">Enviar</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Análisis de la IA" description={ai ? `Decisión: ${ai.decision ?? "—"} · confianza ${ai.confidence ?? "—"} · ${ai.source === "rules" ? "sin IA (reglas)" : "IA"}` : "Todavía sin evaluación."} />
            {ai?.policyFlags && ai.policyFlags.length > 0 && <p className="mb-2 text-sm"><span className="font-semibold">Señales:</span> {ai.policyFlags.join(", ")}</p>}
            <p className="whitespace-pre-line text-[15px]">{d.internal_summary ?? "—"}</p>
            {d.provider_summary && <p className="mt-3 rounded-xl bg-cream/60 p-3 text-sm"><span className="font-semibold">Mensaje para el profesional:</span> {d.provider_summary}</p>}
            <p className="mt-3 text-xs text-muted">Rondas de IA: {d.ai_rounds}. La IA no oculta reseñas: solo recomienda, consulta y escala.</p>
          </Card>
          {open && (
            <Card>
              <CardHeader title="Decisión del equipo" />
              <ConfirmAction action={reviewDisputeResolveAction} label="Resolver" title="Resolver la impugnación" confirmLabel="Confirmar decisión" requireReason reasonLabel="Fundamento interno (queda auditado)" hidden={{ disputeId: id }}>
                <div className="mt-4 space-y-3">
                  <label htmlFor="ad-res" className="block text-[15px] font-semibold">Resolución</label>
                  <Select id="ad-res" name="resolution" required defaultValue="kept">
                    <option value="kept">Mantener la reseña</option>
                    <option value="hidden">Ocultar la reseña (incumple políticas)</option>
                    <option value="other">Otra</option>
                  </Select>
                  <label htmlFor="ad-ps" className="block text-[15px] font-semibold">Mensaje para el profesional</label>
                  <textarea id="ad-ps" name="providerSummary" required minLength={5} maxLength={500} placeholder="Neutral y sin datos que identifiquen al cliente." className="block min-h-20 w-full rounded-xl border border-[#d3dfdc] px-3.5 py-2" />
                </div>
              </ConfirmAction>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
