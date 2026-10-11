import type { Metadata } from "next";
import Link from "next/link";
import { getOnboardingState, listInvitations, requireProviderContext } from "@/server/queries/provider";
import { rematchOpenRequests } from "@/server/modules/requests";
import { urgencyLabel, quoteStatusLabel } from "@/server/domain/labels";
import { Card, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { CategoryIcon } from "@/components/category-icon";
import { INVITATION_STATUS_LABEL } from "@/components/provider/constants";
import { formatMoney, relativeTime } from "@/lib/format";

export const metadata: Metadata = { title: "Oportunidades" };

const TONE: Record<string, Tone> = { invited: "brand", viewed: "info", quoted: "ok", declined: "neutral", expired: "neutral", closed: "neutral" };

export default async function OpportunitiesPage() {
  const { actor, provider } = await requireProviderContext({ adminOnly: true });
  // Al entrar, se suman los pedidos abiertos de su rubro y zona que todavía no le llegaron (por ejemplo, si se registró después).
  await rematchOpenRequests({ providerId: provider.id }).catch(() => 0);
  const [rows, state] = await Promise.all([listInvitations(actor.id, provider.id), getOnboardingState(actor.id, provider.id)]);
  const open = rows.filter((r) => r.status === "invited" || r.status === "viewed");
  const rest = rows.filter((r) => !(r.status === "invited" || r.status === "viewed"));
  return (
    <>
      <PageHeader title="Oportunidades" description="Solicitudes de tu zona y especialidad a las que te invitamos a cotizar." />
      {state && !state.eligibility.eligible && (
        <Alert tone="warn" title="Te llegan pedidos, pero para aceptarlos tenés que verificar tu cuenta" className="mb-5">
          <ul className="list-disc pl-5">{state.eligibility.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <Link href="/proveedor/alta" className="mt-2 inline-block font-semibold underline">Completar ahora</Link>
        </Alert>
      )}
      {rows.length === 0 ? (
        <EmptyState pose="empathy" title="Todavía no hay oportunidades" description="Cuando haya una solicitud que coincida con tus especialidades, zonas y disponibilidad, te avisamos." />
      ) : (
        <div className="space-y-6">
          <Section title={`Para cotizar (${open.length})`} rows={open} empty="No tenés oportunidades pendientes." />
          {rest.length > 0 && <Section title="Historial" rows={rest} />}
        </div>
      )}
    </>
  );
}

function Section({ title, rows, empty }: { title: string; rows: Awaited<ReturnType<typeof listInvitations>>[number][]; empty?: string }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-muted">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <Card as="li" key={r.id} className="p-0 sm:p-0">
              <Link href={`/proveedor/oportunidades/${r.id}`} className="flex items-start gap-3 rounded-[var(--radius-card)] p-4 hover:bg-cream/40 sm:p-5">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fixy-50 text-fixy-800"><CategoryIcon icon={r.category_icon ?? "wrench"} className="h-5 w-5" /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.title}</span>
                    <Badge tone={TONE[r.status] ?? "neutral"}>{INVITATION_STATUS_LABEL[r.status] ?? r.status}</Badge>
                    {r.budget_minor && <Badge tone="brand" icon={false}>El cliente ofrece {formatMoney(r.budget_minor)}</Badge>}
                    {r.quote_status && r.status === "quoted" && <Badge tone="neutral" icon={false}>Presupuesto: {quoteStatusLabel[r.quote_status] ?? r.quote_status}</Badge>}
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {r.code} · {r.category_name ?? "Sin categoría"} · {urgencyLabel[r.urgency] ?? r.urgency} · {relativeTime(r.created_at)}
                  </span>
                </span>
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </section>
  );
}
