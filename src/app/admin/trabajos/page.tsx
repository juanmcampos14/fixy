import Link from "next/link";
import { requireSection } from "@/server/auth/session";
import { listJobs, providerOptions } from "@/server/queries/admin";
import { jobStatusLabelProvider, payoutStatusLabel } from "@/server/domain/labels";
import { PageHeader } from "@/components/ui/card";
import { Badge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Input, Select } from "@/components/ui/field";
import { DataTable, FilterBar, FilterField, Td, Th } from "@/components/admin/ui";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata = { title: "Trabajos" };

export default async function JobsAdmin({ searchParams }: { searchParams: Promise<{ estado?: string; proveedor?: string; q?: string }> }) {
  const sp = await searchParams;
  const actor = (await requireSection("trabajos")).actor;
  const providers = await providerOptions(actor.id);
  const status = sp.estado && jobStatusLabelProvider[sp.estado] ? sp.estado : undefined;
  const providerId = providers.some((p) => p.id === sp.proveedor) ? sp.proveedor : undefined;
  const q = sp.q?.trim() || undefined;
  const rows = await listJobs(actor.id, { status, providerId, q });

  return (
    <>
      <PageHeader eyebrow="Operación" title="Trabajos" description="Órdenes contratadas: ejecución, pagos, liquidación y reclamos." />
      <FilterBar action="/admin/trabajos" clearHref="/admin/trabajos">
        <FilterField label="Estado" htmlFor="f-estado">
          <Select id="f-estado" name="estado" defaultValue={status ?? ""}>
            <option value="">Todos</option>
            {Object.entries(jobStatusLabelProvider).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Proveedor" htmlFor="f-prov">
          <Select id="f-prov" name="proveedor" defaultValue={providerId ?? ""}>
            <option value="">Todos</option>
            {providers.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Código o título" htmlFor="f-q">
          <Input id="f-q" name="q" defaultValue={q ?? ""} placeholder="Ej.: T-503" />
        </FilterField>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState title="No hay trabajos con esos filtros" description="Probá con otros filtros." />
      ) : (
        <DataTable caption="Trabajos" minWidth={920}>
          <thead>
            <tr><Th>Trabajo</Th><Th>Proveedor</Th><Th>Cliente</Th><Th>Estado</Th><Th>Total pactado</Th><Th>Fecha</Th><Th>Liquidación</Th></tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.id} className={j.open_dispute ? "bg-warn-bg/30" : "hover:bg-cream/40"}>
                <Td>
                  <Link href={`/admin/trabajos/${j.id}`} className="font-semibold text-fixy-800 hover:underline">{j.code}</Link>
                  <div className="max-w-60 text-sm text-ink-2">{j.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {j.open_dispute && <Badge tone="warn">Reclamo abierto</Badge>}
                    {j.has_test && <TestModeBadge />}
                  </div>
                </Td>
                <Td className="text-sm"><Link href={`/admin/proveedores/${j.provider_id}`} className="hover:underline">{j.provider_name}</Link></Td>
                <Td className="text-sm">{j.client_name}</Td>
                <Td><StatusBadge status={j.status} labels={jobStatusLabelProvider} /></Td>
                <Td className="tabular">{formatMoney(j.total_minor)}</Td>
                <Td className="text-sm text-muted">{j.scheduled_date ? formatDate(j.scheduled_date) : "Sin fecha"}</Td>
                <Td>
                  {j.payout_status ? (
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={j.payout_status} labels={payoutStatusLabel} />
                      {j.payout_on_hold && <Badge tone="danger">Retenida</Badge>}
                    </div>
                  ) : <span className="text-sm text-muted">—</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
