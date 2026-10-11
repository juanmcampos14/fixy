import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download, Plus } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { getOrganization, orgFilterOptions, orgJobs, type OrgFilters } from "@/server/queries/org";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { DemoBadge, StatusBadge } from "@/components/ui/badge";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/field";
import { jobStatusLabel, propertyKindLabel } from "@/server/domain/labels";
import { formatDate, formatMoney } from "@/lib/format";
import { OrgForm } from "../org-form";
import { addMemberAction, removeMemberAction, updateOrganizationAction } from "../../actions";

export default async function OrgDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<OrgFilters> }) {
  const { id } = await params;
  const raw = await searchParams;
  const f: OrgFilters = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v)) as OrgFilters;
  const actor = await requireActor();
  const data = await getOrganization(actor.id, id);
  if (!data) notFound();
  const { org, members, sites } = data;
  const isAdmin = org.role === "admin";
  const [rows, opts] = await Promise.all([orgJobs(actor.id, id, f), orgFilterOptions(actor.id, id)]);
  const totals = rows.reduce((t, r) => ({ contracted: t.contracted + (r.status === "cancelled" ? 0 : r.contracted_minor), paid: t.paid + r.paid_minor - r.refunded_minor }), { contracted: 0, paid: 0 });
  const qs = new URLSearchParams(f as Record<string, string>).toString();
  return (
    <>
      <PageHeader
        back={<Link href="/app/organizaciones" className="inline-flex items-center gap-1 text-sm font-semibold text-fixy-800 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Organizaciones</Link>}
        eyebrow={isAdmin ? "Sos administrador/a" : "Sos miembro"}
        title={<span className="inline-flex flex-wrap items-center gap-2">{org.name}{org.is_demo && <DemoBadge />}</span>}
        action={<ButtonLink href="/solicitar"><Plus className="h-4 w-4" aria-hidden />Nuevo pedido</ButtonLink>}
      />

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-bold">Sedes</h2>{isAdmin && <ButtonLink size="sm" variant="secondary" href={`/app/propiedades/nueva?org=${id}`}><Plus className="h-4 w-4" aria-hidden />Agregar sede</ButtonLink>}</div>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s) => (
            <li key={s.id}><Link href={`/app/propiedades/${s.id}`} className="block rounded-2xl bg-surface p-4 ring-1 ring-line hover:ring-fixy-500">
              <p className="font-bold">{s.label}</p>
              <p className="text-sm text-muted">{propertyKindLabel[s.kind]} · {s.zone_name}</p>
              <p className="mt-2 text-sm"><span className="font-semibold">{s.jobs}</span> trabajos · <span className="tabular font-semibold">{formatMoney(s.spent_minor)}</span> pagado</p>
            </Link></li>
          ))}
          {sites.length === 0 && <li className="text-muted">Todavía no hay sedes.</li>}
        </ul>
      </section>

      <Card className="mb-8">
        <CardHeader title="Historial y gastos" description={isAdmin ? "Todos los trabajos de la organización." : "Los trabajos que creaste o tenés asignados."}
          action={<a href={`/api/organizaciones/${id}/export${qs ? `?${qs}` : ""}`} className={buttonClass("secondary", "sm")}><Download className="h-4 w-4" aria-hidden />Exportar CSV</a>} />
        <form className="mb-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-6" method="get">
          <Field label="Desde" htmlFor="from"><Input id="from" name="from" type="date" defaultValue={f.from} /></Field>
          <Field label="Hasta" htmlFor="to"><Input id="to" name="to" type="date" defaultValue={f.to} /></Field>
          <Field label="Sede" htmlFor="siteId"><Select id="siteId" name="siteId" defaultValue={f.siteId ?? ""}><option value="">Todas</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
          <Field label="Proveedor" htmlFor="providerId"><Select id="providerId" name="providerId" defaultValue={f.providerId ?? ""}><option value="">Todos</option>{opts.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Categoría" htmlFor="categoryId"><Select id="categoryId" name="categoryId" defaultValue={f.categoryId ?? ""}><option value="">Todas</option>{opts.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Estado" htmlFor="status"><Select id="status" name="status" defaultValue={f.status ?? ""}><option value="">Todos</option>{Object.entries(jobStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <div className="flex gap-2 sm:col-span-3 lg:col-span-6"><button className={buttonClass("primary", "sm")}>Filtrar</button><Link href={`/app/organizaciones/${id}`} className={buttonClass("ghost", "sm")}>Limpiar</Link></div>
        </form>
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Trabajos" value={rows.length} />
          <Stat label="Contratado" value={formatMoney(totals.contracted)} hint="Excluye cancelados" />
          <Stat label="Pagado (neto de reembolsos)" value={formatMoney(totals.paid)} />
        </div>
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Trabajos de la organización</caption>
            <thead className="text-muted"><tr className="border-b border-line">{["Fecha", "Trabajo", "Sede", "Proveedor", "Responsable", "Estado", "Contratado", "Pagado"].map((h) => <th key={h} scope="col" className="py-2 pr-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/70">
                  <td className="py-2.5 pr-3 whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="py-2.5 pr-3"><Link href={`/app/trabajos/${r.id}`} className="font-semibold hover:underline">{r.code}</Link><span className="block text-muted">{r.title}</span></td>
                  <td className="py-2.5 pr-3">{r.site}</td>
                  <td className="py-2.5 pr-3">{r.provider}</td>
                  <td className="py-2.5 pr-3">{r.responsible ?? "—"}</td>
                  <td className="py-2.5 pr-3"><StatusBadge status={r.status} labels={jobStatusLabel} /></td>
                  <td className="tabular py-2.5 pr-3">{formatMoney(r.contracted_minor)}</td>
                  <td className="tabular py-2.5">{formatMoney(r.paid_minor - r.refunded_minor)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted">No hay trabajos con estos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Miembros" description="Los administradores gestionan sedes, miembros y ven todos los trabajos." />
          <ul className="divide-y divide-line">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center justify-between gap-3 py-2.5">
                <span><span className="font-semibold">{m.full_name}</span><span className="block text-sm text-muted">{m.role === "admin" ? "Administrador/a" : "Miembro"}</span></span>
                {isAdmin && m.user_id !== actor.id && <ConfirmAction action={removeMemberAction} variant="ghost" size="sm" label="Quitar" title={`Quitar a ${m.full_name}`} confirmLabel="Quitar" hidden={{ organizationId: id, userId: m.user_id }} />}
              </li>
            ))}
          </ul>
          {isAdmin && (
            <ActionForm action={addMemberAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end" resetOnSuccess>
              <input type="hidden" name="organizationId" value={id} />
              <Field label="Email de la persona" htmlFor="m-email" required hint="Tiene que tener una cuenta en Fixy."><Input id="m-email" name="email" type="email" required /></Field>
              <Field label="Rol" htmlFor="m-role" required><Select id="m-role" name="role"><option value="member">Miembro</option><option value="admin">Administrador/a</option></Select></Field>
              <SubmitButton size="md">Agregar</SubmitButton>
            </ActionForm>
          )}
          <p className="mt-4 text-xs text-muted">Próximamente: aprobaciones por monto y centros de costo (el modelo ya está preparado).</p>
        </Card>
        <Card>
          <CardHeader title="Datos de contacto y facturación" />
          {isAdmin ? <OrgForm action={updateOrganizationAction} values={org} hidden={{ organizationId: id }} /> : (
            <dl className="space-y-2 text-[15px]"><div><dt className="text-muted">CUIT</dt><dd>{org.tax_id ?? "—"}</dd></div><div><dt className="text-muted">Email de facturación</dt><dd>{org.billing_email ?? "—"}</dd></div></dl>
          )}
        </Card>
      </div>
    </>
  );
}
