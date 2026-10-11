import Link from "next/link";
import { requireSection } from "@/server/auth/session";
import { listAllReviews, listReviewDisputes } from "@/server/queries/admin";
import { PageHeader } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { DataTable, Tabs, Td, Th } from "@/components/admin/ui";
import { REASON_LABEL } from "@/server/assistant/review-mediator";
import { formatDate, formatDateTime } from "@/lib/format";
import { DISPUTE_STATUS } from "@/components/admin/review-labels";

export const metadata = { title: "Reseñas" };

const RESOLUTION: Record<string, string> = { kept: "Se mantiene", edited: "Corregida por el cliente", withdrawn: "Retirada por el cliente", hidden: "Ocultada", other: "Otra" };

export default async function AdminReviews({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const { tab = "impugnaciones", q } = await searchParams;
  const actor = (await requireSection("resenas")).actor;
  const disputes = await listReviewDisputes(actor.id);
  const escalated = disputes.filter((d) => d.status === "escalated").length;
  return (
    <>
      <PageHeader title="Reseñas" description="Impugnaciones de profesionales (mediación con IA y revisión humana) y todas las reseñas con su trabajo y cliente. Esta información es interna: el profesional nunca ve quién escribió cada reseña." />
      <Tabs current={tab} items={[
        { key: "impugnaciones", label: "Impugnaciones", href: "/admin/resenas", badge: escalated },
        { key: "todas", label: "Todas las reseñas", href: "/admin/resenas?tab=todas" },
      ]} />
      {tab === "todas" ? <AllReviews userId={actor.id} q={q} /> : disputes.length === 0 ? (
        <EmptyState title="No hay impugnaciones" description="Cuando un profesional impugne una reseña, aparece acá." />
      ) : (
        <DataTable caption="Impugnaciones de reseñas" minWidth={860}>
          <thead><tr><Th>Estado</Th><Th>Trabajo</Th><Th>Profesional</Th><Th>Cliente (autor)</Th><Th>Motivo</Th><Th>Abierta</Th></tr></thead>
          <tbody>
            {disputes.map((d) => (
              <tr key={d.id}>
                <Td>
                  <Link href={`/admin/resenas/${d.id}`} className="font-semibold text-fixy-800 hover:underline">
                    <Badge tone={d.status === "escalated" ? "warn" : d.status === "resolved" || d.status === "closed" ? "ok" : "info"}>{DISPUTE_STATUS[d.status]}</Badge>
                  </Link>
                  {d.resolution && <div className="mt-1 text-xs text-muted">{RESOLUTION[d.resolution]}{d.resolved_by_ai ? " · por IA" : ""}</div>}
                  {d.status === "escalated" && d.escalation_reason && <div className="mt-1 max-w-56 text-xs text-muted">{d.escalation_reason}</div>}
                </Td>
                <Td><Link href={`/admin/trabajos/${d.job_id}`} className="hover:underline">{d.job_code}</Link><div className="text-xs text-muted">{d.rating}★</div></Td>
                <Td>{d.provider_name}</Td>
                <Td>{d.client_name}</Td>
                <Td className="text-sm">{REASON_LABEL[d.reason_code]}</Td>
                <Td className="text-sm">{formatDateTime(d.created_at)}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}

async function AllReviews({ userId, q }: { userId: string; q?: string }) {
  const rows = await listAllReviews(userId, q);
  return (
    <>
      <form className="mb-4 flex gap-2" method="get">
        <input type="hidden" name="tab" value="todas" />
        <label htmlFor="rq" className="sr-only">Buscar</label>
        <input id="rq" name="q" defaultValue={q} placeholder="Buscar por trabajo, profesional o cliente" className="h-11 w-full max-w-md rounded-xl border border-control px-3.5" />
        <button className="h-11 rounded-full bg-fixy-700 px-5 font-semibold text-white">Buscar</button>
      </form>
      <DataTable caption="Reseñas" minWidth={980}>
        <thead><tr><Th>Calificación</Th><Th>Comentario</Th><Th>Trabajo</Th><Th>Profesional</Th><Th>Cliente</Th><Th>Recibida / publicación</Th><Th>Estado</Th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const published = new Date(r.visible_at) <= new Date();
            return (
              <tr key={r.id}>
                <Td className="font-semibold">{r.rating}★ {r.is_demo && <DemoBadge />}</Td>
                <Td className="max-w-72 text-sm">{r.comment || <span className="text-muted">Sin comentario</span>}</Td>
                <Td><Link href={`/admin/trabajos/${r.job_id}`} className="font-semibold text-fixy-800 hover:underline">{r.job_code}</Link></Td>
                <Td><Link href={`/admin/proveedores/${r.provider_id}`} className="hover:underline">{r.provider_name}</Link></Td>
                <Td>{r.client_name}</Td>
                <Td className="text-sm">{formatDate(r.created_at)}<div className="text-xs text-muted">{published ? "Publicada" : `Se publica ${formatDateTime(r.visible_at)}`}</div></Td>
                <Td className="text-sm">
                  {r.withdrawn_at ? <Badge tone="neutral">Retirada</Badge> : r.hidden_at ? <Badge tone="danger">Ocultada</Badge> : <Badge tone={published ? "ok" : "info"}>{published ? "Visible" : "Programada"}</Badge>}
                  {r.edited_at && <div className="text-xs text-muted">Corregida</div>}
                  {r.dispute_id && <div className="mt-1"><Link href={`/admin/resenas/${r.dispute_id}`} className="text-xs font-semibold text-fixy-800 underline">Impugnación: {DISPUTE_STATUS[r.dispute_status ?? ""]}</Link></div>}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
    </>
  );
}
