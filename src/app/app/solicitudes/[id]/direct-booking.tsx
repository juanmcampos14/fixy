import { CalendarDays, Star } from "lucide-react";
import { sql } from "@/server/db/client";
import { listBookableProviders, type BookableProvider } from "@/server/modules/booking";
import { Card } from "@/components/ui/card";
import { ConfirmAction } from "@/components/ui/form";
import { Mascot } from "@/components/brand/mascot";
import { ClientPriceBreakdown } from "@/components/domain/price";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { acceptQuoteAction, chooseProviderAction, switchToQuotesAction } from "../../actions";

export async function listOtherProviders(categoryId: string, propertyId: string, requestId: string) {
  const [p] = await sql()<{ zone_id: string; windows: string[]; sandbox: boolean }[]>`
    select p.zone_id, r.preferred_windows as windows, u.sandbox from properties p join service_requests r on r.property_id = p.id join users u on u.id = r.created_by where r.id = ${requestId} and p.id = ${propertyId}`;
  if (!p) return [];
  return listBookableProviders(sql(), { categoryId, zoneId: p.zone_id, preferredWindows: p.windows ?? [], excludeInvitedFor: requestId, limit: 6, sandbox: p.sandbox });
}

type Invite = { id: string; status: string; respond_by: Date | null; provider_name: string; provider_slug: string };
type Visit = {
  id: string; provider_name: string; provider_slug: string; scope: string; proposed_date: string | null; proposed_window: string | null; valid_until: Date;
  labor_minor: number; materials_minor: number; visit_minor: number; client_fee_minor: number; client_fee_tax_minor: number; total_minor: number; client_rate_bps: number;
};

