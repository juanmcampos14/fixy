"use client";

import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input, Textarea } from "@/components/ui/field";
import type { ActionState } from "@/lib/action-state";

export function GatedRulesForm({ action, propertyId, defaults, hasFile }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  propertyId: string;
  defaults: { url: string; text: string; notes: string };
  hasFile: boolean;
}) {
  return (
    <ActionForm action={action} className="grid gap-4">
      <input type="hidden" name="propertyId" value={propertyId} />
      <Field label="Reglamento o condiciones de ingreso" htmlFor="rulesFile" hint={hasFile ? "Ya subiste un archivo. Subí otro solo si querés reemplazarlo." : "PDF o foto (JPG, PNG). Máximo 8 MB."}>
        <input id="rulesFile" name="rulesFile" type="file" accept="application/pdf,image/jpeg,image/png,image/webp"
          className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-fixy-50 file:px-4 file:py-2 file:font-semibold file:text-fixy-800" />
      </Field>
      <Field label="…o un link al reglamento" htmlFor="url" hint="Por ejemplo, la página de la administración o un PDF compartido (https://).">
        <Input id="url" name="url" type="url" inputMode="url" defaultValue={defaults.url} placeholder="https://" maxLength={500} />
      </Field>
      <Field label="…o escribí los requisitos" htmlFor="text" hint="Si te los pasaron por mensaje, pegalos acá.">
        <Textarea id="text" name="text" rows={4} defaultValue={defaults.text} maxLength={20000} placeholder="Ej.: seguro de accidentes personales con cláusula de no repetición a favor del barrio, seguro del auto, cédula, DNI; obras de lunes a viernes de 8 a 17." />
      </Field>
      <Field label="Aclaraciones para el profesional (opcional)" htmlFor="notes" hint="Ej.: avisame con 24 h para darte el alta en la app del barrio.">
        <Textarea id="notes" name="notes" rows={2} defaultValue={defaults.notes} maxLength={2000} />
      </Field>
      <div><SubmitButton pendingText="Interpretando con IA… (puede tardar un minuto)">Guardar e interpretar con IA</SubmitButton></div>
    </ActionForm>
  );
}
