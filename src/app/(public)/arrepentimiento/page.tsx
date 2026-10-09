import Link from "next/link";
import { getActor } from "@/server/auth/session";
import { LEGAL } from "@/lib/legal";
import { Card } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Textarea } from "@/components/ui/field";
import { revocationAction } from "./actions";

export const metadata = { title: "Botón de arrepentimiento" };

export default async function RevocationPage() {
  const actor = await getActor();
  return (
    <article className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">Botón de arrepentimiento</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-2">
        Si contrataste un servicio a través de {LEGAL.brand}, podés revocar la contratación dentro de los diez (10) días corridos, sin costo ni responsabilidad, salvo que a tu pedido el servicio ya se haya prestado
        (art. 34 Ley 24.240, art. 1110 Código Civil y Comercial y Res. 424/2020). Completá el formulario: te damos un código de seguimiento y te respondemos por correo dentro de las 24 horas.
      </p>
      <Card className="mt-6">
        <ActionForm action={revocationAction} resetOnSuccess className="grid gap-4">
          <Field label="Nombre y apellido" htmlFor="fullName" required>
            <Input id="fullName" name="fullName" required maxLength={160} defaultValue={actor?.fullName ?? ""} autoComplete="name" />
          </Field>
          <Field label="Correo" htmlFor="email" required>
            <Input id="email" name="email" type="email" required maxLength={200} defaultValue={actor?.email ?? ""} autoComplete="email" />
          </Field>
          <Field label="Código del pedido o trabajo" htmlFor="reference" hint="Figura en la Plataforma (por ejemplo, S-1024 o T-1012). Si no lo tenés, dejalo vacío.">
            <Input id="reference" name="reference" maxLength={120} />
          </Field>
          <Field label="Detalle" htmlFor="details">
            <Textarea id="details" name="details" rows={3} maxLength={2000} />
          </Field>
          <div><SubmitButton pendingText="Enviando…">Enviar pedido de arrepentimiento</SubmitButton></div>
        </ActionForm>
      </Card>
      <p className="mt-4 text-sm text-muted">Más información en los <Link href="/terminos" className="underline">Términos y condiciones</Link>. {LEGAL.company} · CUIT {LEGAL.cuit}.</p>
    </article>
  );
}