export function DirectBooking({ requestId, invitations, visit, others }: { requestId: string; r: { id: string }; invitations: Invite[]; visit: Visit | null; others: BookableProvider[] }) {
  const active = invitations.find((i) => ["invited", "viewed"].includes(i.status));
  const last = [...invitations].reverse().find((i) => ["declined", "expired"].includes(i.status));
  return (
    <div className="mb-8 space-y-4">
      {visit && (
        <Card className="ring-2 ring-fixy-500/30">
          <div className="flex flex-wrap items-start gap-4">
            <Mascot pose="celebrate" className="h-20 w-auto" />
            <div className="min-w-0 flex-1">
              <h2 className="text-xl font-bold">{visit.provider_name} aceptó tu pedido</h2>
              <p className="mt-1 flex items-center gap-1.5 text-ink-2"><CalendarDays className="h-4 w-4" aria-hidden />Propone visitarte el <strong>{visit.proposed_date ? formatDate(visit.proposed_date) : "día a coordinar"}</strong>{visit.proposed_window && <> · {visit.proposed_window}</>}</p>
              <p className="mt-2 whitespace-pre-line text-[15px]">{visit.scope}</p>
            </div>
          </div>
          {visit.total_minor > 0 ? (
            <ClientPriceBreakdown className="mt-4" title="Visita" a={{ laborMinor: visit.labor_minor, materialsMinor: visit.materials_minor, visitMinor: visit.visit_minor, clientFeeMinor: visit.client_fee_minor, clientFeeTaxMinor: visit.client_fee_tax_minor, totalMinor: visit.total_minor, clientRateBps: visit.client_rate_bps }} />
          ) : <p className="mt-4 rounded-xl bg-ok-bg/70 p-3 font-semibold text-ok">La visita es sin cargo.</p>}
          <p className="mt-3 text-sm text-muted">Confirmá antes del {formatDateTime(visit.valid_until)}. Después de confirmar, le compartimos la dirección y los datos de acceso al profesional. El arreglo se presupuesta en el lugar y solo se hace si lo aprobás en la app.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ConfirmAction action={acceptQuoteAction} label={visit.total_minor > 0 ? `Confirmar y pagar la visita (${formatMoney(visit.total_minor)})` : "Confirmar visita"} title="Confirmar la visita"
              confirmLabel={visit.total_minor > 0 ? `Confirmar y pagar ${formatMoney(visit.total_minor)}` : "Confirmar visita"} hidden={{ quoteId: visit.id, totalMinor: visit.total_minor }}
              description={visit.total_minor > 0 ? <>El pago se procesa en la pasarela <strong>(modo de prueba: no se cobra dinero real)</strong>. Fixy no custodia fondos.</> : "Le confirmamos la visita al profesional."}>
              <label className="mt-4 flex items-start gap-3 text-[15px]"><input type="checkbox" name="acceptTerms" required className="mt-0.5 h-5 w-5 accent-fixy-700" /><span>Entiendo que el arreglo se presupuesta en el lugar y que lo apruebo (o no) en la app.</span></label>
            </ConfirmAction>
          </div>
        </Card>
      )}

      {!visit && active && (
        <Card className="flex flex-wrap items-center gap-4">
          <Mascot pose="think" className="h-24 w-auto" />
          <div className="min-w-0 flex-1" aria-live="polite">
            <h2 className="text-lg font-bold">Esperando que {active.provider_name} acepte</h2>
            <p className="text-ink-2">{active.respond_by ? <>Tiene hasta el <strong>{formatDateTime(active.respond_by)}</strong> para responder y proponerte día y horario.</> : "Te avisamos cuando responda."} Mientras, pueden hablar por el chat de abajo.</p>
            <p className="mt-1 text-sm text-muted">Si no puede o no responde a tiempo, elegís a otro profesional. No se cobra nada hasta que confirmes la visita.</p>
          </div>
        </Card>
      )}

      {!visit && !active && (
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <Mascot pose="empathy" className="h-20 w-auto" />
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-bold">{last ? `${last.provider_name} ${last.status === "declined" ? "no puede tomar tu pedido" : "no respondió a tiempo"}` : "Elegí un profesional"}</h2>
              <p className="text-ink-2">Elegí otro profesional de la lista. No se te cobró nada.</p>
            </div>
          </div>
        </Card>
      )}

      {!active && others.length > 0 && (
        <section aria-labelledby="others-title">
          <h2 id="others-title" className="mb-3 text-lg font-bold">{visit ? "¿Preferís otro profesional?" : "Otros profesionales disponibles"}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {others.map((p) => (
              <li key={p.slug} className="flex flex-col rounded-2xl bg-surface p-4 ring-1 ring-line">
                <a href={`/profesionales/${p.slug}`} target="_blank" rel="noreferrer" className="font-bold hover:underline">{p.displayName}</a>
                <p className="mt-0.5 text-sm text-muted">
                  {p.reviews ? <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-spark text-spark" aria-hidden />{p.rating} ({p.reviews})</span> : "Nuevo en Fixy"}
                  {" · "}{p.visitFeeMinor > 0 ? `Visita ${formatMoney(p.visitFeeMinor)}` : "Visita sin cargo"}
                </p>
                <div className="mt-3">
                  <ConfirmAction action={chooseProviderAction} variant="secondary" size="sm" label="Elegir" title={`Pedir visita a ${p.displayName}`} confirmLabel="Enviar pedido"
                    description={visit ? "Se descarta la propuesta de visita actual y le enviamos tu pedido a este profesional." : "Le enviamos tu pedido. Tiene unas horas para aceptar."}
                    hidden={{ requestId, providerSlug: p.slug }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!active && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-control p-4">
          <p className="min-w-0 flex-1 text-sm text-ink-2">¿Es una obra grande o preferís comparar? Podés pedir presupuestos a varios profesionales.</p>
          <ConfirmAction action={switchToQuotesAction} variant="ghost" size="sm" label="Pedir presupuestos a varios" title="Pedir presupuestos a varios profesionales" confirmLabel="Pedir presupuestos" hidden={{ requestId }}
            description="Invitamos a un grupo acotado de profesionales de tu zona a presupuestar y comparás las propuestas." />
        </div>
      )}
    </div>
  );
}
