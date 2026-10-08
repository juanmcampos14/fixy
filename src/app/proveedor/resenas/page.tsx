import type { Metadata } from "next";
import Link from "next/link";
import { listReviews, requireProviderContext } from "@/server/queries/provider";
import { formatDate } from "@/lib/format";
import { Card, PageHeader, Stat } from "@/components/ui/card";
import { DemoBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Textarea } from "@/components/ui/field";
import { Stars } from "@/components/provider/stars";
import { replyReviewAction } from "../actions";

export const metadata: Metadata = { title: "Reseñas" };

export default async function ReviewsPage() {
  const { actor, provider } = await requireProviderContext({ adminOnly: true });
  const reviews = await listReviews(actor.id, provider.id);
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
  return (
    <>
      <PageHeader title="Reseñas" description="Lo que dicen los clientes de trabajos completados. Podés responder una vez a cada reseña; tu respuesta es pública." />
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
                    <Link href={`/proveedor/trabajos/${r.job_id}`} className="underline">{r.code}</Link> · {formatDate(r.created_at)}
                  </span>
                </div>
                <p className="mt-2 text-[15px]">{r.comment || <span className="text-muted">Sin comentario.</span>}</p>
                <p className="mt-1 text-sm text-muted">{r.client_name ?? "Cliente"}</p>
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
