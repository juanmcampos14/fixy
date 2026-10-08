/* eslint-disable @next/next/no-img-element */
/** Secciones del alta y del perfil del proveedor (componentes de servidor). */
import { CircleCheck, CircleDashed, FileText, ImagePlus, Trash2 } from "lucide-react";
import type { OnboardingChecklist } from "@/server/modules/providers";
import type { OwnProvider, ProviderSetup } from "@/server/queries/provider";
import {
  acceptTermsAction, addPortfolioAction, removePortfolioAction, setupPayoutsAction, updateCoverageAction, uploadDocumentAction,
} from "@/app/proveedor/alta/actions";
import { paymentsAreTestMode } from "@/server/env";
import { identityStatusLabel, payoutsStatusLabel, providerStatusLabel } from "@/server/domain/labels";
import { Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Checkbox, ChoiceChip, Field, Input, Select } from "@/components/ui/field";
import { CategoryIcon } from "@/components/category-icon";
import { formatDate, formatDateTime } from "@/lib/format";
import { DOCUMENT_KIND_LABEL, DOCUMENT_STATUS_LABEL, REGION_LABEL, WEEKDAYS, WEEKDAY_ORDER, groupZones } from "./constants";

export function Done({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-[15px]">
      {ok ? <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden /> : <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />}
      <span>
        {children}
        <span className="sr-only">{ok ? " (completo)" : " (pendiente)"}</span>
      </span>
    </li>
  );
}

