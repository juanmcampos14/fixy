import { Trash2 } from "lucide-react";
import { sql } from "@/server/db/client";
import { Card, CardHeader } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { formatMoney, minorToInput } from "@/lib/format";
import { addPriceRefAction, removePriceRefAction, updateVisitSettingsAction } from "@/app/proveedor/actions";

/** Precio de la visita y precios de referencia "desde": lo que el cliente ve al elegir profesional. */
export async function VisitPricingSection({ providerId }: { providerId: string }) {
  const db = sql();
  const [p] = await db<{ visit_fee_minor: number; visit_fee_credited: boolean }[]>`select visit_fee_minor, visit_fee_credited from providers where id = ${providerId}`;
  const cats = await db<{ id: string; name: string }[]>`select c.id, c.name from provider_categories pc join categories c on c.id = pc.category_id where pc.provider_id = ${providerId} order by c.sort`;
  const refs = await db<{ id: string; title: string; from_minor: number; note: string; category: string }[]>`
    select r.id, r.title, r.from_minor, r.note, c.name as category from provider_price_refs r join categories c on c.id = r.category_id where r.provider_id = ${providerId} order by c.sort, r.sort`;
  return (
    <Card as="section" id="visita" aria-labelledby="visita-t">
      <CardHeader title={<span id="visita-t">Visita y precios de referencia</span>} description="Es lo que ven los clientes al elegir profesional. En la visita ves el problema y presupuestás el arreglo desde la app." />
      <ActionForm action={updateVisitSettingsAction} className="grid gap-4 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
        <Field label="Precio de la visita (ARS)" htmlFor="vf" required hint="0 = visita sin cargo.">
          <Input id="vf" name="visitFee" inputMode="decimal" defaultValue={minorToInput(p.visit_fee_minor)} required />
        </Field>
        <Checkbox name="visitFeeCredited" defaultChecked={p.visit_fee_credited} label="Si el cliente contrata el arreglo, descuento la visita del presupuesto" className="sm:pb-3" />
        <SubmitButton variant="secondary">Guardar</SubmitButton>
      </ActionForm>

      <h3 className="mt-6 font-bold">Precios de referencia</h3>
      <p className="text-sm text-muted">Orientativos («desde»): el precio final lo confirmás en el lugar y el cliente lo aprueba en la app. Los extras siempre se aprueban aparte.</p>
      {refs.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-2xl ring-1 ring-line">
          {refs.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[15px]">
              <span className="min-w-0"><span className="font-semibold">{r.title}</span> <span className="text-sm text-muted">· {r.category}{r.note ? ` · ${r.note}` : ""}</span></span>
              <span className="flex items-center gap-2">
                <span className="tabular whitespace-nowrap">desde {formatMoney(r.from_minor)}</span>
                <form action={removePriceRefAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-danger-bg hover:text-danger" aria-label={`Quitar ${r.title}`}><Trash2 className="h-4 w-4" aria-hidden /></button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}
      {cats.length ? (
        <ActionForm action={addPriceRefAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_1fr]" resetOnSuccess>
          <Field label="Rubro" htmlFor="pr-cat" required>
            <Select id="pr-cat" name="categoryId" required>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </Field>
          <Field label="Servicio" htmlFor="pr-title" required>
            <Input id="pr-title" name="title" required minLength={3} maxLength={120} placeholder="Ej.: Instalación de split hasta 3000 frigorías" />
          </Field>
          <Field label="Desde (ARS)" htmlFor="pr-from" required>
            <Input id="pr-from" name="from" inputMode="decimal" required placeholder="45.000" />
          </Field>
          <Field label="Aclaración" htmlFor="pr-note" className="sm:col-span-2">
            <Input id="pr-note" name="note" maxLength={300} placeholder="Ej.: no incluye materiales ni soportes" />
          </Field>
          <div className="sm:self-end"><SubmitButton variant="soft">Agregar precio</SubmitButton></div>
        </ActionForm>
      ) : <p className="mt-3 text-sm text-muted">Primero elegí tus rubros en «Servicios y zonas».</p>}
    </Card>
  );
}
