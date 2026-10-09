/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BadgeCheck, CalendarDays, CircleCheck, CircleMinus, Clock, MessageCircle, Star } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { getClientRequest } from "@/server/queries/client";
import { modeLabel, quoteStatusLabel, requestStatusLabel, urgencyLabel } from "@/server/domain/labels";
import { Card, CardHeader, DefinitionList, PageHeader } from "@/components/ui/card";
import { ProviderAvatar } from "@/components/domain/provider-avatar";
import { Badge, DemoBadge, StatusBadge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/form";
import { Mascot } from "@/components/brand/mascot";
import { ClientPriceBreakdown } from "@/components/domain/price";
import { MessageThread } from "@/components/domain/messages";
import { Timeline } from "@/components/domain/timeline";
import { formatDate, formatMoney } from "@/lib/format";
import { acceptQuoteAction, acceptReferralAction, cancelRequestAction, declineReferralAction, rejectQuoteAction } from "../../actions";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { TIME_WINDOWS } from "@/server/modules/requests";
import { DirectBooking, listOtherProviders } from "./direct-booking";

export const metadata = { title: "Solicitud" };

export default async function RequestDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const { id } = await params;
  const { nueva } = await searchParams;
  const actor = await requireActor(`/app/solicitudes/${id}`);
  const data = await getClientRequest(actor.id, id);
  if (!data) notFound();
  const { r, quotes, quoteItems, invitations, threads, job, photos, events } = data;
  const inv = Object.fromEntries(invitations.map((i) => [i.status, i.n])) as Record<string, number>;
  const invitedTotal = invitations.reduce((s, i) => s + i.n, 0);
  const open = ["submitted", "searching", "with_quotes", "no_coverage"].includes(r.status);
  const budget = r.request_mode === "budget" && r.budget_minor ? Number(r.budget_minor) : null;
  // Con presupuesto propio, las ofertas se ordenan de la más baja a la más alta.
  const sent = quotes.filter((q) => q.status === "sent").sort((a, b) => (budget ? a.subtotal_minor - b.subtotal_minor : 0));
  const other = quotes.filter((q) => q.status !== "sent");
  const path = `/app/solicitudes/${id}`;
  const activeInvite = data.invitationList.find((i) => ["invited", "viewed"].includes(i.status));
  const others = r.request_mode === "direct" && !activeInvite && open && r.category_id
    ? await listOtherProviders(r.category_id, r.property_id, id)
    : [];

  return (
    <>
      <PageHeader
        back={<Link href="/app/solicitudes" className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Solicitudes</Link>}
        eyebrow={`${r.code} · ${r.property_label}`}
        title={r.title}
        action={<StatusBadge status={r.status} labels={r.request_mode === "direct" ? { ...requestStatusLabel, searching: "Esperando al profesional", with_quotes: "Visita propuesta" } : requestStatusLabel} className="text-sm" />}
      />

      {data.referrals.map((ref) => (
        <Card key={ref.id} className="mb-6 ring-2 ring-fixy-500/30">
          <p className="text-sm font-semibold text-fixy-800">Recomendación</p>
          <h2 className="mt-1 text-lg font-bold">{ref.from_name} no puede tomarlo, pero te recomienda a un colega</h2>
          <div className="mt-3 flex items-center gap-3">
            <ProviderAvatar url={ref.to_avatar} name={ref.to_name} className="h-12 w-12 text-base" />
            <div>
              <Link href={`/profesionales/${ref.to_slug}`} className="font-bold hover:underline">{ref.to_name}</Link>
              <p className="text-sm">{ref.to_verified ? <span className="text-ok">Verificado</span> : <span className="text-warn">Todavía sin verificar: le pedimos que se verifique antes de aceptar.</span>}</p>
            </div>
          </div>
          {ref.note && <p className="mt-3 rounded-xl bg-cream px-3 py-2 text-[15px]">«{ref.note}»</p>}
          <div className="mt-4 flex flex-wrap gap-3">
            <ActionForm action={acceptReferralAction}><input type="hidden" name="referralId" value={ref.id} /><SubmitButton pendingText="Enviando…">Pedírselo a {ref.to_name.split(" ")[0]}</SubmitButton></ActionForm>
            <ActionForm action={declineReferralAction}><input type="hidden" name="referralId" value={ref.id} /><SubmitButton variant="ghost">Prefiero elegir otro</SubmitButton></ActionForm>
          </div>
        </Card>
      ))}
      {nueva && <Alert tone="ok" className="mb-6" title="¡Listo! Recibimos tu pedido">{r.request_mode === "direct" ? "Le avisamos al profesional que elegiste. Te avisamos por acá y por email cuando responda." : "Te avisamos por acá y por email cuando lleguen presupuestos."}</Alert>}
      {r.gated_community && r.gated_status !== "ready" && !job && (
        <Alert tone="warn" className="mb-6" title="Es un barrio cerrado: cargá el reglamento de ingreso">
          Así el profesional sabe qué seguros y documentación llevar. Lo interpretamos con IA y no mostramos el nombre del barrio ni tu dirección.{" "}
          <Link href={`/app/propiedades/${r.property_id}#barrio`}>Cargar reglamento</Link>
        </Alert>
      )}
      {job && (
        <Alert tone="ok" className="mb-6" title={`Contrataste este pedido · ${job.code}`}>
          <Link href={`/app/trabajos/${job.id}`}>Ir al trabajo</Link>
        </Alert>
      )}

      {/* Estado de la búsqueda */}
      {r.status === "submitted" && (
        <Card className="mb-6 flex items-center gap-4">
          <Mascot pose="think" className="h-24 w-auto" />
          <div>
            <h2 className="text-lg font-bold">Una persona del equipo está revisando tu pedido</h2>
            <p className="text-ink-2">{r.review_reason ?? "Lo derivamos al profesional adecuado."} Te avisamos cuando haya novedades.</p>
          </div>
        </Card>
      )}
      {r.status === "searching" && r.request_mode !== "direct" && (
        <Card className="mb-6 flex items-center gap-4">
          <Mascot pose="think" className="h-24 w-auto" />
          <div aria-live="polite">
            <h2 className="text-lg font-bold">{budget ? `Ofreciste ${formatMoney(budget)}: esperando ofertas` : "Buscando profesionales"}</h2>
            <p className="text-ink-2">
              {budget ? "Le avisamos a " : "Invitamos a "}{invitedTotal} profesional{invitedTotal === 1 ? "" : "es"} de tu zona{budget ? ": se anotan por tu precio o te ofrecen menos" : ""}.
              {inv.viewed ? ` ${inv.viewed} ya lo ${inv.viewed === 1 ? "vio" : "vieron"}.` : ""}
              {inv.declined ? ` ${inv.declined} no ${inv.declined === 1 ? "puede" : "pueden"} tomarlo.` : ""} Todavía no hay presupuestos.
            </p>
            <p className="mt-1 text-sm text-muted">No podemos asegurar tiempos de respuesta. Si nadie responde, el equipo de Fixy interviene.</p>
          </div>
        </Card>
      )}
      {r.status === "no_coverage" && (
        <Card className="mb-6 flex items-center gap-4">
          <Mascot pose="empathy" className="h-24 w-auto" />
          <div>
            <h2 className="text-lg font-bold">Estamos buscando un profesional para vos</h2>
            <p className="text-ink-2">Nuestro equipo ya está viendo tu pedido para conectarte con un profesional{r.category_name ? ` de ${r.category_name.toLowerCase()}` : ""}{r.zone_name && r.zone_name !== "Otra zona" ? ` en ${r.zone_name}` : ""}. Te avisamos apenas lo tome.</p>
          </div>
        </Card>
      )}
      {r.safety_flag === "emergency" && open && (
        <Alert tone="danger" className="mb-6" title="Si hay riesgo inmediato, priorizá tu seguridad">Fixy no reemplaza a los servicios de emergencia. Llamá al 911 o al servicio de emergencias correspondiente.</Alert>
      )}

      {/* Comparación de presupuestos */}
      {r.request_mode === "direct" && !job && open && (
        <DirectBooking requestId={id} r={r} invitations={data.invitationList} visit={sent[0] ?? null} others={others} />
      )}
      {r.request_mode === "direct" && !job && (() => {
        const current = data.invitationList.filter((i) => ["invited", "viewed", "quoted"].includes(i.status)).at(-1);
        const thread = current && threads.find((t) => t.provider_id === current.provider_id);
        return thread ? (
          <Card className="mb-8">
            <CardHeader title={`Chat con ${thread.provider_name}`} description="Contale lo que necesite saber para la visita. Por tu seguridad, no compartas teléfonos ni datos de pago: todo se coordina acá." />
            <MessageThread conversationId={thread.id} messages={thread.messages} path={path} disabled={!open} />
          </Card>
        ) : null;
      })()}

      {sent.length > 0 && r.request_mode !== "direct" && (
        <section aria-labelledby="quotes-title" className="mb-10">
          <h2 id="quotes-title" className="text-xl font-bold">{budget ? `Ofertas para tu presupuesto de ${formatMoney(budget)}` : "Compará los presupuestos"}</h2>
          <p className="mt-1 text-sm text-muted">
            {budget
              ? `${sent.length} profesional${sent.length === 1 ? "" : "es"} ${sent.length === 1 ? "se anotó" : "se anotaron"}. Ordenadas de la más baja a la más alta; los profesionales pueden seguir bajando su oferta hasta que elijas. El total incluye el cargo de servicio de Fixy.`
              : "Revisá qué incluye cada uno antes de confirmar. El total incluye el cargo de servicio de Fixy."}
          </p>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {sent.map((q) => {
              const items = quoteItems.filter((i) => i.quote_id === q.id);
              const thread = threads.find((t) => t.provider_id === q.provider_id);
              return (
                <Card key={q.id} as="article" className="flex flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link href={`/profesionales/${q.provider_slug}`} className="text-lg font-bold hover:underline">{q.provider_name}</Link>
                      {budget && (
                        <div className="mt-1">
                          {q.subtotal_minor < budget
                            ? <Badge tone="ok" icon={false}>{formatMoney(budget - q.subtotal_minor)} menos que tu presupuesto</Badge>
                            : <Badge tone="info" icon={false}>Por tu presupuesto</Badge>}
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-sm">
                        {q.reviews ? (
                          <span className="inline-flex items-center gap-1 font-semibold"><Star className="h-4 w-4 fill-spark text-spark" aria-hidden />{q.rating} <span className="font-normal text-muted">({q.reviews} reseña{q.reviews === 1 ? "" : "s"})</span></span>
                        ) : <Badge tone="neutral" icon={false}>Nuevo en Fixy</Badge>}
                        {q.provider_is_demo && <DemoBadge />}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted">Total</p>
                      <p className="tabular font-display text-2xl font-extrabold">{formatMoney(q.total_minor)}</p>
                    </div>
                  </div>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {q.identity_status === "verified" && <li><Badge tone="ok" icon={false}><BadgeCheck className="h-3.5 w-3.5" aria-hidden />Identidad verificada</Badge></li>}
                    {(q.credentials ?? []).map((c) => <li key={c}><Badge tone="ok" icon={false}><BadgeCheck className="h-3.5 w-3.5" aria-hidden />{c} vigente</Badge></li>)}
                    {q.completed_jobs > 0 && <li><Badge tone="neutral" icon={false}>{q.completed_jobs} trabajo{q.completed_jobs === 1 ? "" : "s"} en Fixy</Badge></li>}
                  </ul>
                  <div className="mt-4 rounded-2xl bg-cream/60 p-3 text-sm">
                    <p className="font-semibold">{modeLabel[q.mode]}</p>
                    <p className="text-muted">
                      {q.mode === "fixed" && "Precio cerrado por un alcance definido: es el precio confirmado si contratás."}
                      {q.mode === "quote" && "El total queda confirmado al contratar. Cualquier adicional requiere tu aprobación."}
                      {q.mode === "diagnostic" && "Pagás la visita. Después de revisar, el profesional te cotiza la reparación como adicional, que podés aceptar o no."}
                    </p>
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-muted">Qué incluye</h3>
                  <p className="mt-1 whitespace-pre-line text-[15px]">{q.scope}</p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {items.map((i, n) => (
                      <li key={n} className="flex justify-between gap-3"><span>{i.description}{i.quantity > 1 && ` × ${i.quantity}`}</span><span className="tabular text-muted">{formatMoney(i.amount_minor)}</span></li>
                    ))}
                  </ul>
                  <p className="mt-3 flex items-start gap-1.5 text-sm">
                    {q.materials_included ? <CircleCheck className="mt-0.5 h-4 w-4 text-ok" aria-hidden /> : <CircleMinus className="mt-0.5 h-4 w-4 text-warn" aria-hidden />}
                    {q.materials_included ? "Incluye los materiales detallados." : "No incluye materiales."}
                  </p>
                  {q.exclusions && <p className="mt-1 text-sm"><span className="font-semibold">No incluye:</span> {q.exclusions}</p>}
                  <ClientPriceBreakdown className="mt-4" a={{ laborMinor: q.labor_minor, materialsMinor: q.materials_minor, visitMinor: q.visit_minor, clientFeeMinor: q.client_fee_minor, clientFeeTaxMinor: q.client_fee_tax_minor, totalMinor: q.total_minor, clientRateBps: q.client_rate_bps }} />
                  <div className="mt-3 grid gap-1 text-sm text-ink-2">
                    {q.proposed_date && <p className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" aria-hidden />Propone: {formatDate(q.proposed_date)}{q.proposed_window && ` · ${q.proposed_window}`}</p>}
                    <p className="flex items-center gap-1.5"><Clock className="h-4 w-4" aria-hidden />Vigente hasta el {formatDate(q.valid_until)}</p>
                  </div>
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-semibold text-fixy-800">Condiciones de cancelación y reembolso</summary>
                    <p className="mt-1 text-ink-2">{q.cancellation_terms}</p>
                  </details>
                  <div className="mt-auto flex flex-wrap gap-2 pt-5">
                    <ConfirmAction
                      action={acceptQuoteAction}
                      label="Contratar"
                      title={`Contratar a ${q.provider_name}`}
                      confirmLabel={`Confirmar y pagar ${formatMoney(q.total_minor)}`}
                      hidden={{ quoteId: q.id, totalMinor: q.total_minor }}
                      description={
                        <>
                          <p>Vas a pagar <strong>{formatMoney(q.total_minor)}</strong> en total. Incluye {formatMoney(q.client_fee_minor)} de cargo de servicio.</p>
                          <p className="mt-2">Se crea una orden de trabajo con este alcance y precio, que quedan guardados. El pago se hace en la pasarela{" "}
                            <strong>(modo de prueba: no se cobra dinero real)</strong>. Fixy no ofrece custodia de fondos.</p>
                        </>
                      }
                    >
                      <label className="mt-4 flex items-start gap-3 text-[15px]">
                        <input type="checkbox" name="acceptTerms" required className="mt-0.5 h-5 w-5 accent-fixy-700" />
                        <span>Revisé el alcance, las exclusiones, el total y las condiciones de cancelación.</span>
                      </label>
                    </ConfirmAction>
                    <ConfirmAction action={rejectQuoteAction} variant="secondary" label="No me interesa" title="Descartar este presupuesto" description="Le avisamos al profesional. Podés contarle por qué (opcional)." confirmLabel="Descartar" hidden={{ quoteId: q.id, requestId: id }}>
                      <label htmlFor={`rr-${q.id}`} className="mt-4 block text-[15px] font-semibold">Motivo (opcional)</label>
                      <textarea id={`rr-${q.id}`} name="reason" className="mt-1 block min-h-20 w-full rounded-xl border border-[#d3dfdc] px-3.5 py-2" />
                    </ConfirmAction>
                  </div>
                  {thread && (
                    <details className="mt-4 border-t border-line pt-3">
                      <summary className="inline-flex cursor-pointer items-center gap-1.5 font-semibold text-fixy-800"><MessageCircle className="h-4 w-4" aria-hidden />Hacer una consulta ({thread.messages.length})</summary>
                      <div className="mt-3"><MessageThread conversationId={thread.id} messages={thread.messages} path={path} disabled={!open} /></div>
                    </details>
                  )}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader title="Tu pedido" />
          <p className="whitespace-pre-line text-[15px]">{r.description}</p>
          {photos.length > 0 && (
            <ul className="mt-4 grid grid-cols-3 gap-2">
              {photos.map((u, i) => <li key={i}><a href={u} target="_blank" rel="noreferrer"><img src={u} alt={`Foto ${i + 1} del pedido`} className="aspect-square w-full rounded-xl object-cover" /></a></li>)}
            </ul>
          )}
          <DefinitionList className="mt-4" items={[
            ["Tipo de profesional", r.category_name ?? "A definir por el equipo"],
            ...(r.service_name ? [["Servicio", r.service_name] as [string, string]] : []),
            ["Lugar", `${r.property_label} · ${r.zone_name}`],
            ["Urgencia", urgencyLabel[r.urgency]],
            ["Franjas", r.preferred_windows.length ? r.preferred_windows.map((w) => TIME_WINDOWS.find((t) => t.key === w)?.label ?? w).join(", ") : "Sin preferencia"],
            ...data.questions.filter((qq) => r.answers[qq.key] !== undefined && r.answers[qq.key] !== "").map((qq) => [qq.label, typeof r.answers[qq.key] === "boolean" ? (r.answers[qq.key] ? "Sí" : "No") : String(r.answers[qq.key])] as [string, string]),
            ["Información de acceso", data.accessInfo || "—"],
          ]} />
          <p className="mt-2 text-xs text-muted">La dirección y la información de acceso solo las ve el profesional que elegiste, cuando confirmás la visita.</p>
          {open && (
            <div className="mt-5">
              <ConfirmAction action={cancelRequestAction} variant="danger" size="sm" label="Cancelar pedido" title="¿Cancelar este pedido?" description="Les avisamos a los profesionales invitados y se descartan los presupuestos." confirmLabel="Cancelar pedido" requireReason hidden={{ requestId: id }} />
            </div>
          )}
        </Card>
        <div className="space-y-6">
          {other.length > 0 && (
            <Card>
              <CardHeader title="Otros presupuestos" />
              <ul className="space-y-2 text-[15px]">
                {other.map((q) => (
                  <li key={q.id} className="flex items-center justify-between gap-2"><span>{q.provider_name} · {formatMoney(q.total_minor)}</span><StatusBadge status={q.status} labels={quoteStatusLabel} /></li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Historial" />
            <Timeline events={events} kind="request" />
          </Card>
          {!open && !job && <ButtonLink href="/solicitar" variant="secondary">Hacer un pedido nuevo</ButtonLink>}
        </div>
      </div>
    </>
  );
}
