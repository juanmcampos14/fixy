import type { Metadata } from "next";
import Link from "next/link";
import { listAgenda, requireProviderContext } from "@/server/queries/provider";
import { jobStatusLabelProvider } from "@/server/domain/labels";
import { formatDate, todayInBuenosAires } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";

export const metadata: Metadata = { title: "Agenda" };

export default async function AgendaPage() {
  const { actor, provider } = await requireProviderContext({ adminOnly: true });
  const rows = await listAgenda(actor.id, provider.id, true);
  const today = todayInBuenosAires();
  const groups = new Map<string, typeof rows[number][]>();
  for (const r of rows) {
    const k = r.scheduled_date ?? "sin-fecha";
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return (
    <>
      <PageHeader title="Agenda" description="Trabajos pendientes de confirmar, confirmados y en curso, ordenados por fecha." />
      {rows.length === 0 ? (
        <EmptyState pose="empathy" title="No tenés trabajos agendados" description="Cuando confirmes un trabajo, aparece acá con su fecha." />
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([date, jobs]) => (
            <section key={date} aria-label={date === "sin-fecha" ? "Sin fecha" : formatDate(date)}>
              <h2 className="mb-2 flex flex-wrap items-center gap-2 text-lg font-bold">
                {date === "sin-fecha" ? "Fecha a coordinar" : formatDate(date)}
                {date === today && <Badge tone="brand" icon={false}>Hoy</Badge>}
                {date !== "sin-fecha" && date < today && <Badge tone="warn">Fecha pasada</Badge>}
              </h2>
              <ul className="space-y-2">
                {jobs.map((j) => (
                  <Card as="li" key={j.id} className="p-0 sm:p-0">
                    <Link href={`/proveedor/trabajos/${j.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-card)] p-4 hover:bg-cream/40">
                      <span className="min-w-0">
                        <span className="block font-semibold">{j.code} · {j.title}</span>
                        <span className="text-sm text-muted">{j.scheduled_window ?? "Franja a coordinar"} · {j.technician ? `Técnico: ${j.technician}` : "Sin técnico asignado"}</span>
                      </span>
                      <StatusBadge status={j.status} labels={jobStatusLabelProvider} />
                    </Link>
                  </Card>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
