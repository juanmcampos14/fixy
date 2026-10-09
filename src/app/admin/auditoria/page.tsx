import { requireSection } from "@/server/auth/session";
import { listAudit } from "@/server/queries/admin";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { Input, Select } from "@/components/ui/field";
import { DataTable, FilterBar, FilterField, JsonCompact, Pagination, Td, Th } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/format";

export const metadata = { title: "Auditoría" };

const PAGE_SIZE = 50;
const ROLE: Record<string, string> = { admin: "Administración", operator: "Operación" };

export default async function AuditAdmin({ searchParams }: { searchParams: Promise<{ accion?: string; entidad?: string; pagina?: string }> }) {
  const sp = await searchParams;
  const actor = (await requireSection("auditoria")).actor;
  const page = Math.max(1, Math.min(1000, Number.parseInt(sp.pagina ?? "1", 10) || 1));
  const action = sp.accion?.trim().slice(0, 60) || undefined;
  const entityType = sp.entidad?.trim().slice(0, 40) || undefined;
  const { rows, hasMore, entityTypes } = await listAudit(actor.id, { action, entityType, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });

  return (
    <>
      <PageHeader
        eyebrow="Control"
        title="Auditoría"
        description="Registro inalterable de acciones sensibles: quién, cuándo, sobre qué y con qué motivo. Solo muestra nombres, sin datos personales adicionales."
      />
      <FilterBar action="/admin/auditoria" clearHref="/admin/auditoria">
        <FilterField label="Acción (empieza con)" htmlFor="f-accion">
          <Input id="f-accion" name="accion" defaultValue={action ?? ""} placeholder="Ej.: provider. o charge.refund" />
        </FilterField>
        <FilterField label="Entidad" htmlFor="f-entidad">
          <Select id="f-entidad" name="entidad" defaultValue={entityType ?? ""}>
            <option value="">Todas</option>
            {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </FilterField>
      </FilterBar>

      {rows.length === 0 ? (
        <EmptyState title="Sin registros" description="No hay entradas de auditoría con esos filtros." />
      ) : (
        <DataTable caption="Registro de auditoría" minWidth={980}>
          <thead><tr><Th>Fecha</Th><Th>Responsable</Th><Th>Acción</Th><Th>Entidad</Th><Th>Motivo</Th><Th>Datos</Th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-sm">{formatDateTime(a.created_at)}</Td>
                <Td className="text-sm">{a.actor_name ?? <span className="text-muted">Sistema</span>}{a.actor_role && <div className="text-xs text-muted">{ROLE[a.actor_role] ?? a.actor_role}</div>}</Td>
                <Td><code className="font-mono text-sm font-semibold">{a.action}</code></Td>
                <Td className="text-sm">{a.entity_type}{a.entity_id && <div className="font-mono text-xs text-muted" title={a.entity_id}>{a.entity_id.slice(0, 8)}</div>}</Td>
                <Td className="max-w-64 text-sm">{a.reason ?? <span className="text-muted">—</span>}</Td>
                <Td className="max-w-80"><JsonCompact value={a.data} /></Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <Pagination basePath="/admin/auditoria" params={{ accion: action, entidad: entityType }} page={page} hasMore={hasMore} />
    </>
  );
}
