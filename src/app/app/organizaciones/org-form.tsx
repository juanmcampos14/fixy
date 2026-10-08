import type { ActionState } from "@/lib/action-state";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/field";

export function OrgForm({ action, values, hidden, submitLabel = "Guardar" }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; values?: Partial<{ name: string; tax_id: string | null; billing_email: string | null; billing_address: string | null; contact_phone: string | null }>; hidden?: Record<string, string>; submitLabel?: string }) {
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Field label="Nombre" htmlFor="name" required className="sm:col-span-2"><Input id="name" name="name" defaultValue={values?.name} required maxLength={160} /></Field>
      <Field label="CUIT" htmlFor="taxId"><Input id="taxId" name="taxId" defaultValue={values?.tax_id ?? ""} maxLength={20} /></Field>
      <Field label="Teléfono" htmlFor="contactPhone"><Input id="contactPhone" name="contactPhone" type="tel" defaultValue={values?.contact_phone ?? ""} maxLength={40} /></Field>
      <Field label="Email de facturación" htmlFor="billingEmail"><Input id="billingEmail" name="billingEmail" type="email" defaultValue={values?.billing_email ?? ""} /></Field>
      <Field label="Domicilio de facturación" htmlFor="billingAddress"><Input id="billingAddress" name="billingAddress" defaultValue={values?.billing_address ?? ""} maxLength={200} /></Field>
      <div className="sm:col-span-2"><SubmitButton>{submitLabel}</SubmitButton></div>
    </ActionForm>
  );
}
