"use client";

import type { ActionState } from "@/lib/action-state";
import { ActionForm, FieldError, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export type ProfileDefaults = {
  kind: "individual" | "company";
  displayName: string;
  legalName: string;
  taxId: string;
  responsibleName: string;
  contactEmail: string;
  contactPhone: string;
  description: string;
  yearsExperience: string;
  billingInfo: string;
};

/** Datos del perfil (alta y edición). CUIT, facturación y contacto son privados: no se publican. */
export function ProfileForm({ action, defaults, submitLabel }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; defaults: ProfileDefaults; submitLabel: string }) {
  return (
    <ActionForm action={action} className="space-y-4">
      {(s) => (
        <>
          <Field label="Tipo de proveedor" htmlFor="pf-kind" required error={s.fieldErrors?.kind}>
            <Select id="pf-kind" name="kind" defaultValue={defaults.kind}>
              <option value="individual">Profesional independiente</option>
              <option value="company">Empresa con equipo</option>
            </Select>
          </Field>
          <Field label="Nombre comercial" htmlFor="pf-name" required hint="Es el nombre que ven los clientes." error={s.fieldErrors?.displayName}>
            <Input id="pf-name" name="displayName" defaultValue={defaults.displayName} required maxLength={120} invalid={!!s.fieldErrors?.displayName} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Razón social" htmlFor="pf-legal" error={s.fieldErrors?.legalName}>
              <Input id="pf-legal" name="legalName" defaultValue={defaults.legalName} maxLength={160} />
            </Field>
            <Field label="CUIT" htmlFor="pf-tax" hint="Privado. No se publica." error={s.fieldErrors?.taxId}>
              <Input id="pf-tax" name="taxId" defaultValue={defaults.taxId} inputMode="numeric" placeholder="20-12345678-9" invalid={!!s.fieldErrors?.taxId} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Persona responsable" htmlFor="pf-resp" required error={s.fieldErrors?.responsibleName}>
              <Input id="pf-resp" name="responsibleName" defaultValue={defaults.responsibleName} required maxLength={120} invalid={!!s.fieldErrors?.responsibleName} />
            </Field>
            <Field label="Años de experiencia" htmlFor="pf-years" error={s.fieldErrors?.yearsExperience}>
              <Input id="pf-years" name="yearsExperience" type="number" min={0} max={80} defaultValue={defaults.yearsExperience} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email de contacto" htmlFor="pf-email" required hint="Privado. Lo usamos para avisos." error={s.fieldErrors?.contactEmail}>
              <Input id="pf-email" name="contactEmail" type="email" defaultValue={defaults.contactEmail} required invalid={!!s.fieldErrors?.contactEmail} />
            </Field>
            <Field label="Teléfono de contacto" htmlFor="pf-phone" required hint="Privado. No se muestra a clientes." error={s.fieldErrors?.contactPhone}>
              <Input id="pf-phone" name="contactPhone" type="tel" defaultValue={defaults.contactPhone} required invalid={!!s.fieldErrors?.contactPhone} />
            </Field>
          </div>
          <Field label="Descripción del servicio" htmlFor="pf-desc" required hint="Qué hacés, cómo trabajás y en qué te especializás. Mínimo 30 caracteres." error={s.fieldErrors?.description}>
            <Textarea id="pf-desc" name="description" defaultValue={defaults.description} required minLength={30} maxLength={2000} invalid={!!s.fieldErrors?.description} />
          </Field>
          <Field label="Datos de facturación" htmlFor="pf-billing" hint="Condición fiscal (por ejemplo, monotributo). Privado." error={s.fieldErrors?.billingInfo}>
            <Input id="pf-billing" name="billingInfo" defaultValue={defaults.billingInfo} maxLength={500} />
          </Field>
          <FieldError state={s} name="_" />
          <SubmitButton pendingText="Guardando…">{submitLabel}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
