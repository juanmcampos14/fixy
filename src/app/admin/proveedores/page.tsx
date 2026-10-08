import Link from "next/link";
import { requireStaff } from "@/server/auth/session";
import { listProviders } from "@/server/queries/admin";
import { identityStatusLabel, payoutsStatusLabel, providerStatusLabel } from "@/server/domain/labels";
import { PageHeader } from "@/components/ui/card";
import { Badge, DemoBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Input, Select } from "@/components/ui/field";
import { DataTable, FilterBar, FilterField, Td, Th } from "@/components/admin/ui";
import { formatDate } from "@/lib/format";

export const metadata = { title: "Proveedores" };

export default async function ProvidersAdmin({ searchParams }: { searchParams: Promise<{ estado?: string; q?: string }> }) {
  const sp = await searchParams;
  const actor = await requireStaff();
  const status = sp.estado && providerStatusLabel[sp.estado] ? sp.estado : undefined;
  const q = sp.q?.trim() || undefined;
  const rows = await listProviders(actor.id, { status, q });
  return (
    <>
      <PageHeader eyebrow="Operación" title="Proveedores" description="Altas, documentación, habilitación y suspensiones. Los estados operativo, de identidad y de cobros son independientes." />
      <FilterBar action="/admin/proveedores" clearHref="/admin/proveedores">
        <FilterField label="Estado" htmlFor="f-estado">
          <Select id="f-estado" name="estado" defaultValue={status ?? ""}>
            <option value="">Todos</option>
            {Object.entries(providerStatusLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Buscar por nombre" htmlFor="f-q" className="min-w-56">
          <Input id="f-q" name="q" defaultValue={q ?? ""} placeholder="Nombre comercial o razón social" />
        </FilterField>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState title="No hay proveedores con esos filtros" description="Probá con otro estado o limpiá la búsqueda." />
      ) : (
        <DataTable caption="Proveedores" minWidth={880}>
          <thead>
            <tr><Th>Proveedor</Th><Th>Especialidades</Th><Th>Operativo</Th><Th>Identidad</Th><Th>Cobros</Th><Th>Docs. pendientes</Th><Th>Alta</Th></tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-cream/40">
                <Td>
                  <Link href={`/admin/proveedores/${p.id}`} className="font-semibold text-fixy-800 hover:underline">{p.display_name}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {p.kind === "company" ? "Empresa" : "Independiente"}
                    {!p.accepting_jobs && <Badge tone="neutral" icon={false}>Pausado</Badge>}
                    {p.is_demo && <DemoBadge />}
                  </div>
                </Td>
                <Td className="max-w-56 text-sm text-ink-2">{p.categories.length ? p.categories.join(", ") : <span className="text-muted">Sin especialidades</span>}</Td>
                <Td><StatusBadge status={p.status} labels={providerStatusLabel} /></Td>
                <Td><StatusBadge status={p.identity_status} labels={identityStatusLabel} /></Td>
                <Td><StatusBadge status={p.payouts_status} labels={payoutsStatusLabel} /></Td>
                <Td className="tabular">{p.pending_docs ? <Badge tone="warn">{p.pending_docs}</Badge> : <span className="text-muted">0</span>}</Td>
                <Td className="text-sm text-muted">{formatDate(p.created_at)}{p.submitted_at && <div>Enviado {formatDate(p.submitted_at)}</div>}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
