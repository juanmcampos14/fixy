import { sql } from "@/server/db/client";
import { listZones } from "@/server/modules/catalog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { AddressFields } from "@/components/location/address-fields";
import { GatedToggle } from "@/components/location/gated-toggle";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/action-state";


export async function PropertyForm({ action, values, hidden, submitLabel = "Guardar" }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  values?: Partial<{ kind: string; label: string; address_line: string; address_extra: string | null; zone_id: string; contact_name: string | null; contact_phone: string | null; access_notes: string | null; lat: number | null; lng: number | null; place_id: string | null; formatted_address: string | null; gated_community: boolean; gated_name: string | null }>;
  hidden?: Record<string, string>;
  submitLabel?: string;
}) {
  const zones = await listZones(sql());
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      {hidden && Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <Field label="Nombre" htmlFor="label" required hint="Ej.: Casa, Oficina centro, Depósito.">
        <Input id="label" name="label" defaultValue={values?.label} required maxLength={120} />
      </Field>
      <Field label="Tipo" htmlFor="kind" required>
        <Select id="kind" name="kind" defaultValue={values?.kind ?? (hidden?.organizationId ? "site" : "home")}>
          <option value="home">Hogar</option><option value="office">Oficina</option><option value="site">Sede</option><option value="other">Otro</option>
        </Select>
      </Field>
      <AddressFields zones={zones} defaultValue={{ addressLine: values?.address_line ?? "", zoneId: values?.zone_id ?? "", lat: values?.lat != null ? String(values.lat) : "", lng: values?.lng != null ? String(values.lng) : "", placeId: values?.place_id ?? "", formattedAddress: values?.formatted_address ?? "" }} />
      <Field label="Piso / depto." htmlFor="addressExtra"><Input id="addressExtra" name="addressExtra" defaultValue={values?.address_extra ?? ""} maxLength={120} /></Field>
      <GatedToggle defaultChecked={values?.gated_community ?? false} defaultName={values?.gated_name ?? ""} />
      <Field label="Contacto en el lugar" htmlFor="contactName"><Input id="contactName" name="contactName" defaultValue={values?.contact_name ?? ""} maxLength={120} /></Field>
      <Field label="Teléfono de contacto" htmlFor="contactPhone"><Input id="contactPhone" name="contactPhone" type="tel" defaultValue={values?.contact_phone ?? ""} maxLength={40} /></Field>
      <Field label="Indicaciones de acceso" htmlFor="accessNotes" className="sm:col-span-2" hint="Se comparten solo con el profesional contratado.">
        <Textarea id="accessNotes" name="accessNotes" defaultValue={values?.access_notes ?? ""} rows={2} maxLength={1000} />
      </Field>
      <div className="sm:col-span-2"><SubmitButton>{submitLabel}</SubmitButton></div>
    </ActionForm>
  );
}
