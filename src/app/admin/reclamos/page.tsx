import Link from "next/link";
import { requireStaff } from "@/server/auth/session";
import { listDisputes } from "@/server/queries/admin";
import { disputeReasonLabel, disputeResolutionLabel, disputeStatusLabel, jobStatusLabelProvider, payoutStatusLabel } from "@/server/domain/labels";
import { PageHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { DataTable, Tabs, Td, Th } from "@/components/admin/ui";
import { formatDateTime, relativeTime } from "@/lib/format";

export const metadata = { title: "Reclamos" };

export default async function DisputesAdmin({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const sp = await searchParams;
  const actor = await requireStaff();
  const status = sp.estado && disputeStatusLabel[sp.estado] ? sp.estado : undefined;
  const rows = await listDisputes(actor.id, { status });
  return (
    <>
      <PageHeader eyebrow="Operación" title="Reclamos" description="Casos abiertos por clientes o proveedores. Mientras están abiertos, la liquidación del trabajo queda retenida." />
      <Tabs
        current={status ?? "todos"}
        items={[{ key: "todos", label: "Todos", href: "/admin/reclamos" }, ...Object.entries(disputeStatusLabel).map(([k, v]) => ({ key: k, label: v, href: `/admin/reclamos?estado=${k}` }))]}
      />
      {rows.length === 0 ? (
        <EmptyState title="No hay reclamos en este estado" description="Cuando alguien abra un reclamo, aparece acá." />
      ) : (
        <DataTable caption="Reclamos" minWidth={880}>
          <thead><tr><Th>Trabajo</Th><Th>Motivo</Th><Th>Abrió</Th><Th>Estado</Th><Th>Liquidación</Th><Th>Actualizado</Th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="hover:bg-cream/40">
                <Td>
                  <Link href={`/admin/reclamos/${d.id}`} className="font-semibold text-fixy-800 hover:underline">{d.job_code}</Link>
                  <div className="text-sm text-muted">{d.provider_name}</div>
                  <div className="mt-1"><StatusBadge status={d.job_status} labels={jobStatusLabelProvider} /></div>
                </Td>
                <Td className="text-sm">{disputeReasonLabel[d.reason_code] ?? d.reason_code}{d.resolution && <div className="text-muted">{disputeResolutionLabel[d.resolution]}</div>}</Td>
                <Td className="text-sm">{d.opened_by_name}<div className="text-muted">{d.opened_side === "client" ? "Cliente" : "Proveedor"} · {formatDateTime(d.created_at)}</div></Td>
                <Td><StatusBadge status={d.status} labels={disputeStatusLabel} /></Td>
                <Td>
                  {d.payout_status ? (
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={d.payout_status} labels={payoutStatusLabel} />
                      {d.payout_on_hold && <Badge tone="danger">Retenida</Badge>}
                    </div>
                  ) : <span className="text-sm text-muted">Sin liquidación</span>}
                </Td>
                <Td className="text-sm text-muted">{relativeTime(d.updated_at)}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
