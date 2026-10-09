/* eslint-disable @next/next/no-img-element */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { sql } from "@/server/db/client";
import { getOpportunity, requireProviderContext } from "@/server/queries/provider";
import { markInvitationViewed, TIME_WINDOWS } from "@/server/modules/requests";
import { commissionRuleFor, getSetting } from "@/server/modules/catalog";
import { referralCandidates } from "@/server/modules/requests";
import { DeclineForm } from "@/components/provider/decline-form";
import { providerEligibility } from "@/server/modules/providers";
import { modeLabel, propertyKindLabel, quoteStatusLabel, requestStatusLabel, urgencyLabel } from "@/server/domain/labels";
import { todayInBuenosAires, formatDate, formatDateTime, formatMoney, relativeTime } from "@/lib/format";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/form";
import { MessageThread } from "@/components/domain/messages";
import { ProviderNetBreakdown } from "@/components/domain/price";
import { QuoteForm } from "@/components/provider/quote-form";
import { BidForm } from "@/components/provider/bid-form";
import { AcceptBookingForm } from "@/components/provider/accept-booking-form";
import { AccessRequirementsView } from "@/components/domain/access-requirements";
import { INVITATION_STATUS_LABEL, ITEM_KIND_LABEL, REGION_LABEL } from "@/components/provider/constants";
import { declineInvitationAction, withdrawQuoteAction } from "../../actions";

export const metadata: Metadata = { title: "Oportunidad" };

