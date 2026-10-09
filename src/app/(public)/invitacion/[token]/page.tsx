import { notFound } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { getInvitation } from "@/server/modules/team";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { acceptInvitationAction } from "./actions";

export const metadata = { title: "Invitación al panel", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const inv = await getInvitation(token);
  if (!inv) notFound();
  const actor = await getActor();
  const next = encodeURIComponent(`/invitacion/${token}`);
  const unusable = inv.revoked_at ? "Esta invitación fue anulada." : inv.accepted_at ? "Esta invitación ya se usó." : inv.expires_at < new Date() ? "La invitación venció." : null;
  const wrongAccount = actor && actor.email.toLowerCase() !== inv.email.toLowerCase();
  return (
    <article className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold">Te invitaron al panel de Fixy</h1>
      <p className="mt-3 text-[15px] text-ink-2">{inv.inviter} te invitó con acceso <strong>{inv.label}</strong> para <strong>{inv.email}</strong>.</p>
      <Card className="mt-6">
        {unusable ? (
          <Alert tone="warn" title={unusable}>Pedile a quien te invitó que te mande una nueva.</Alert>
        ) : !actor ? (
          <div className="space-y-3">
            <p className="text-[15px]">Para aceptar, ingresá o creá tu cuenta con <strong>{inv.email}</strong>.</p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href={`/registro?next=${next}`}>Crear cuenta</ButtonLink>
              <ButtonLink href={`/ingresar?next=${next}`} variant="secondary">Ya tengo cuenta</ButtonLink>
            </div>
          </div>
        ) : wrongAccount ? (
          <Alert tone="warn" title="Estás con otra cuenta">Ingresaste como {actor.email}. Cerrá sesión e ingresá con {inv.email} para aceptar.</Alert>
        ) : (
          <ActionForm action={acceptInvitationAction}>
            <input type="hidden" name="token" value={token} />
            <SubmitButton size="lg" pendingText="Aceptando…">Aceptar y entrar al panel</SubmitButton>
          </ActionForm>
        )}
      </Card>
    </article>
  );
}
