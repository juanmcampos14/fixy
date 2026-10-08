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
import { updatePropertyAction } from "../../actions";

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
           (select coalesce(sum(j.total_minor), 0)::bigint from jobs j where j.property_id = ${id} and j.status <> 'cancelled') as contracted
    from charges c join jobs j on j.id = c.job_id where j.property_id = ${id}`;
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
