import { Card } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { confirmEmailAction } from "../../actions";

export const metadata = { title: "Confirmá tu email", robots: { index: false } };

export default async function VerifyEmail({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <h1 className="text-3xl font-extrabold">Confirmá tu email</h1>
      <p className="mt-2 text-ink-2">Tocá el botón para confirmar que este email es tuyo. Así podés pagar, cobrar y recibir los avisos de Fixy por correo.</p>
      <Card className="mt-6">
        <ActionForm action={confirmEmailAction}>
          <input type="hidden" name="token" value={token} />
          <SubmitButton className="w-full" size="lg" pendingText="Confirmando…">Confirmar mi email</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
