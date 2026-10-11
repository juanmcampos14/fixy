import Link from "next/link";
import { Building2, House, Plus } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { listProperties } from "@/server/queries/client";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { propertyKindLabel } from "@/server/domain/labels";
import { formatMoney } from "@/lib/format";

export const metadata = { title: "Propiedades" };

export default async function Properties() {
  const actor = await requireActor();
  const props = await listProperties(actor.id);
  return (
    <>
      <PageHeader title="Propiedades" description="Tus hogares y sedes, con el historial de trabajos y gastos de cada una." action={<ButtonLink href="/app/propiedades/nueva"><Plus className="h-4 w-4" aria-hidden />Agregar</ButtonLink>} />
      {props.length === 0 ? (
        <EmptyState pose="listen" title="Todavía no cargaste propiedades" description="Se crean al hacer tu primer pedido, o podés agregarlas ahora." action={<ButtonLink href="/app/propiedades/nueva">Agregar propiedad</ButtonLink>} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {props.map((p) => (
            <li key={p.id}>
              <Link href={`/app/propiedades/${p.id}`} className="block h-full rounded-[var(--radius-card)] bg-surface p-5 ring-1 ring-line transition hover:ring-fixy-500">
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-fixy-50 text-fixy-800">{p.organization_id ? <Building2 className="h-5 w-5" aria-hidden /> : <House className="h-5 w-5" aria-hidden />}</span>
                  <div className="min-w-0">
                    <p className="truncate font-bold">{p.label}</p>
                    <p className="truncate text-sm text-muted">{propertyKindLabel[p.kind]} · {p.zone_name}{p.org_name ? ` · ${p.org_name}` : ""}</p>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-xl bg-cream/60 p-2"><dt className="text-muted">Trabajos</dt><dd className="font-bold">{p.jobs}</dd></div>
                  <div className="rounded-xl bg-cream/60 p-2"><dt className="text-muted">Abiertos</dt><dd className="font-bold">{p.active}</dd></div>
                  <div className="rounded-xl bg-cream/60 p-2"><dt className="text-muted">Gastos</dt><dd className="tabular font-bold">{formatMoney(p.spent_minor)}</dd></div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
