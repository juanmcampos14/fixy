import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";

export const metadata = { title: "Organizaciones" };

export default async function Orgs() {
  const actor = await requireActor();
  return (
    <>
      <PageHeader title="Organizaciones" description="Gestioná sedes, equipo, responsables y gastos de tu empresa u oficina." action={<ButtonLink href="/app/organizaciones/nueva">Crear organización</ButtonLink>} />
      {actor.organizations.length === 0 ? (
        <EmptyState icon={<Building2 className="h-10 w-10" />} title="Todavía no tenés una organización" description="Creala para cargar sedes, sumar a tu equipo y consultar gastos por sede, período, proveedor y categoría." action={<ButtonLink href="/app/organizaciones/nueva">Crear organización</ButtonLink>} />
      ) : (
        <ul className="space-y-3">
          {actor.organizations.map((o) => (
            <li key={o.id}><Link href={`/app/organizaciones/${o.id}`} className="flex items-center justify-between rounded-2xl bg-white p-4 ring-1 ring-line hover:ring-fixy-500">
              <span className="flex items-center gap-3"><Building2 className="h-5 w-5 text-fixy-700" aria-hidden /><span className="font-semibold">{o.name}</span><span className="text-sm text-muted">{o.role === "admin" ? "Administrador/a" : "Miembro"}</span></span>
              <ChevronRight className="h-5 w-5 text-muted" aria-hidden />
            </Link></li>
          ))}
        </ul>
      )}
    </>
  );
}
