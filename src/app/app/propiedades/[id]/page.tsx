import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import { getProperty, listClientJobs, listClientRequests } from "@/server/queries/client";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { JobRow, RequestRow } from "@/components/client/cards";
import { PropertyForm } from "@/components/client/property-form";
import { propertyKindLabel } from "@/server/domain/labels";
import { formatMoney } from "@/lib/format";
import { saveGatedRulesAction, updatePropertyAction } from "../../actions";
import { GatedRulesForm } from "@/components/client/gated-rules-form";
import { AccessRequirementsView } from "@/components/domain/access-requirements";
import { AddressPrivacyNote } from "@/components/location/privacy-note";
import { signedFileUrl } from "@/server/storage";
import { formatDateTime } from "@/lib/format";

export const maxDuration = 120;

export default async function PropertyDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();
  const data = await getProperty(actor.id, id);
  if (!data) notFound();
  const { p, providers } = data;
  const [jobs, reqs] = await Promise.all([listClientJobs(actor.id, { propertyId: id }), listClientRequests(actor.id, { propertyId: id })]);
  const [{ canManage }] = await sql()<{ canManage: boolean }[]>`select app.can_manage_property(${actor.id}, ${id}) as "canManage"`;
  const [money] = await sql()<{ paid: number; refunded: number; contracted: number }[]>`
    select coalesce(sum(c.amount_minor) filter (where c.status in ('approved','partially_refunded','refunded')), 0)::bigint as paid,
           coalesce(sum(c.refunded_minor), 0)::bigint as refunded,
           (select coalesce(sum(j.total_minor), 0)::bigint from jobs j where j.property_id = ${id} and j.status <> 'cancelled' and app.is_job_client(${actor.id}, j.id)) as contracted
    from charges c join jobs j on j.id = c.job_id where j.property_id = ${id} and app.is_job_client(${actor.id}, j.id)`;
  const openReqs = reqs.filter((r) => !r.job_id);
  return (
    <>
      <PageHeader
        back={<Link href="/app/propiedades" className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Propiedades</Link>}
        eyebrow={`${propertyKindLabel[p.kind]}${p.org_name ? ` · ${p.org_name}` : ""}`}
        title={p.label}
        description={`${p.address_line}${p.address_extra ? `, ${p.address_extra}` : ""} · ${p.zone_name}`}
        action={<ButtonLink href="/solicitar"><Plus className="h-4 w-4" aria-hidden />Nuevo pedido</ButtonLink>}
      />
      <AddressPrivacyNote className="mb-6" />
      {p.gated_community && (
        <Card className="mb-8" id="barrio">
          <CardHeader
            title={`Ingreso al barrio${p.gated_name ? ` · ${p.gated_name}` : ""}`}
            description="Esto es lo que ve el profesional antes de aceptar (sin el nombre del barrio ni la dirección), para llegar con todo lo necesario."
          />
          {p.gated_requirements_status === "failed" && <p className="mb-3 text-sm text-warn">No pudimos interpretar el último reglamento. Probá con otro archivo o escribí los requisitos.</p>}
          <AccessRequirementsView req={p.gated_requirements} notes={p.gated_client_notes} audience="client" />
          {p.gated_requirements_updated_at && <p className="mt-2 text-xs text-muted">Actualizado {formatDateTime(p.gated_requirements_updated_at)}.{p.gated_rules_file_id && <> <a className="font-semibold text-fixy-800 underline" href={signedFileUrl(p.gated_rules_file_id, 900)} target="_blank" rel="noreferrer">Ver reglamento subido</a></>}</p>}
          {canManage && (
            <details className="mt-5 rounded-2xl bg-cream p-4" open={!p.gated_requirements}>
              <summary className="cursor-pointer font-semibold">{p.gated_requirements ? "Actualizar reglamento" : "Cargar reglamento del barrio"}</summary>
              <div className="mt-4">
                <GatedRulesForm action={saveGatedRulesAction} propertyId={id} hasFile={!!p.gated_rules_file_id}
                  defaults={{ url: p.gated_rules_url ?? "", text: p.gated_rules_text ?? "", notes: p.gated_client_notes ?? "" }} />
              </div>
            </details>
          )}
        </Card>
      )}
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat label="Contratado" value={formatMoney(money.contracted)} hint="Total de trabajos no cancelados" />
        <Stat label="Pagado" value={formatMoney(money.paid - money.refunded)} hint="Neto de reembolsos" />
        <Stat label="Trabajos" value={jobs.length} hint={`${jobs.filter((j) => j.status === "completed").length} completados`} />
      </div>
      <section className="mb-8">
        <h2 className="mb-3 text-lg font-bold">Historial de trabajos</h2>
        {jobs.length ? <ul className="space-y-3">{jobs.map((j) => <JobRow key={j.id} j={j} />)}</ul> : <p className="text-muted">Todavía no hay trabajos en esta propiedad.</p>}
      </section>
      {openReqs.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold">Pedidos sin contratar</h2>
          <ul className="space-y-3">{openReqs.map((r) => <RequestRow key={r.id} r={r} />)}</ul>
        </section>
      )}
      {providers.length > 0 && (
        <Card className="mb-8">
          <CardHeader title="Profesionales que ya trabajaron acá" />
          <ul className="divide-y divide-line">
            {providers.map((pr) => (
              <li key={pr.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <Link href={`/profesionales/${pr.slug}`} className="font-semibold hover:underline">{pr.display_name}</Link>
                <span className="text-sm text-muted">{pr.jobs} trabajo{pr.jobs === 1 ? "" : "s"}</span>
                <ButtonLink size="sm" variant="secondary" href={`/solicitar?proveedor=${pr.slug}`}>Pedir presupuesto</ButtonLink>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {canManage && (
        <Card>
          <CardHeader title="Datos de la propiedad" />
          <PropertyForm action={updatePropertyAction} values={p} hidden={{ propertyId: id }} />
        </Card>
      )}
    </>
  );
}
