import { notFound, redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { peekWhatsAppLink } from "@/server/whatsapp/bot";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { linkWhatsAppAction } from "./actions";

export const metadata = { title: "Vincular WhatsApp", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ConfirmWhatsAppLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const actor = await getActor();
  if (!actor) redirect(`/registro?next=${encodeURIComponent(`/wa/${token}`)}&origen=whatsapp`);
  const link = await peekWhatsAppLink(token);
  return (
    <article className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <h1 className="text-3xl font-extrabold">Terminá tu pedido de WhatsApp</h1>
      <Card className="mt-6">
        {!link ? (
          <Alert tone="warn" title="El link venció o no es válido">Escribinos de nuevo por WhatsApp y te mandamos uno nuevo.</Alert>
        ) : link.usedBy && link.usedBy !== actor.id ? (
          <Alert tone="warn" title="Este link ya se usó con otra cuenta">Escribinos de nuevo por WhatsApp si necesitás uno nuevo.</Alert>
        ) : (
          <div className="space-y-4">
            <p className="text-[15px]">
              Vas a vincular el WhatsApp terminado en <strong className="tabular">{link.phoneTail}</strong> a tu cuenta <strong>{actor.email}</strong> y abrir el pedido que empezaste por ahí.
            </p>
            <p className="text-sm text-muted">Si no reconocés ese número o no empezaste un pedido por WhatsApp, no sigas: cerrá esta página.</p>
            <ActionForm action={linkWhatsAppAction}>
              <input type="hidden" name="token" value={token} />
              <div className="flex flex-wrap gap-3">
                <SubmitButton size="lg" pendingText="Vinculando…">Sí, es mi WhatsApp</SubmitButton>
                <ButtonLink href="/app" variant="secondary">Cancelar</ButtonLink>
              </div>
            </ActionForm>
          </div>
        )}
      </Card>
    </article>
  );
}
