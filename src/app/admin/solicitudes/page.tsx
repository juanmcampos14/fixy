import Link from "next/link";
import { requireSection } from "@/server/auth/session";
import { categoryOptions, listRequests } from "@/server/queries/admin";
import { requestStatusLabel, urgencyLabel } from "@/server/domain/labels";
import { PageHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, Input, Select } from "@/components/ui/field";
import { DataTable, FilterBar, FilterField, Td, Th } from "@/components/admin/ui";
import { formatDateTime, relativeTime } from "@/lib/format";

export const metadata = { title: "Solicitudes" };

export default async function RequestsAdmin({ searchParams }: { searchParams: Promise<{ estado?: string; revision?: string; categoria?: string; q?: string }> }) {
  const sp = await searchParams;
  const actor = (await requireSection("solicitudes")).actor;
  const status = sp.estado && requestStatusLabel[sp.estado] ? sp.estado : undefined;
  const cats = await categoryOptions(actor.id);
  const categoryId = cats.some((c) => c.id === sp.categoria) ? sp.categoria : undefined;
  const q = sp.q?.trim() || undefined;
  const review = sp.revision === "1";
  const rows = await listRequests(actor.id, { status, review, categoryId, q });

  return (
    <>
      <PageHeader eyebrow="Operación" title="Solicitudes" description="Pedidos de clientes: derivación, cobertura, invitaciones y presupuestos." />
      <FilterBar action="/admin/solicitudes" clearHref="/admin/solicitudes">
        <FilterField label="Estado" htmlFor="f-estado">
          <Select id="f-estado" name="estado" defaultValue={status ?? ""}>
            <option value="">Todos</option>
            {Object.entries(requestStatusLabel).filter(([k]) => k !== "draft").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Categoría" htmlFor="f-cat">
          <Select id="f-cat" name="categoria" defaultValue={categoryId ?? ""}>
            <option value="">Todas</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Código o título" htmlFor="f-q">
          <Input id="f-q" name="q" defaultValue={q ?? ""} placeholder="Ej.: S-1004 o canilla" />
        </FilterField>
        <div className="flex min-h-12 items-center">
          <Checkbox name="revision" value="1" defaultChecked={review} label="Solo para revisar o sin cobertura" />
        </div>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState title="No hay solicitudes con esos filtros" description="Probá con otros filtros." />
      ) : (
        <DataTable caption="Solicitudes" minWidth={940}>
          <thead>
            <tr><Th>Solicitud</Th><Th>Categoría · zona</Th><Th>Cliente</Th><Th>Estado</Th><Th>Invitaciones</Th><Th>Presupuestos</Th><Th>Enviada</Th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.needs_review || r.status === "no_coverage" || r.unanswered ? "bg-warn-bg/30" : "hover:bg-cream/40"}>
                <Td>
                  <Link href={`/admin/solicitudes/${r.id}`} className="font-semibold text-fixy-800 hover:underline">{r.code}</Link>
                  <div className="max-w-64 text-sm text-ink-2">{r.title}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.needs_review && <Badge tone="warn">Para revisar</Badge>}
                    {r.unanswered && <Badge tone="danger">Sin respuesta +24 h</Badge>}
                    {r.safety_flag && <Badge tone="danger">Seguridad: {r.safety_flag}</Badge>}
                    {r.urgency === "urgent" && <Badge tone="info">{urgencyLabel.urgent}</Badge>}
                  </div>
                </Td>
                <Td className="text-sm">{r.category_name ?? <span className="text-muted">Sin categoría</span>}<div className="text-muted">{r.zone_name}</div></Td>
                <Td className="text-sm">{r.client_name}</Td>
                <Td><StatusBadge status={r.status} labels={requestStatusLabel} /></Td>
                <Td className="tabular">{r.invitations}</Td>
                <Td className="tabular">{r.quotes_sent}</Td>
                <Td className="text-sm text-muted">{r.submitted_at ? <span title={formatDateTime(r.submitted_at)}>{relativeTime(r.submitted_at)}</span> : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
