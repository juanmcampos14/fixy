import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { activeMembership, getOnboardingState, getProviderSetup } from "@/server/queries/provider";
import { Mascot } from "@/components/brand/mascot";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { ButtonLink } from "@/components/ui/button";
import { DemoBadge } from "@/components/ui/badge";
import { ProfileForm } from "@/components/provider/profile-form";
import { AvatarSection, CoverageSection, Done, DocumentsSection, PayoutsSection, PortfolioSection, ProviderStatusCard, TermsSection } from "@/components/provider/sections";
import { submitForReviewAction, updateProfileAction } from "./actions";
import { QuickStart } from "@/components/provider/quick-start";
import { StrengthMeter } from "@/components/provider/strength-meter";
import { profileAssistantAvailable } from "@/server/assistant/provider-profile";
import { getProfileStrength } from "@/server/modules/providers";
import { sql } from "@/server/db/client";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Alta de proveedor" };

export default async function AltaPage({ searchParams }: { searchParams: Promise<{ bienvenida?: string }> }) {
  const { bienvenida } = await searchParams;
  const actor = await getActor();
  if (!actor) redirect("/registro?tipo=proveedor");
  const m = activeMembership(actor);
  if (m && m.role !== "admin") redirect("/proveedor");

  if (!m) {
    const [categories, zones] = await Promise.all([
      sql()<{ id: string; name: string; icon: string }[]>`select id, name, icon from categories where active order by sort, name`,
      sql()<{ id: string; name: string; region: string }[]>`select id, name, region from zones where active order by sort, name`,
    ]);
    const ai = profileAssistantAvailable();
    return (
      <>
        <div className="flex items-end justify-between gap-4">
          <PageHeader eyebrow="Sumate a Fixy · 2 minutos" title="Contanos qué hacés y armamos tu perfil"
            description={ai
              ? "Escribilo con tus palabras: nuestra IA lo convierte en un perfil listo para revisar. Después sumás fotos y documentación para empezar a recibir pedidos."
              : "Tu nombre, tu celular y qué hacés. Después sumás fotos y documentación para empezar a recibir pedidos."} />
          <Mascot pose="wave" className="hidden h-24 w-auto shrink-0 sm:block" />
        </div>
        <Card>
          <QuickStart categories={categories} zones={zones} aiAvailable={ai} defaultName={actor.fullName} />
        </Card>
        <p className="mt-4 text-sm text-muted">
          ¿Querés saber cómo funciona antes? Leé <Link href="/sumate" className="font-semibold text-fixy-800 underline">Ofrecé tus servicios</Link>.
        </p>
      </>
    );
  }

  const [state, setup, strength] = await Promise.all([getOnboardingState(actor.id, m.id), getProviderSetup(actor.id, m.id), getProfileStrength(sql(), m.id)]);
  if (!state) redirect("/proveedor");
  const { provider, checklist, eligibility } = state;
  const credsOk = checklist.requiredCredentials.every((c) => c.uploaded);
  const canSubmit = provider.status === "pending" || provider.status === "rejected";
  const steps: [boolean, string, string][] = [
    [checklist.profile, "Perfil", "#perfil"],
    [checklist.coverage, "Servicios y zonas", "#servicios"],
    [checklist.availability, "Disponibilidad", "#servicios"],
    [checklist.portfolio, "Portfolio (recomendado)", "#portfolio"],
    [checklist.identityDocument && credsOk, "Documentación", "#documentacion"],
    [checklist.termsAccepted, "Términos", "#terminos"],
  ];
  const missingRequired = steps.filter(([ok, label]) => !ok && !label.startsWith("Portfolio"));

  return (
    <>
      <PageHeader
        eyebrow="Alta de proveedor"
        title={<span className="inline-flex flex-wrap items-center gap-2">{provider.display_name} {provider.is_demo && <DemoBadge />}</span>}
        description="Completá cada sección. Podés guardar y volver cuando quieras. Las oportunidades llegan cuando se cumplen todos los requisitos."
      />
      {bienvenida && (
        <Alert tone="ok" className="mb-5" title="¡Tu perfil está creado!">
          Ahora sumá fotos de trabajos, tu DNI y los datos de cobro. Cada paso sube la fuerza de tu perfil y te muestra más arriba.
        </Alert>
      )}
      <div className="space-y-5">
        {strength && (
          <Card className="ring-2 ring-fixy-500/20">
            <StrengthMeter {...strength} />
          </Card>
        )}
        <ProviderStatusCard provider={provider} checklist={checklist} eligibility={eligibility} />

        <Card>
          <CardHeader title="Para empezar a recibir pedidos" description="Lo obligatorio para que el equipo apruebe tu perfil." />
          <ol className="grid gap-2 sm:grid-cols-2">
            {steps.map(([ok, label, href]) => (
              <Done key={label} ok={ok}><a href={href} className="underline-offset-2 hover:underline">{label}</a></Done>
            ))}
          </ol>
        </Card>

        <AvatarSection provider={provider} />
        <Card as="section" id="perfil" aria-labelledby="perfil-t" className="scroll-mt-24">
          <CardHeader title={<span id="perfil-t">Perfil</span>} description="El nombre, la descripción y los años de experiencia se publican. El resto es privado." />
          <ProfileForm
            action={updateProfileAction}
            submitLabel="Guardar perfil"
            defaults={{
              kind: provider.kind, displayName: provider.display_name, legalName: provider.legal_name ?? "", taxId: provider.tax_id ?? "",
              responsibleName: provider.responsible_name, contactEmail: provider.contact_email, contactPhone: provider.contact_phone ?? "",
              description: provider.description, yearsExperience: provider.years_experience?.toString() ?? "", billingInfo: provider.billing_info ?? "",
            }}
          />
        </Card>
        <CoverageSection setup={setup} provider={provider} />
        <PortfolioSection setup={setup} />
        <DocumentsSection setup={setup} checklist={checklist} />
        <PayoutsSection provider={provider} />
        <TermsSection setup={setup} accepted={checklist.termsAccepted} />

        <Card as="section" aria-labelledby="enviar-t">
          <CardHeader title={<span id="enviar-t">Enviar a revisión</span>} />
          {provider.status === "in_review" ? (
            <Alert tone="info" title="Tu perfil está en revisión">
              Lo enviaste {formatDateTime(provider.submitted_at)}. El equipo de Fixy revisa la documentación y te avisa por notificación. Mientras tanto podés seguir editando tu perfil.
            </Alert>
          ) : provider.status === "approved" ? (
            <div className="space-y-3">
              <Alert tone="ok" title="Tu perfil está aprobado">Los cambios de perfil se aplican enseguida. Si sumás especialidades que piden matrícula, cargala en Documentación.</Alert>
              <ButtonLink href="/proveedor">Ir al panel</ButtonLink>
            </div>
          ) : provider.status === "suspended" ? (
            <Alert tone="danger" title="Cuenta suspendida">Escribinos desde Ayuda para revisar tu caso.</Alert>
          ) : (
            <div className="space-y-3">
              {missingRequired.length > 0 ? (
                <p className="text-[15px] text-ink-2">Para enviar falta completar: {missingRequired.map(([, l]) => l.toLowerCase()).join(", ")}.</p>
              ) : (
                <p className="text-[15px] text-ink-2">Está todo listo. El equipo de Fixy revisa tu identidad y credenciales; la aprobación no es automática.</p>
              )}
              {canSubmit && (
                <ActionForm action={submitForReviewAction}>
                  <SubmitButton size="lg" disabled={missingRequired.length > 0} pendingText="Enviando…">
                    {provider.status === "rejected" ? "Volver a enviar a revisión" : "Enviar a revisión"}
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
