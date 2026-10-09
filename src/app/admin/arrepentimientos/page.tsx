import { requireStaff } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import { listRevocations } from "@/server/modules/revocations";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { ConfirmAction } from "@/components/ui/form";
import { DataTable, Td, Th } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/format";
import { resolveRevocationAction } from "../actions";

export const metadata = { title: "Arrepentimientos" };

export default async function RevocationsAdmin() {
  await requireStaff();
  const rows = await listRevocations(sql());
  return (
    <>
      <PageHeader eyebrow="Operación" title="Botón de arrepentimiento" description="Pedidos de revocación (Res. 424/2020). Respondé por correo dentro de las 24 h y gestioná la cancelación y el reintegro desde el trabajo." />
      {rows.length === 0 ? <EmptyState title="Sin pedidos" description="Cuando alguien use el botón de arrepentimiento, aparece acá." /> : (
        <DataTable caption="Pedidos de arrepentimiento">
          <thead><tr><Th>Código</Th><Th>Persona</Th><Th>Referencia</Th><Th>Recibido</Th><Th>Estado</Th></tr></thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <Td className="font-semibold">{r.code}</Td>
                <Td>{r.full_name}<div className="text-sm text-muted">{r.email}{r.user_id ? " · con cuenta" : ""}</div>{r.details && <p className="mt-1 max-w-sm text-sm">{r.details}</p>}</Td>
                <Td>{r.reference ?? "—"}</Td>
                <Td>{formatDateTime(r.created_at)}</Td>
                <Td>
                  {r.status === "resolved" ? (<><Badge tone="ok">Resuelto</Badge>{r.resolution && <p className="mt-1 max-w-xs text-sm text-muted">{r.resolution}</p>}</>) : (
                    <ConfirmAction action={resolveRevocationAction} label="Marcar resuelto" size="sm" title={`Resolver ${r.code}`} description="Indicá qué se hizo (cancelación, reintegro, respuesta enviada)." requireReason reasonLabel="Resolución" hidden={{ id: r.id }} confirmLabel="Guardar" />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
