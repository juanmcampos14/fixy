import { requireActor } from "@/server/auth/session";
import { Card, PageHeader } from "@/components/ui/card";
import { PropertyForm } from "@/components/client/property-form";
import { createPropertyAction } from "../../actions";

export const metadata = { title: "Nueva propiedad" };

export default async function NewProperty({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const { org } = await searchParams;
  const actor = await requireActor();
  const orgName = org ? actor.organizations.find((o) => o.id === org && o.role === "admin")?.name : undefined;
  return (
    <>
      <PageHeader title={orgName ? `Nueva sede de ${orgName}` : "Nueva propiedad"} />
      <Card><PropertyForm action={createPropertyAction} hidden={orgName ? { organizationId: org! } : undefined} submitLabel="Crear" /></Card>
    </>
  );
}