export default async function OpportunityPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ enviado?: string }> }) {
  const { id } = await params;
  const { enviado } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { actor, provider } = await requireProviderContext({ adminOnly: true });
  let o = await getOpportunity(actor.id, provider.id, id);
  if (!o) notFound();
  if (o.inv.status === "invited") {
    await markInvitationViewed(actor, id).catch(() => null);
    o = { ...o, inv: { ...o.inv, status: "viewed" } };
  }
  const { inv, request, quote } = o;
  const [rule, elig, colleagues, refFee, referral] = await Promise.all([
    commissionRuleFor(sql(), request.category_id), providerEligibility(sql(), provider.id, request.category_id),
    referralCandidates(sql(), request.id, provider.id), getSetting<number>(sql(), "referrals.fee_bps", 1000),
    sql()<{ from_name: string; fee_bps: number; note: string | null }[]>`
      select p.display_name as from_name, pr.fee_bps, pr.note from request_invitations i join provider_referrals pr on pr.id = i.referral_id
      join providers p on p.id = pr.from_provider_id where i.id = ${inv.id}`,
  ]);
  const referralFeePct = Number(refFee) / 100;
  const requestOpen = ["searching", "with_quotes"].includes(request.status);
  const invitationOpen = inv.status === "invited" || inv.status === "viewed";
  const eligible = elig.eligible;
  const verifyFirst = (
    <Card className="ring-2 ring-warn/30">
      <CardHeader title={request.request_mode === "direct" ? "Un cliente te eligió: verificá tu cuenta para aceptar" : "Verificá tu cuenta para responder"}
        description={inv.respond_by ? `Tenés tiempo hasta el ${formatDateTime(inv.respond_by)}. El equipo de Fixy revisa tu documentación con prioridad.` : "El equipo de Fixy revisa tu documentación con prioridad."} />
      <p className="text-[15px] text-ink-2">Pedimos verificar la identidad de cada profesional para cuidar a los clientes y a vos. Te falta:</p>
      <ul className="mt-2 list-disc pl-5 text-[15px]">{elig.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      <ButtonLink href="/proveedor/alta#documentacion" className="mt-4">Completar la verificación</ButtonLink>
    </Card>
  );
  const budgetMode = request.request_mode === "budget" && !!request.budget_minor;
  const windows = (request.preferred_windows ?? []).map((w) => TIME_WINDOWS.find((t) => t.key === w)?.label ?? w);
  const answers = Object.entries(request.answers ?? {}).filter(([, v]) => v !== "" && v != null);
  const labelFor = (k: string) => o!.questions.find((q) => q.key === k)?.label ?? k;
  const path = `/proveedor/oportunidades/${id}`;
  const [visitFee] = await sql()<{ visit_fee_minor: number; visit_fee_credited: boolean }[]>`select visit_fee_minor, visit_fee_credited from providers where id = ${provider.id}`;

  return (
    <>
      <PageHeader
        back={<Link href="/proveedor/oportunidades" className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800"><ArrowLeft className="h-4 w-4" aria-hidden /> Oportunidades</Link>}
        eyebrow={`${request.code} · ${o.category?.name ?? "Sin categoría"}`}
        title={request.title}
        description={`Recibida ${relativeTime(inv.created_at)}.`}
        action={<Badge tone={invitationOpen ? "brand" : "neutral"}>{INVITATION_STATUS_LABEL[inv.status] ?? inv.status}</Badge>}
      />
      {referral[0] && (
        <Alert tone="info" className="mb-5" title={`Te recomendó ${referral[0].from_name}`}>
          El cliente aceptó su recomendación. Si hacés este trabajo, {referral[0].from_name} recibe el {referral[0].fee_bps / 100} % de lo que cobres por él (se descuenta de tu liquidación).
          {referral[0].note && <> Le dijo al cliente: «{referral[0].note}».</>}
        </Alert>
      )}
      {enviado && quote && <Alert tone="ok" className="mb-5" title={budgetMode ? "Enviamos tu oferta" : "Enviamos tu presupuesto"}>El cliente lo va a revisar. Te avisamos si lo acepta.</Alert>}
      {budgetMode && (
        <Alert tone="info" className="mb-5" title={`El cliente ofrece ${formatMoney(request.budget_minor!)} por este trabajo`}>
          Anotate por ese precio u ofrecé menos para ganarlo. {request.best_offer_minor ? <>La oferta más baja hasta ahora es <strong>{formatMoney(request.best_offer_minor)}</strong>.</> : "Todavía nadie ofertó: podés ser el primero."}
        </Alert>
      )}
      {o.jobId && (
        <Alert tone="ok" className="mb-5" title="El cliente aceptó tu presupuesto">
          <Link href={`/proveedor/trabajos/${o.jobId}`}>Ver el trabajo</Link>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Qué necesita el cliente" />
            <p className="whitespace-pre-line text-[15px] leading-relaxed">{request.description}</p>
            {answers.length > 0 && (
              <DefinitionList className="mt-4" items={answers.map(([k, v]) => [labelFor(k), typeof v === "boolean" ? (v ? "Sí" : "No") : String(v)])} />
            )}
            {o.photos.length > 0 && (
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {o.photos.map((url, i) => (
                  <li key={url}>
                    <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Foto ${i + 1} del pedido`} className="aspect-[4/3] w-full rounded-2xl object-cover ring-1 ring-line" loading="lazy" /></a>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {o.access && (
            <Card className="ring-2 ring-warn/30">
              <CardHeader title="Barrio cerrado: requisitos para entrar" description="Revisalos antes de aceptar. La ubicación exacta y el nombre del barrio se comparten cuando el cliente confirma la visita." />
              <AccessRequirementsView req={o.access.gated_requirements} notes={o.access.gated_client_notes} audience="provider" />
            </Card>
          )}

          {quote ? (
            <Card>
              <CardHeader title={budgetMode ? "Tu oferta" : "Tu presupuesto"} action={<StatusBadge status={quote.status} labels={quoteStatusLabel} />} />
              <DefinitionList items={[
                ["Tipo", modeLabel[quote.mode] ?? quote.mode],
                ["Fecha propuesta", quote.proposed_date ? `${formatDate(quote.proposed_date)}${quote.proposed_window ? ` · ${quote.proposed_window}` : ""}` : "A coordinar"],
                ["Vigente hasta", formatDateTime(quote.valid_until)],
                ["Materiales", quote.materials_included ? "Incluidos" : "No incluidos"],
              ]} />
              <h3 className="mt-4 text-sm font-semibold text-muted">Alcance</h3>
              <p className="whitespace-pre-line text-[15px]">{quote.scope}</p>
              {quote.exclusions && (<><h3 className="mt-3 text-sm font-semibold text-muted">No incluye</h3><p className="whitespace-pre-line text-[15px]">{quote.exclusions}</p></>)}
              <ul className="tabular mt-4 divide-y divide-line text-[15px]">
                {o.items.map((it) => (
                  <li key={it.id} className="flex justify-between gap-3 py-2">
                    <span><span className="text-muted">{ITEM_KIND_LABEL[it.kind]}:</span> {it.description}{it.quantity > 1 && ` × ${it.quantity}`}</span>
                    <span>{formatMoney(it.amount_minor)}</span>
                  </li>
                ))}
              </ul>
              <ProviderNetBreakdown className="mt-3" grossMinor={quote.subtotal_minor} feeMinor={quote.provider_fee_minor} netMinor={quote.provider_net_minor} rateBps={quote.provider_rate_bps} />
              <p className="mt-1 text-sm text-muted">El cliente paga {formatMoney(quote.total_minor)} en total (incluye su cargo de servicio).</p>
              {quote.status === "sent" && budgetMode && requestOpen && (
                <div className="mt-5 border-t border-line pt-4">
                  <h3 className="mb-3 font-semibold">¿Querés mejorar tu oferta?</h3>
                  <BidForm invitationId={inv.id} budgetMinor={request.budget_minor!} bestOfferMinor={request.best_offer_minor} replacing={quote.id} currentMinor={quote.subtotal_minor}
                    windows={TIME_WINDOWS.map((w) => w.label)} defaultDate={todayInBuenosAires()} />
                </div>
              )}
              {quote.status === "sent" && (
                <div className="mt-4">
                  <ConfirmAction action={withdrawQuoteAction} label="Retirar presupuesto" variant="danger" title="¿Retirar el presupuesto?" description="El cliente deja de verlo como opción. No se puede deshacer." requireReason hidden={{ quoteId: quote.id }} confirmLabel="Retirar" />
                </div>
              )}
            </Card>
          ) : invitationOpen && requestOpen && request.request_mode === "direct" ? (
            eligible ? (
              <Card className="ring-2 ring-fixy-500/30">
                <CardHeader title="Este cliente te eligió" description={inv.respond_by ? `Respondé antes del ${formatDateTime(inv.respond_by)}. Si no respondés, el cliente elige a otro profesional.` : "Respondé lo antes posible."} />
                <AcceptBookingForm invitationId={inv.id} visitFeeMinor={visitFee.visit_fee_minor} visitFeeCredited={visitFee.visit_fee_credited} windows={TIME_WINDOWS.map((w) => w.label)} defaultDate={todayInBuenosAires()} gated={!!o.access} />
              </Card>
            ) : verifyFirst
          ) : invitationOpen && requestOpen && budgetMode ? (
            eligible ? (
              <Card className="ring-2 ring-fixy-500/30">
                <CardHeader title="Tu oferta" description="El cliente compara las ofertas por precio, reseñas y experiencia, y elige una." />
                <BidForm invitationId={inv.id} budgetMinor={request.budget_minor!} bestOfferMinor={request.best_offer_minor}
                  windows={TIME_WINDOWS.map((w) => w.label)} defaultDate={todayInBuenosAires()} />
              </Card>
            ) : verifyFirst
          ) : invitationOpen && requestOpen ? (
            eligible ? (
              <Card>
                <CardHeader title="Armá tu presupuesto" description="Revisá qué incluye antes de enviarlo. Una vez enviado, no se puede editar: podés retirarlo y enviar otro si la oportunidad sigue abierta." />
                <QuoteForm invitationId={inv.id} rule={rule} allowFixed={o.service?.pricing_mode === "fixed"} windows={TIME_WINDOWS.map((w) => ({ key: w.key, label: w.label }))} defaultDate={todayInBuenosAires()} />
              </Card>
            ) : verifyFirst
          ) : (
            <Alert tone="info" title="Esta oportunidad ya no admite presupuestos">
              {inv.status === "declined" ? `Indicaste que no la tomás${inv.decline_reason ? `: ${inv.decline_reason}` : "."}` : `Estado de la solicitud: ${requestStatusLabel[request.status] ?? request.status}.`}
            </Alert>
          )}

          {o.conversationId && (
            <Card>
              <CardHeader title="Mensajes con el cliente" description="Hacé preguntas para cotizar mejor. No pidas ni compartas datos de contacto: la dirección se revela cuando el cliente confirma la visita." />
              <MessageThread conversationId={o.conversationId} messages={o.messages} path={path} disabled={!requestOpen && !o.jobId} />
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader title="Datos para cotizar" />
            <DefinitionList items={[
              ["Categoría", o.category?.name ?? "Sin categoría"],
              ...(o.service ? [["Servicio", `${o.service.name} · ${modeLabel[o.service.pricing_mode] ?? o.service.pricing_mode}`] as [string, string]] : []),
              ["Urgencia", urgencyLabel[request.urgency] ?? request.urgency],
              ["Franjas preferidas", windows.length ? windows.join(", ") : "Sin preferencia"],
              ["Zona", `${o.zoneName}${o.region ? ` (${REGION_LABEL[o.region] ?? o.region})` : ""}`],
              ["Tipo de propiedad", propertyKindLabel[o.propertyKind] ?? o.propertyKind],
            ]} />
            <p className="mt-3 flex gap-2 text-sm text-muted"><Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />La dirección exacta, los datos de acceso y el contacto se revelan solo si te contratan y el pago está aprobado.</p>
          </Card>
          {o.service && (o.service.scope || o.service.exclusions) && (
            <Card>
              <CardHeader title="Alcance del servicio de catálogo" />
              {o.service.scope && <p className="text-[15px]">{o.service.scope}</p>}
              {o.service.exclusions && <p className="mt-2 text-sm text-muted">No incluye: {o.service.exclusions}</p>}
            </Card>
          )}
          {invitationOpen && requestOpen && !quote && (
            <Card>
              <CardHeader title="¿No podés tomarlo?" description="Avisanos así el cliente no espera, y si querés recomendá a un colega." />
              <DeclineForm action={declineInvitationAction} invitationId={inv.id} colleagues={colleagues} feePct={referralFeePct} />
            </Card>
          )}
          {quote?.status === "accepted" && o.jobId && <ButtonLink href={`/proveedor/trabajos/${o.jobId}`} className="w-full">Ir al trabajo</ButtonLink>}
        </aside>
      </div>
    </>
  );
}
