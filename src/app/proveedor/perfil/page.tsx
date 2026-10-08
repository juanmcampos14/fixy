import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { getOnboardingState, getProviderSetup, requireProviderContext } from "@/server/queries/provider";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { ButtonLink } from "@/components/ui/button";
import { ProfileForm } from "@/components/provider/profile-form";
import { CoverageSection, DocumentsSection, PayoutsSection, PortfolioSection } from "@/components/provider/sections";
import { updateProfileAction } from "../alta/actions";

export const metadata: Metadata = { title: "Perfil" };

export default async function ProfilePage() {
  const { actor, provider } = await requireProviderContext({ adminOnly: true });
  const [state, setup] = await Promise.all([getOnboardingState(actor.id, provider.id), getProviderSetup(actor.id, provider.id)]);
  if (!state) return null;
  const p = state.provider;
  return (
    <>
      <PageHeader
        title="Perfil"
        description="Lo que ven los clientes y cómo te llegan las oportunidades."
        action={p.status === "approved" ? (
          <ButtonLink href={`/profesionales/${p.slug}`} variant="secondary" target="_blank">Ver perfil público <ExternalLink className="h-4 w-4" aria-hidden /></ButtonLink>
        ) : undefined}
      />
      <div className="space-y-5">
        {p.status !== "approved" && <p className="text-[15px] text-muted">Tu perfil público se publica cuando el equipo de Fixy lo aprueba.</p>}
        <Card as="section" id="perfil" aria-labelledby="perfil-t">
          <CardHeader title={<span id="perfil-t">Datos del perfil</span>} description="El nombre, la descripción y los años de experiencia se publican. CUIT, contacto y facturación son privados." />
          <ProfileForm
            action={updateProfileAction}
            submitLabel="Guardar perfil"
            defaults={{
              kind: p.kind, displayName: p.display_name, legalName: p.legal_name ?? "", taxId: p.tax_id ?? "", responsibleName: p.responsible_name,
              contactEmail: p.contact_email, contactPhone: p.contact_phone ?? "", description: p.description,
              yearsExperience: p.years_experience?.toString() ?? "", billingInfo: p.billing_info ?? "",
            }}
          />
        </Card>
        <CoverageSection setup={setup} provider={p} />
        <PortfolioSection setup={setup} />
        <DocumentsSection setup={setup} checklist={state.checklist} />
        <PayoutsSection provider={p} />
      </div>
    </>
  );
}
