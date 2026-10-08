import type { Metadata } from "next";
import Link from "next/link";
import { listJobs, requireProviderContext } from "@/server/queries/provider";
import { jobStatusLabelProvider } from "@/server/domain/labels";
import { Card, PageHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Trabajos" };

export default async function JobsPage() {
  const { actor, provider, isAdmin } = await requireProviderContext();
  const jobs = await listJobs(actor.id, provider.id, isAdmin);
  const active = jobs.filter((j) => !["completed", "cancelled"].includes(j.status));
  const closed = jobs.filter((j) => ["completed", "cancelled"].includes(j.status));
  return (
    <>
      <PageHeader title="Trabajos" description={isAdmin ? "Todos los trabajos contratados de tu cuenta." : "Los trabajos que te asignaron."} />
      {jobs.length === 0 ? (
        <EmptyState pose="empathy" title="Todavía no hay trabajos" description={isAdmin ? "Cuando un cliente acepte un presupuesto tuyo, lo vas a ver acá." : "Cuando te asignen un trabajo, lo vas a ver acá."} />
      ) : (
        <div className="space-y-6">
          <JobList title={`En curso (${active.length})`} jobs={active} showTech={isAdmin} />
          {closed.length > 0 && <JobList title="Cerrados" jobs={closed} showTech={isAdmin} />}
        </div>
      )}
    </>
  );
}

function JobList({ title, jobs, showTech }: { title: string; jobs: Awaited<ReturnType<typeof listJobs>>[number][]; showTech: boolean }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {jobs.length === 0 ? (
        <p className="text-muted">No hay trabajos en esta sección.</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((j) => (
            <Card as="li" key={j.id} className="p-0 sm:p-0">
              <Link href={`/proveedor/trabajos/${j.id}`} className="flex flex-wrap items-start justify-between gap-2 rounded-[var(--radius-card)] p-4 hover:bg-cream/40 sm:p-5">
                <span className="min-w-0">
                  <span className="block font-semibold">{j.code} · {j.title}</span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {j.category_name ?? "Sin categoría"} · {j.scheduled_date ? `${formatDate(j.scheduled_date)}${j.scheduled_window ? ` · ${j.scheduled_window}` : ""}` : "Fecha a coordinar"}
                    {showTech && ` · ${j.technician ? `Técnico: ${j.technician}` : "Sin técnico asignado"}`}
                  </span>
                </span>
                <StatusBadge status={j.status} labels={jobStatusLabelProvider} />
              </Link>
            </Card>
          ))}
        </ul>
      )}
    </section>
  );
}
