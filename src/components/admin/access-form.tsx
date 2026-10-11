"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Field, Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import type { ActionState } from "@/lib/action-state";

type Section = { key: string; label: string; hint: string; manageable: boolean };
type Profile = "socio" | "operacion" | "custom";
const LEVELS = [
  { v: "", label: "No ve" },
  { v: "view", label: "Solo ve" },
  { v: "manage", label: "Ve y gestiona" },
] as const;

const PROFILES: { v: Profile; label: string; hint: string }[] = [
  { v: "socio", label: "Socio", hint: "Ve todo el panel. No puede modificar nada." },
  { v: "operacion", label: "Operación", hint: "Gestiona la operación diaria (profesionales, pedidos, trabajos, reclamos, finanzas). Ve catálogo, cargos y WhatsApp sin cambiarlos." },
  { v: "custom", label: "Personalizado", hint: "Elegís sección por sección." },
];

/** Perfil + matriz de permisos por sección. Se usa para invitar y para editar a alguien del equipo. */
function AccessFields({ sections, initialProfile, initial }: { sections: Section[]; initialProfile: Profile; initial: Record<string, string> }) {
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [perms, setPerms] = useState<Record<string, string>>(initial);
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-[15px] font-semibold">Perfil</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {PROFILES.map((p) => (
            <label key={p.v} className={cn("cursor-pointer rounded-2xl p-3 ring-1", profile === p.v ? "bg-fixy-50 ring-2 ring-fixy-600" : "bg-surface ring-line")}>
              <input type="radio" name="profile" value={p.v} checked={profile === p.v} onChange={() => setProfile(p.v)} className="sr-only" />
              <span className="block font-semibold">{p.label}</span>
              <span className="mt-0.5 block text-sm text-muted">{p.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {profile === "custom" && (
        <div className="overflow-x-auto rounded-2xl ring-1 ring-line">
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="sr-only">Permisos por sección</caption>
            <thead className="bg-cream text-muted"><tr><th scope="col" className="px-3 py-2 font-semibold">Sección</th>{LEVELS.map((l) => <th key={l.v} scope="col" className="px-2 py-2 text-center font-semibold">{l.label}</th>)}</tr></thead>
            <tbody className="divide-y divide-line">
              {sections.map((s) => (
                <tr key={s.key}>
                  <th scope="row" className="px-3 py-2 font-normal"><span className="font-semibold text-ink">{s.label}</span><span className="block text-xs text-muted">{s.hint}</span></th>
                  {LEVELS.map((l) => {
                    const disabled = l.v === "manage" && !s.manageable;
                    return (
                      <td key={l.v} className="px-2 py-2 text-center">
                        {disabled ? <span className="text-xs text-muted" title="Esta sección solo se consulta">—</span> : (
                          <input type="radio" name={`perm_${s.key}`} value={l.v} aria-label={`${s.label}: ${l.label}`} checked={(perms[s.key] ?? "") === l.v}
                            onChange={() => setPerms({ ...perms, [s.key]: l.v })} className="h-5 w-5 accent-fixy-700" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">Siempre reservado al dueño: equipo y permisos, ajustes manuales del registro financiero, liberar un pago sin reseña y transferir un retiro antes de su fecha.</p>
    </div>
  );
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-ok-bg p-3">
      <code className="min-w-0 flex-1 break-all text-sm">{link}</code>
      <button type="button" onClick={() => { navigator.clipboard?.writeText(link).then(() => setCopied(true)); }} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-semibold ring-1 ring-line">
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copiado" : "Copiar link"}
      </button>
    </div>
  );
}

export function InviteForm({ action, sections }: { action: (s: ActionState, f: FormData) => Promise<ActionState>; sections: Section[] }) {
  return (
    <ActionForm action={action} className="space-y-4">
      {(state) => (
        <>
          <Field label="Email de la persona" htmlFor="inv-email" required hint="Tiene que crear su cuenta en Fixy con este mismo email para aceptar.">
            <Input id="inv-email" name="email" type="email" required maxLength={200} autoComplete="off" />
          </Field>
          <AccessFields sections={sections} initialProfile="socio" initial={{}} />
          <SubmitButton pendingText="Creando invitación…">Crear invitación</SubmitButton>
          {state.ok && typeof state.data?.link === "string" && <CopyLink link={state.data.link} />}
        </>
      )}
    </ActionForm>
  );
}

export function EditAccessForm({ action, sections, userId, initialProfile, initial }: {
  action: (s: ActionState, f: FormData) => Promise<ActionState>; sections: Section[]; userId: string; initialProfile: Profile; initial: Record<string, string>;
}) {
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="userId" value={userId} />
      <AccessFields sections={sections} initialProfile={initialProfile} initial={initial} />
      <SubmitButton variant="secondary" pendingText="Guardando…">Guardar permisos</SubmitButton>
    </ActionForm>
  );
}
