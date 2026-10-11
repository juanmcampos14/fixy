import { Plus } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { listClientJobs, listClientRequests } from "@/server/queries/client";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Mascot } from "@/components/brand/mascot";
import { JobRow, RequestRow } from "@/components/client/cards";

export const metadata = { title: "Inicio" };

export default async function ClientHome() {
  const actor = await requireActor();
  const [reqs, jobs] = await Promise.all([listClientRequests(actor.id, { active: true }), listClientJobs(actor.id, { active: true })]);
  const toReview = (await listClientJobs(actor.id)).filter((j) => j.status === "completed" && !j.has_review).slice(0, 3);
  const firstName = actor.fullName.split(" ")[0];
  return (
    <>
      <section className="mb-8 flex items-center justify-between gap-4 overflow-hidden rounded-[28px] bg-gradient-to-br from-fixy-50 to-cream-2 p-6 ring-1 ring-line sm:p-8">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">Hola, {firstName}</h1>
          <p className="mt-1 text-ink-2">¿Qué necesitás resolver hoy?</p>
          <ButtonLink href="/solicitar" className="mt-4"><Plus className="h-4 w-4" aria-hidden /> Nuevo pedido</ButtonLink>
        </div>
        <Mascot pose="wave" className="hidden h-36 w-auto sm:block" priority />
      </section>

      <section aria-labelledby="jobs-title" className="mb-10">
        <PageHeader title={<span id="jobs-title" className="text-xl">Trabajos en curso</span>} />
        {jobs.length ? <ul className="space-y-3">{jobs.map((j) => <JobRow key={j.id} j={j} />)}</ul> : <p className="text-muted">No tenés trabajos en curso.</p>}
      </section>

      <section aria-labelledby="req-title" className="mb-10">
        <PageHeader title={<span id="req-title" className="text-xl">Pedidos abiertos</span>} action={<ButtonLink href="/app/solicitudes" variant="ghost" size="sm">Ver todos</ButtonLink>} />
        {reqs.length ? (
          <ul className="space-y-3">{reqs.map((r) => <RequestRow key={r.id} r={r} />)}</ul>
        ) : (
          <EmptyState pose="listen" title="Todavía no tenés pedidos abiertos" description="Contanos qué pasa y te conectamos con profesionales de tu zona." action={<ButtonLink href="/solicitar">Pedir presupuesto</ButtonLink>} />
        )}
      </section>

      {toReview.length > 0 && (
        <section aria-labelledby="rev-title">
          <PageHeader title={<span id="rev-title" className="text-xl">Contanos cómo te fue</span>} />
          <ul className="space-y-3">{toReview.map((j) => <JobRow key={j.id} j={j} />)}</ul>
        </section>
      )}
    </>
  );
}
