import { Card } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/field";
import { resetPasswordAction } from "../../actions";

export const metadata = { title: "Nueva contraseña" };

export default async function ResetPassword({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <h1 className="text-3xl font-extrabold">Nueva contraseña</h1>
      <Card className="mt-6">
        <ActionForm action={resetPasswordAction} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <Field label="Nueva contraseña" htmlFor="password" required hint="Mínimo 8 caracteres. Se cierran las sesiones abiertas.">
            <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
          </Field>
          <SubmitButton className="w-full" size="lg">Guardar contraseña</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
