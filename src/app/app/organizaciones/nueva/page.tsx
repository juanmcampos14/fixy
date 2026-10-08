import { requireActor } from "@/server/auth/session";
import { Card, PageHeader } from "@/components/ui/card";
import { OrgForm } from "../org-form";
import { createOrganizationAction } from "../../actions";

export const metadata = { title: "Nueva organización" };

export default async function NewOrg() {
  await requireActor();
  return (
    <>
      <PageHeader title="Nueva organización" description="Vas a ser su administrador/a. Después podés cargar sedes y sumar miembros." />
      <Card><OrgForm action={createOrganizationAction} submitLabel="Crear organización" /></Card>
    </>
  );
}
