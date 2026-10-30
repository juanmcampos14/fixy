"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import type { ActionState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Checkbox, ChoiceChip, Field, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/form";

type Defaults = { whatsapp: { first: string; followup: string }; email: { subject: string; first: string; followup: string } };

/** Armado de una campaña: canal, oficios, dónde, tamaño, textos y ritmo. Queda en borrador para revisarla. */
export function CampaignForm({ action, categories, regions, zones, defaults, consented, templates }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>;
  categories: { id: string; name: string; candidates: number }[];
  regions: { code: string; label: string; candidates: number }[];
  zones: { id: string; name: string; candidates: number }[];
  defaults: Defaults;
  /** Textos de las plantillas de Meta (canal automático). */
  templates: { first: string; followup: string };
  /** Contactos disponibles con consentimiento para WhatsApp. */
  consented: number;
}) {
  const [state, formAction] = useActionState(action, {});
  const [channel, setChannel] = useState<"whatsapp" | "whatsapp_api" | "email">("whatsapp");
  const d = channel === "email" ? defaults.email : defaults.whatsapp;
  const auto = channel === "whatsapp_api";
  const id = typeof state.data?.id === "string" ? state.data.id : null;
  return (
    <form action={formAction} className="space-y-5">
      {state.error && <Alert tone="danger">{state.error}</Alert>}
      {state.ok && <Alert tone="ok">{state.message} {id && <Link href={`/admin/captacion/campanas/${id}`} className="font-semibold underline">Abrir la campaña</Link>}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre" htmlFor="c-name" required hint="Ej.: «Piloto plomeros Zona Norte». También es el nombre de la campaña en las métricas."><Input id="c-name" name="name" required minLength={3} maxLength={120} /></Field>
        <Field label="Canal" htmlFor="c-channel" required hint={channel === "whatsapp" ? "Lo manda una persona desde el número comercial, uno por uno." : auto ? "Sale solo desde el número comercial (plantilla aprobada por Meta), en horario comercial. Las respuestas llegan a Kommo." : "Sale solo, en horario comercial, con link de baja."}>
          <Select id="c-channel" name="channel" value={channel} onChange={(e) => setChannel(e.target.value as "whatsapp" | "whatsapp_api" | "email")}>
            <option value="whatsapp">WhatsApp (envío asistido)</option>
            <option value="whatsapp_api">WhatsApp automático (Meta + Kommo)</option>
            <option value="email">Email (automático)</option>
          </Select>
        </Field>
      </div>

      {consented > 0 && (
        <Checkbox name="onlyConsented" defaultChecked label={<>Solo contactos que dieron consentimiento para recibir WhatsApp de Fixy <span className="text-muted">({consented} disponibles)</span></>} />
      )}

      <fieldset>
        <legend className="mb-2 text-[15px] font-semibold">Oficios <span className="font-normal text-muted">(sin elegir = todos)</span></legend>
        <div className="flex flex-wrap gap-2">
          {categories.filter((c) => c.candidates > 0).map((c) => <ChoiceChip key={c.id} type="checkbox" name="categoryIds" value={c.id} label={`${c.name} (${c.candidates})`} />)}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-[15px] font-semibold">Dónde <span className="font-normal text-muted">(localidad base; sin elegir = todas)</span></legend>
        <div className="flex flex-wrap gap-2">
          {regions.filter((r) => r.candidates > 0).map((r) => <ChoiceChip key={r.code} type="checkbox" name="where" value={`region:${r.code}`} label={`${r.label} (${r.candidates})`} />)}
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-fixy-800">Elegir zonas puntuales</summary>
          <div className="mt-2 flex flex-wrap gap-2">
            {zones.filter((z) => z.candidates > 0).map((z) => <ChoiceChip key={z.id} type="checkbox" name="where" value={`zone:${z.id}`} label={`${z.name} (${z.candidates})`} />)}
          </div>
        </details>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Candidatos" htmlFor="c-size" required hint="Para la piloto: 15 a 20."><Input id="c-size" name="size" type="number" min={1} max={500} defaultValue={20} required /></Field>
        <Field label="Tope por día" htmlFor="c-cap" hint="Un número nuevo no debería mandar más de 20–30 por día."><Input id="c-cap" name="dailyCap" type="number" min={1} max={100} defaultValue={20} /></Field>
        <Field label="Seguimiento a los" htmlFor="c-days" hint="días sin respuesta"><Input id="c-days" name="followupDays" type="number" min={1} max={30} defaultValue={4} /></Field>
        <Field label="Intentos" htmlFor="c-att" hint="Primer mensaje + seguimientos">
          <Select id="c-att" name="maxAttempts" defaultValue="2"><option value="1">1</option><option value="2">2</option><option value="3">3</option></Select>
        </Field>
      </div>

      {channel === "email" && <Field label="Asunto" htmlFor="c-subject" required><Input key="subject" id="c-subject" name="emailSubject" defaultValue={defaults.email.subject} maxLength={150} required /></Field>}
      {auto ? (
        <div className="rounded-2xl bg-cream-2 p-4 text-[15px]">
          <p className="font-semibold">Mensaje: la plantilla aprobada por Meta</p>
          <p className="mt-1 whitespace-pre-wrap text-ink-2">{templates.first}</p>
          <p className="mt-2 text-sm text-muted">Con los botones «Quiero sumarme» (link de alta con su código) y «No me interesa». El recordatorio usa la segunda plantilla. Meta no permite cambiar el texto campaña por campaña.</p>
          <input type="hidden" name="firstMessage" value={templates.first} />
        </div>
      ) : (<>
      <Field label="Primer mensaje" htmlFor="c-first" required hint="Se completa solo con: {nombre} {negocio} {oficio} {zona} {link} (alta por WhatsApp) {web} (alta en la web) {baja}.">
        <Textarea key={`first-${channel}`} id="c-first" name="firstMessage" rows={8} defaultValue={d.first} required minLength={40} maxLength={1500} />
      </Field>
      <Field label="Mensaje de seguimiento" htmlFor="c-follow">
        <Textarea key={`follow-${channel}`} id="c-follow" name="followupMessage" rows={5} defaultValue={d.followup} maxLength={1500} />
      </Field>
      </>)}
      {channel === "email" && <p className="text-sm text-muted">Al pie de cada email se agrega quién escribe (FLIPS S.R.L.), por qué tenemos el dato y el link para darse de baja.</p>}
      <SubmitButton>Armar campaña (queda en borrador)</SubmitButton>
    </form>
  );
}
