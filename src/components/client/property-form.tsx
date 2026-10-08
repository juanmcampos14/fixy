import { sql } from "@/server/db/client";
import { listZones } from "@/server/modules/catalog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/action-state";

const REGION: Record<string, string> = { CABA: "Ciudad de Buenos Aires", GBA_NORTE: "GBA Norte", GBA_OESTE: "GBA Oeste", GBA_SUR: "GBA Sur" };

export async function PropertyForm({ action, values, hidden, submitLabel = "Guardar" }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  values?: Partial<{ kind: string; label: string; address_line: string; address_extra: string | null; zone_id: string; contact_name: string | null; contact_phone: string | null; access_notes: string | null }>;
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
      <Field label="Dirección" htmlFor="addressLine" required className="sm:col-span-2" hint="Solo la ve el profesional contratado, después del pago.">
        <Input id="addressLine" name="addressLine" defaultValue={values?.address_line} required minLength={5} maxLength={200} autoComplete="street-address" />
      </Field>
      <Field label="Piso / depto." htmlFor="addressExtra"><Input id="addressExtra" name="addressExtra" defaultValue={values?.address_extra ?? ""} maxLength={120} /></Field>
      <Field label="Zona" htmlFor="zoneId" required>
        <Select id="zoneId" name="zoneId" defaultValue={values?.zone_id ?? ""} required>
          <option value="" disabled>Elegí la zona</option>
          {Object.entries(REGION).map(([r, l]) => <optgroup key={r} label={l}>{zones.filter((z) => z.region === r).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</optgroup>)}
        </Select>
      </Field>
      <Field label="Contacto en el lugar" htmlFor="contactName"><Input id="contactName" name="contactName" defaultValue={values?.contact_name ?? ""} maxLength={120} /></Field>
      <Field label="Teléfono de contacto" htmlFor="contactPhone"><Input id="contactPhone" name="contactPhone" type="tel" defaultValue={values?.contact_phone ?? ""} maxLength={40} /></Field>
      <Field label="Indicaciones de acceso" htmlFor="accessNotes" className="sm:col-span-2" hint="Se comparten solo con el profesional contratado.">
        <Textarea id="accessNotes" name="accessNotes" defaultValue={values?.access_notes ?? ""} rows={2} maxLength={1000} />
      </Field>
      <div className="sm:col-span-2"><SubmitButton>{submitLabel}</SubmitButton></div>
    </ActionForm>
  );
}
