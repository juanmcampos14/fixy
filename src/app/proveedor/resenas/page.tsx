import type { Metadata } from "next";
import { listReviews, requireProviderContext } from "@/server/queries/provider";
import { formatMonth } from "@/lib/format";
import { Alert } from "@/components/ui/alert";
import { Card, PageHeader, Stat } from "@/components/ui/card";
import { DemoBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Textarea } from "@/components/ui/field";
import { Stars } from "@/components/provider/stars";
import { openReviewDisputeAction, replyReviewAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { REASON_LABEL } from "@/server/assistant/review-mediator";

export const metadata: Metadata = { title: "Reseñas" };

export default async function ReviewsPage() {
  const { actor, provider } = await requireProviderContext({ adminOnly: true });
  const reviews = await listReviews(actor.id, provider.id);
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
  return (
    <>
      <PageHeader title="Reseñas" description="Lo que dicen los clientes de trabajos completados. Podés responder una vez a cada reseña; tu respuesta es pública." />
      <Alert tone="info" className="mb-6" title="Reseñas anónimas y con publicación diferida">
        Para que cada cliente pueda opinar con libertad, las reseñas se publican días después de recibirse (el plazo varía) y no indican qué cliente ni qué trabajo las dejó. Solo ves el mes de publicación.
      </Alert>
      {reviews.length === 0 ? (
        <EmptyState pose="empathy" title="Todavía no tenés reseñas" description="Los clientes pueden calificarte cuando dan conformidad a un trabajo." />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Stat label="Promedio" value={avg ? avg.toLocaleString("es-AR", { maximumFractionDigits: 1 }) : "—"} hint="Sobre 5" />
            <Stat label="Reseñas" value={reviews.length} />
          </div>
          <ul className="space-y-3">
            {reviews.map((r) => (
              <Card as="li" key={r.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Stars rating={r.rating} />
                  <span className="flex items-center gap-2 text-sm text-muted">
                    {r.is_demo && <DemoBadge />}
                    Publicada en {formatMonth(r.published_month)}
                  </span>
                </div>
                <p className="mt-2 text-[15px]">{r.comment || <span className="text-muted">Sin comentario.</span>}</p>
                {r.dispute_status ? (
                  <div className="mt-3 rounded-2xl bg-info-bg/60 p-3 text-sm ring-1 ring-info/15">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      Impugnación
                      <Badge tone={r.dispute_status === "resolved" || r.dispute_status === "closed" ? "ok" : "info"}>
                        {{ awaiting_client: "Consultando al cliente", ai_review: "En análisis", escalated: "En revisión del equipo", resolved: "Resuelta", closed: "Cerrada" }[r.dispute_status] ?? r.dispute_status}
                      </Badge>
                    </p>
                    {r.dispute_summary && <p className="mt-1 text-ink-2">{r.dispute_summary}</p>}
                  </div>
                ) : (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-fixy-800">Impugnar esta reseña</summary>
                    <ActionForm action={openReviewDisputeAction} className="mt-3 space-y-3 rounded-2xl bg-cream/60 p-4 ring-1 ring-line">
                      <input type="hidden" name="reviewId" value={r.id} />
                      <p className="text-sm text-muted">Un asistente consulta al cliente de forma neutral y analiza el trabajo. Si no se resuelve, lo revisa una persona del equipo. No vas a saber quién escribió la reseña, y la reseña sigue publicada mientras se revisa.</p>
                      <Field label="Motivo" htmlFor={`rd-r-${r.id}`} required>
                        <Select id={`rd-r-${r.id}`} name="reasonCode" required defaultValue="">
                          <option value="" disabled>Elegí un motivo</option>
                          {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Select>
                      </Field>
                      <Field label="Tu versión" htmlFor={`rd-s-${r.id}`} required hint="Contá qué pasó, con hechos concretos. Mínimo 20 caracteres.">
                        <Textarea id={`rd-s-${r.id}`} name="statement" required minLength={20} maxLength={3000} />
                      </Field>
                      <SubmitButton variant="secondary" size="sm" pendingText="Enviando…">Enviar impugnación</SubmitButton>
                    </ActionForm>
                  </details>
                )}
                {r.provider_reply ? (
                  <div className="mt-3 rounded-2xl bg-cream/70 p-3 text-[15px] ring-1 ring-line">
                    <p className="text-xs font-semibold text-fixy-800">Tu respuesta</p>
                    <p className="mt-0.5 whitespace-pre-line">{r.provider_reply}</p>
                  </div>
                ) : (
                  <ActionForm action={replyReviewAction} className="mt-3 space-y-2">
                    <input type="hidden" name="reviewId" value={r.id} />
                    <Field label="Responder" htmlFor={`rp-${r.id}`} hint="Con respeto y sin datos personales. Solo podés responder una vez.">
                      <Textarea id={`rp-${r.id}`} name="reply" maxLength={1000} className="min-h-20" />
                    </Field>
                    <SubmitButton variant="soft" size="sm" pendingText="Publicando…">Publicar respuesta</SubmitButton>
                  </ActionForm>
                )}
              </Card>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
