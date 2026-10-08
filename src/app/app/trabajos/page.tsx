import { requireActor } from "@/server/auth/session";
import { listClientJobs } from "@/server/queries/client";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { JobRow } from "@/components/client/cards";

export const metadata = { title: "Trabajos" };

export default async function Jobs() {
  const actor = await requireActor();
  const jobs = await listClientJobs(actor.id);
  const active = jobs.filter((j) => !["completed", "cancelled"].includes(j.status));
  const done = jobs.filter((j) => ["completed", "cancelled"].includes(j.status));
  return (
    <>
      <PageHeader title="Trabajos" description="Órdenes de trabajo contratadas: coordinación, pagos y seguimiento." />
      {jobs.length === 0 && <EmptyState pose="listen" title="Todavía no contrataste trabajos" description="Cuando aceptes un presupuesto, el trabajo aparece acá." />}
      {active.length > 0 && (<><h2 className="mb-3 text-lg font-bold">En curso</h2><ul className="mb-8 space-y-3">{active.map((j) => <JobRow key={j.id} j={j} />)}</ul></>)}
      {done.length > 0 && (<><h2 className="mb-3 text-lg font-bold">Historial</h2><ul className="space-y-3">{done.map((j) => <JobRow key={j.id} j={j} />)}</ul></>)}
    </>
  );
}
