import { Card } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/field";
import { requestResetAction } from "../actions";
import { whatsappUrl } from "@/lib/contact";

export const metadata = { title: "Recuperar contraseña" };

export default function Recover() {
  return (
    <>
      <h1 className="text-3xl font-extrabold">Recuperar contraseña</h1>
      <p className="mt-1 text-muted">Te enviamos un enlace para crear una nueva.</p>
      <Card className="mt-6">
        <ActionForm action={requestResetAction} className="space-y-4">
          <Field label="Email de tu cuenta" htmlFor="email" required><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
          <SubmitButton className="w-full" size="lg">Enviar enlace</SubmitButton>
        </ActionForm>
      </Card>
      {/* Las cuentas creadas por WhatsApp no reciben el enlace por correo: entran por WhatsApp y cambian la clave en Mi cuenta. */}
      <p className="mt-4 text-center text-sm text-muted">
        ¿Te anotaste por WhatsApp? No hace falta el enlace: <a href={whatsappUrl("entrar")} className="font-semibold text-fixy-800 underline">pedí tu link para entrar</a> y cambiá la clave desde «Mi cuenta».
      </p>
    </>
  );
}
