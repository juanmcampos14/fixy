import { requireActor } from "@/server/auth/session";
import { listClientRequests } from "@/server/queries/client";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { RequestRow } from "@/components/client/cards";

export const metadata = { title: "Solicitudes" };

export default async function Requests() {
  const actor = await requireActor();
  const reqs = await listClientRequests(actor.id);
  return (
    <>
      <PageHeader title="Solicitudes" description="Tus pedidos de presupuesto y su estado." action={<ButtonLink href="/solicitar">Nuevo pedido</ButtonLink>} />
      {reqs.length ? <ul className="space-y-3">{reqs.map((r) => <RequestRow key={r.id} r={r} />)}</ul> : <EmptyState pose="listen" title="Sin solicitudes" description="Cuando pidas un presupuesto, lo vas a ver acá." action={<ButtonLink href="/solicitar">Pedir presupuesto</ButtonLink>} />}
    </>
  );
}
