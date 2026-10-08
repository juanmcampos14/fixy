import { CarFront, CircleAlert, Clock, Fence, FileCheck2, Info, UserRound, Building2 } from "lucide-react";
import { REQUIREMENT_KIND_LABEL, type AccessRequirements } from "@/server/assistant/access-rules";
import { cn } from "@/lib/cn";

const APPLIES = { person: { label: "Persona", Icon: UserRound }, vehicle: { label: "Vehículo", Icon: CarFront }, company: { label: "Empresa", Icon: Building2 }, all: { label: "General", Icon: FileCheck2 } } as const;

/** Lista de requisitos de ingreso a un barrio cerrado. No contiene datos que ubiquen la propiedad. */
export function AccessRequirementsView({ req, notes, className, audience }: { req: AccessRequirements | null; notes?: string | null; className?: string; audience: "client" | "provider" }) {
  if (!req && !notes) {
    return (
      <p className={cn("flex items-start gap-2 text-[15px] text-muted", className)}>
        <Fence className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        {audience === "provider" ? "Es un barrio cerrado. El cliente todavía no cargó los requisitos de ingreso: consultalo por el chat antes de ir." : "Todavía no cargaste el reglamento de ingreso."}
      </p>
    );
  }
  return (
    <div className={cn("space-y-4", className)}>
      {req?.summary && <p className="text-[15px] leading-relaxed">{req.summary}</p>}
      {req && req.requirements.length > 0 && (
        <ul className="divide-y divide-line rounded-2xl ring-1 ring-line">
          {req.requirements.map((r, i) => {
            const a = APPLIES[r.appliesTo];
            return (
              <li key={i} className="flex gap-3 px-4 py-3">
                <a.Icon className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />
                <div className="min-w-0">
                  <p className="font-semibold">{r.title}{!r.mandatory && <span className="ml-2 text-xs font-medium text-muted">(recomendado)</span>}</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{REQUIREMENT_KIND_LABEL[r.kind]} · {a.label}</p>
                  {r.detail && <p className="mt-1 text-sm text-ink-2">{r.detail}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {req?.allowedHours && <p className="flex items-start gap-2 text-sm"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-fixy-700" aria-hidden /><span><strong>Horarios:</strong> {req.allowedHours}</span></p>}
      {req?.howToRegister && <p className="flex items-start gap-2 text-sm"><FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-fixy-700" aria-hidden /><span><strong>Cómo se gestiona el ingreso:</strong> {req.howToRegister}</span></p>}
      {notes && <p className="flex items-start gap-2 text-sm"><Info className="mt-0.5 h-4 w-4 shrink-0 text-fixy-700" aria-hidden /><span><strong>Aclaraciones del cliente:</strong> {notes}</span></p>}
      {req && req.missingInfo.length > 0 && (
        <div className="rounded-xl bg-warn-bg px-3 py-2 text-sm text-ink">
          <p className="flex items-center gap-1.5 font-semibold"><CircleAlert className="h-4 w-4" aria-hidden />Para confirmar</p>
          <ul className="mt-1 list-disc pl-5">{req.missingInfo.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {req && <p className="text-xs text-muted">Interpretado con IA a partir del reglamento que cargó el cliente{req.confidence === "low" ? " (con baja certeza: confirmalo)" : ""}. Ante dudas, vale lo que diga el barrio.</p>}
    </div>
  );
}