/** Estados separados: operativo, identidad, cobros y credenciales. */
export function ProviderStatusCard({ provider, checklist, eligibility }: { provider: OwnProvider; checklist: OnboardingChecklist; eligibility: { eligible: boolean; reasons: string[] } }) {
  const creds = checklist.requiredCredentials;
  return (
    <Card>
      <CardHeader title="Estado de tu cuenta" description="Cada estado se revisa por separado." />
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-cream/60 p-3 ring-1 ring-line">
          <dt className="text-sm text-muted">Perfil</dt>
          <dd className="mt-1"><StatusBadge status={provider.status} labels={providerStatusLabel} /></dd>
        </div>
        <div className="rounded-2xl bg-cream/60 p-3 ring-1 ring-line">
          <dt className="text-sm text-muted">Identidad</dt>
          <dd className="mt-1"><StatusBadge status={provider.identity_status} labels={identityStatusLabel} /></dd>
        </div>
        <div className="rounded-2xl bg-cream/60 p-3 ring-1 ring-line">
          <dt className="text-sm text-muted">Cobros</dt>
          <dd className="mt-1 flex flex-wrap gap-1.5"><StatusBadge status={provider.payouts_status} labels={payoutsStatusLabel} />{provider.payout_provider === "mock" && <TestModeBadge />}</dd>
        </div>
        <div className="rounded-2xl bg-cream/60 p-3 ring-1 ring-line">
          <dt className="text-sm text-muted">Credenciales obligatorias</dt>
          <dd className="mt-1">
            {creds.length === 0 ? <Badge tone="neutral">No aplica a tus especialidades</Badge>
              : creds.every((c) => c.uploaded) ? <Badge tone="info">Cargadas ({creds.length})</Badge>
              : <Badge tone="warn">Faltan {creds.filter((c) => !c.uploaded).length} de {creds.length}</Badge>}
          </dd>
        </div>
      </dl>
      {provider.review_note && (
        <Alert
          tone={provider.status === "rejected" || provider.status === "suspended" ? "danger" : provider.status === "pending" ? "warn" : "info"}
          title={provider.status === "approved" || provider.status === "in_review" ? "Nota de la última revisión" : "Observaciones del equipo de Fixy"}
          className="mt-4"
        >
          <p className="whitespace-pre-line">{provider.review_note}</p>
          {provider.status === "pending" && <p className="mt-1">Corregí lo indicado y volvé a enviar a revisión.</p>}
        </Alert>
      )}
      <div className="mt-4">
        {eligibility.eligible ? (
          <Alert tone="ok" title="Podés recibir oportunidades">Te invitamos a solicitudes de tus especialidades y zonas según tu disponibilidad.</Alert>
        ) : (
          <Alert tone="info" title="Todavía no recibís oportunidades">
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{eligibility.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </Alert>
        )}
      </div>
    </Card>
  );
}

export function CoverageSection({ setup, provider, id = "servicios" }: { setup: ProviderSetup; provider: OwnProvider; id?: string }) {
  const byDay = new Map<number, { start_minute: number; end_minute: number }>();
  for (const a of setup.availability) if (!byDay.has(a.weekday)) byDay.set(a.weekday, a);
  const hours = Array.from({ length: 25 }, (_, h) => h);
  return (
    <Card as="section" id={id} aria-labelledby={`${id}-t`} className="scroll-mt-24">
      <CardHeader title={<span id={`${id}-t`}>Servicios, zonas y disponibilidad</span>} description="Te invitamos solo a solicitudes que coinciden con esto." />
      <ActionForm action={updateCoverageAction} className="space-y-6">
        <fieldset>
          <legend className="mb-2 text-[15px] font-semibold">Especialidades</legend>
          <div className="flex flex-wrap gap-2">
            {setup.categories.map((c) => (
              <ChoiceChip key={c.id} type="checkbox" name="categoryIds" value={c.id} defaultChecked={setup.selectedCats.includes(c.id)}
                label={<span className="inline-flex items-center gap-1.5"><CategoryIcon icon={c.icon} className="h-4 w-4" />{c.name}</span>} />
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">Algunas especialidades piden una matrícula o credencial vigente. Las ves en Documentación.</p>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-[15px] font-semibold">Zonas donde trabajás</legend>
          <div className="space-y-3">
            {groupZones(setup.zones).map(([region, zs]) => (
              <div key={region}>
                <p className="mb-1.5 text-sm font-semibold text-muted">{REGION_LABEL[region] ?? region}</p>
                <div className="flex flex-wrap gap-2">
                  {zs.map((z) => <ChoiceChip key={z.id} type="checkbox" name="zoneIds" value={z.id} defaultChecked={setup.selectedZones.includes(z.id)} label={z.name} />)}
                </div>
              </div>
            ))}
          </div>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Zona base" htmlFor="cv-base" hint="Desde dónde salís habitualmente.">
            <Select id="cv-base" name="baseZoneId" defaultValue={provider.base_zone_id ?? ""}>
              <option value="">La primera zona elegida</option>
              {groupZones(setup.zones).map(([region, zs]) => (
                <optgroup key={region} label={REGION_LABEL[region] ?? region}>
                  {zs.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Máximo de trabajos activos a la vez" htmlFor="cv-max" required>
            <Input id="cv-max" name="maxActiveJobs" type="number" min={1} max={500} defaultValue={provider.max_active_jobs} required />
          </Field>
        </div>
        <Checkbox name="acceptingJobs" defaultChecked={provider.accepting_jobs} label="Estoy recibiendo trabajos nuevos (podés pausarlo cuando quieras)" />
        <fieldset>
          <legend className="mb-1 text-[15px] font-semibold">Disponibilidad semanal</legend>
          <p className="mb-3 text-sm text-muted">Marcá los días y el horario en que podés trabajar.</p>
          <div className="divide-y divide-line rounded-2xl ring-1 ring-line">
            {WEEKDAY_ORDER.map((d) => {
              const slot = byDay.get(d);
              return (
                <div key={d} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 px-3 py-2 sm:grid-cols-[180px_auto_auto]">
                  <Checkbox name={`day_${d}`} defaultChecked={!!slot} label={WEEKDAYS[d]} />
                  <label className="sr-only" htmlFor={`start-${d}`}>Desde ({WEEKDAYS[d]})</label>
                  <Select id={`start-${d}`} name={`start_${d}`} defaultValue={String(slot ? Math.floor(slot.start_minute / 60) : 8)} className="h-11 w-24">
                    {hours.slice(0, 24).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                  </Select>
                  <label className="sr-only" htmlFor={`end-${d}`}>Hasta ({WEEKDAYS[d]})</label>
                  <Select id={`end-${d}`} name={`end_${d}`} defaultValue={String(slot ? Math.ceil(slot.end_minute / 60) : 18)} className="h-11 w-24">
                    {hours.slice(1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
                  </Select>
                </div>
              );
            })}
          </div>
        </fieldset>
        <SubmitButton pendingText="Guardando…">Guardar servicios y zonas</SubmitButton>
      </ActionForm>
    </Card>
  );
}

export function PortfolioSection({ setup, id = "portfolio" }: { setup: ProviderSetup; id?: string }) {
  return (
    <Card as="section" id={id} aria-labelledby={`${id}-t`} className="scroll-mt-24">
      <CardHeader title={<span id={`${id}-t`}>Portfolio</span>} description="Fotos de trabajos tuyos. Son públicas en tu perfil. Recomendado, no obligatorio (hasta 12)." />
      {setup.portfolio.length > 0 ? (
        <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {setup.portfolio.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-2xl bg-cream/60 ring-1 ring-line">
              <img src={p.url} alt={p.caption || "Foto de trabajo"} className="aspect-[4/3] w-full object-cover" loading="lazy" />
              <div className="flex items-start justify-between gap-2 p-2">
                <p className="min-w-0 text-sm">{p.caption || <span className="text-muted">Sin descripción</span>}</p>
                <ActionForm action={removePortfolioAction}>
                  <input type="hidden" name="itemId" value={p.id} />
                  <SubmitButton variant="ghost" size="sm" className="h-11 w-11 px-0"><Trash2 className="h-4 w-4" aria-hidden /><span className="sr-only">Quitar foto</span></SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-muted">Todavía no cargaste fotos.</p>
      )}
      {setup.portfolio.length < 12 && (
        <ActionForm action={addPortfolioAction} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" resetOnSuccess>
          <Field label="Foto (JPG, PNG o WEBP)" htmlFor={`${id}-photo`} required>
            <input id={`${id}-photo`} name="photo" type="file" accept="image/jpeg,image/png,image/webp" required className="block w-full text-sm file:mr-3 file:h-11 file:rounded-full file:border-0 file:bg-fixy-50 file:px-4 file:font-semibold file:text-fixy-800" />
          </Field>
          <Field label="Descripción breve" htmlFor={`${id}-cap`}>
            <Input id={`${id}-cap`} name="caption" maxLength={200} placeholder="Ej.: tablero nuevo en departamento" />
          </Field>
          <SubmitButton variant="soft" pendingText="Subiendo…"><ImagePlus className="h-4 w-4" aria-hidden /> Subir</SubmitButton>
        </ActionForm>
      )}
      <p className="mt-3 text-xs text-muted">No subas fotos con datos personales, direcciones o caras de clientes.</p>
    </Card>
  );
}

export function DocumentsSection({ setup, checklist, id = "documentacion" }: { setup: ProviderSetup; checklist: OnboardingChecklist; id?: string }) {
  return (
    <Card as="section" id={id} aria-labelledby={`${id}-t`} className="scroll-mt-24">
      <CardHeader title={<span id={`${id}-t`}>Documentación</span>} description="Los documentos son privados: solo los ve el equipo de Fixy para verificarte." />
      <ul className="mb-4 space-y-1.5">
        <Done ok={checklist.identityDocument}>Documento de identidad (DNI, frente y dorso)</Done>
        {checklist.requiredCredentials.map((c) => (
          <Done key={`${c.categoryName}-${c.credentialTypeId}`} ok={c.uploaded}>{c.credentialName} <span className="text-muted">· obligatoria para {c.categoryName}</span></Done>
        ))}
      </ul>
      {setup.documents.length > 0 && (
        <ul className="mb-5 divide-y divide-line rounded-2xl ring-1 ring-line">
          {setup.documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
              <div className="min-w-0">
                <p className="font-semibold">{d.credential_name ?? DOCUMENT_KIND_LABEL[d.kind] ?? d.kind}</p>
                <p className="text-sm text-muted">
                  <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline"><FileText className="h-3.5 w-3.5" aria-hidden />{d.file_name ?? "Archivo"}</a>
                  {" · "}cargado {formatDateTime(d.created_at)}{d.expires_on && ` · vence ${formatDate(d.expires_on)}`}
                </p>
                {d.review_note && <p className="mt-1 text-sm text-ink-2">Observación: {d.review_note}</p>}
              </div>
              <StatusBadge status={d.status === "approved" ? "approved" : d.status === "rejected" ? "failed" : "pending"} labels={{ approved: DOCUMENT_STATUS_LABEL.approved, failed: DOCUMENT_STATUS_LABEL.rejected, pending: DOCUMENT_STATUS_LABEL.pending }} />
            </li>
          ))}
        </ul>
      )}
      <ActionForm action={uploadDocumentAction} className="space-y-4 rounded-2xl bg-cream/60 p-4 ring-1 ring-line" resetOnSuccess>
        <h3 className="font-bold">Cargar un documento</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Tipo" htmlFor={`${id}-kind`} required>
            <Select id={`${id}-kind`} name="kind" defaultValue={checklist.identityDocument ? "credential" : "identity"}>
              {Object.entries(DOCUMENT_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Tipo de credencial" htmlFor={`${id}-cred`} hint="Solo si cargás una credencial o matrícula.">
            <Select id={`${id}-cred`} name="credentialTypeId" defaultValue="">
              <option value="">—</option>
              {setup.credentialTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Fecha de vencimiento" htmlFor={`${id}-exp`} hint="Si el documento vence.">
            <Input id={`${id}-exp`} name="expiresOn" type="date" />
          </Field>
          <Field label="Archivo (JPG, PNG, WEBP o PDF, hasta 8 MB)" htmlFor={`${id}-file`} required>
            <input id={`${id}-file`} name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required className="block w-full text-sm file:mr-3 file:h-11 file:rounded-full file:border-0 file:bg-fixy-50 file:px-4 file:font-semibold file:text-fixy-800" />
          </Field>
        </div>
        <SubmitButton variant="soft" pendingText="Subiendo…">Subir documento</SubmitButton>
      </ActionForm>
    </Card>
  );
}

export function PayoutsSection({ provider, id = "cobros" }: { provider: OwnProvider; id?: string }) {
  const test = paymentsAreTestMode();
  const configured = provider.payouts_status === "enabled" || provider.payouts_status === "pending";
  return (
    <Card as="section" id={id} aria-labelledby={`${id}-t`} className="scroll-mt-24">
      <CardHeader title={<span id={`${id}-t`}>Cobros</span>} description="Para recibir pagos, vinculás una cuenta en la pasarela de pagos." action={test ? <TestModeBadge /> : undefined} />
      <p className="text-[15px] text-ink-2">
        La configuración se hace con el proceso de la pasarela: ahí cargás tus datos de cobro. Fixy guarda solo una referencia a esa cuenta, nunca tus datos bancarios.
      </p>
      {test && <Alert tone="warn" className="mt-3" title="Modo de prueba">En esta versión la vinculación es simulada. No se mueve dinero real.</Alert>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <StatusBadge status={provider.payouts_status} labels={payoutsStatusLabel} />
        {provider.payouts_status !== "enabled" && (
          <ActionForm action={setupPayoutsAction}>
            <SubmitButton variant={configured ? "secondary" : "primary"} pendingText="Configurando…">{configured ? "Retomar configuración" : "Configurar cobros"}</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}

export function TermsSection({ setup, accepted, id = "terminos" }: { setup: ProviderSetup; accepted: boolean; id?: string }) {
  const t = setup.terms;
  return (
    <Card as="section" id={id} aria-labelledby={`${id}-t`} className="scroll-mt-24">
      <CardHeader title={<span id={`${id}-t`}>Términos para proveedores</span>} />
      {!t ? (
        <p className="text-muted">Todavía no hay términos publicados.</p>
      ) : (
        <>
          <p className="text-[15px]">
            {t.title} · versión {t.version} {t.is_draft && <Badge tone="warn" icon={false} className="ml-1">Borrador</Badge>}
          </p>
          {t.is_draft && <p className="mt-1 text-sm text-muted">Es una versión preliminar en revisión legal. Te avisamos si cambia.</p>}
          {accepted || t.accepted ? (
            <p className="mt-3 flex items-center gap-2 font-semibold text-ok"><CircleCheck className="h-5 w-5" aria-hidden /> Aceptados</p>
          ) : (
            <ActionForm action={acceptTermsAction} className="mt-4">
              <SubmitButton pendingText="Registrando…">Acepto los términos para proveedores</SubmitButton>
            </ActionForm>
          )}
        </>
      )}
    </Card>
  );
}
