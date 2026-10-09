/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleX, FileText } from "lucide-react";
import { requireSection } from "@/server/auth/session";
import { getProviderAdmin } from "@/server/queries/admin";
import { identityStatusLabel, jobStatusLabelProvider, payoutsStatusLabel, providerStatusLabel } from "@/server/domain/labels";
import { PageHeader, DefinitionList, Stat } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, DemoBadge, StatusBadge, type Tone } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/form";
import { BackLink, Section, hoursSince } from "@/components/admin/ui";
import { AuditEntries, EntityHistory } from "@/components/admin/history";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { reviewDocumentAction, reviewProviderAction } from "../../actions";

export const metadata = { title: "Proveedor" };

const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const DOC_KIND: Record<string, string> = { identity: "Identidad", credential: "Credencial / matrícula", tax: "Fiscal", other: "Otro" };
const DOC_STATUS: Record<string, string> = { pending: "Pendiente de revisión", approved: "Aprobado", rejected: "Rechazado" };
const CRED_STATE: Record<string, [string, Tone]> = {
  valid: ["Vigente", "ok"],
  expired: ["Vencida", "danger"],
  pending: ["En revisión", "warn"],
  rejected: ["Rechazada", "danger"],
  missing: ["Sin cargar", "neutral"],
};

const REVIEW_BUTTONS: Record<string, { op: string; label: string; title: string; description: string; variant: "primary" | "secondary" | "danger" }[]> = {
  in_review: [
    { op: "approve", label: "Aprobar", title: "Aprobar proveedor", description: "Queda habilitado para recibir oportunidades si además tiene identidad verificada, cobros habilitados y credenciales vigentes.", variant: "primary" },
    { op: "observe", label: "Observar", title: "Enviar observaciones", description: "El perfil vuelve a pendiente y el proveedor ve tu observación para corregir y reenviar.", variant: "secondary" },
    { op: "reject", label: "Rechazar", title: "Rechazar alta", description: "El proveedor no podrá operar. Puede volver a enviar su perfil más adelante.", variant: "danger" },
  ],
  approved: [
    { op: "suspend", label: "Suspender", title: "Suspender proveedor", description: "Deja de recibir oportunidades y trabajos nuevos. Los trabajos en curso se gestionan aparte.", variant: "danger" },
  ],
  suspended: [
    { op: "reinstate", label: "Rehabilitar", title: "Rehabilitar proveedor", description: "Vuelve a estar aprobado. Revisá antes credenciales y documentación.", variant: "primary" },
  ],
};

export default async function ProviderAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = (await requireSection("proveedores")).actor;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getProviderAdmin(actor.id, id);
  if (!data) notFound();
  const { p, members, categories, zones, availability, portfolio, documents, required, stats, recentJobs, eligibility, checklist, events, audits } = data;
  const credSummary = {
    valid: required.filter((r) => r.state === "valid").length,
    problems: required.filter((r) => r.state !== "valid").length,
  };
  const soonExpiring = documents.filter((d) => d.status === "approved" && d.expires_on && hoursSince(d.expires_on) > -30 * 24);

  return (
    <>
      <PageHeader
        back={<BackLink href="/admin/proveedores">Proveedores</BackLink>}
        eyebrow={p.kind === "company" ? "Empresa" : "Profesional independiente"}
        title={<span className="flex flex-wrap items-center gap-2">{p.display_name} {p.is_demo && <DemoBadge />}</span>}
        description={<>Alta {formatDate(p.created_at)} · <Link href={`/profesionales/${p.slug}`} className="font-semibold text-fixy-800 hover:underline">Perfil público</Link></>}
        action={(REVIEW_BUTTONS[p.status] ?? []).map((b) => (
          <ConfirmAction
            key={b.op}
            action={reviewProviderAction}
            label={b.label}
            title={b.title}
            description={b.description}
            variant={b.variant}
            confirmLabel={b.label}
            hidden={{ providerId: p.id, op: b.op }}
            requireReason
            reasonLabel={b.op === "observe" ? "Observación para el proveedor (la va a ver)" : "Motivo (queda registrado y se le informa al proveedor)"}
          />
        ))}
      />

      {p.review_note && (
        <Alert tone="info" className="mb-5" title="Última observación registrada">{p.review_note}</Alert>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatusCard label="Operativo" status={p.status} labels={providerStatusLabel} />
        <StatusCard label="Identidad" status={p.identity_status} labels={identityStatusLabel} />
        <StatusCard label="Cobros" status={p.payouts_status} labels={payoutsStatusLabel} hint={p.has_payout_account ? `Cuenta configurada (${p.payout_provider ?? "—"})` : "Sin cuenta de cobro"} />
        <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
          <div className="text-sm text-muted">Credenciales y vencimientos</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {required.length === 0 ? <Badge tone="neutral">No requiere</Badge> : credSummary.problems ? <Badge tone="warn">{credSummary.problems} con problemas</Badge> : <Badge tone="ok">Todas vigentes</Badge>}
            {soonExpiring.length > 0 && <Badge tone="warn">{soonExpiring.length} vencida(s) o por vencer (30 días)</Badge>}
          </div>
        </div>
        <div className="col-span-2 rounded-2xl bg-white p-4 ring-1 ring-line lg:col-span-1">
          <div className="text-sm text-muted">Recibe oportunidades</div>
          <div className="mt-1.5">{eligibility.eligible ? <Badge tone="ok">Elegible</Badge> : <Badge tone="danger">No elegible</Badge>}</div>
        </div>
      </div>
      {!eligibility.eligible && (
        <Alert tone="warn" className="mb-6" title="Por qué no recibe oportunidades">
          <ul className="list-disc pl-5">{eligibility.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </Alert>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Section title="Documentación" description="Los archivos se abren con enlaces temporales privados. Aprobá o rechazá cada documento por separado.">
            {documents.length === 0 ? (
              <p className="text-sm text-muted">El proveedor todavía no cargó documentos.</p>
            ) : (
              <ul className="space-y-3">
                {documents.map((d) => (
                  <li key={d.id} className="rounded-2xl p-4 ring-1 ring-line">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">{DOC_KIND[d.kind] ?? d.kind}{d.credential_name && ` · ${d.credential_name}`}</p>
                        <a href={d.url} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex min-h-9 items-center gap-1 break-all text-sm font-semibold text-fixy-800 underline">
                          <FileText className="h-4 w-4 shrink-0" aria-hidden />{d.file_name}
                        </a>
                        <p className="text-xs text-muted">
                          Cargado {formatDateTime(d.created_at)}
                          {d.expires_on && <> · Vence {formatDate(d.expires_on)}</>}
                          {d.reviewed_at && <> · Revisado {formatDateTime(d.reviewed_at)}{d.reviewer && ` por ${d.reviewer}`}</>}
                        </p>
                        {d.review_note && <p className="mt-1 text-sm text-ink-2">Nota: {d.review_note}</p>}
                      </div>
                      <StatusBadge status={d.status} labels={DOC_STATUS} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ConfirmAction
                        action={reviewDocumentAction}
                        label={d.status === "approved" ? "Actualizar vencimiento" : "Aprobar"}
                        size="sm"
                        variant="soft"
                        title={`Aprobar documento: ${DOC_KIND[d.kind] ?? d.kind}`}
                        description={d.kind === "identity" ? "Aprobar el documento de identidad marca la identidad del proveedor como verificada." : "Indicá el vencimiento si corresponde (matrículas, seguros)."}
                        confirmLabel="Aprobar"
                        hidden={{ documentId: d.id, decision: "approved" }}
                      >
                        <div className="mt-4 space-y-1.5">
                          <label htmlFor={`exp-${d.id}`} className="block text-[15px] font-semibold">Vencimiento <span className="text-sm font-normal text-muted">(opcional)</span></label>
                          <input id={`exp-${d.id}`} type="date" name="expiresOn" defaultValue={d.expires_on ?? ""} className="block h-12 w-full rounded-xl border border-[#d3dfdc] px-3.5" />
                        </div>
                        <div className="mt-4 space-y-1.5">
                          <label htmlFor={`note-${d.id}`} className="block text-[15px] font-semibold">Nota <span className="text-sm font-normal text-muted">(opcional)</span></label>
                          <textarea id={`note-${d.id}`} name="reason" className="block min-h-20 w-full rounded-xl border border-[#d3dfdc] px-3.5 py-3" />
                        </div>
                      </ConfirmAction>
                      {d.status !== "rejected" && (
                        <ConfirmAction
                          action={reviewDocumentAction}
                          label="Rechazar"
                          size="sm"
                          variant="danger"
                          title="Rechazar documento"
                          description={d.kind === "identity" ? "La identidad del proveedor queda como rechazada hasta que cargue un documento válido." : "El proveedor verá el motivo y podrá cargar otro archivo."}
                          confirmLabel="Rechazar"
                          hidden={{ documentId: d.id, decision: "rejected" }}
                          requireReason
                          reasonLabel="Motivo del rechazo (lo ve el proveedor)"
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Credenciales obligatorias" description="Según las especialidades declaradas. Sin una credencial vigente no recibe pedidos de esa categoría.">
            {required.length === 0 ? (
              <p className="text-sm text-muted">Sus especialidades no exigen credenciales.</p>
            ) : (
              <ul className="divide-y divide-line">
                {required.map((r) => (
                  <li key={`${r.category_name}-${r.credential_type_id}`} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span><span className="font-semibold">{r.credential_name}</span> <span className="text-sm text-muted">· {r.category_name}</span>{r.expires_on && <span className="text-sm text-muted"> · vence {formatDate(r.expires_on)}</span>}</span>
                    <Badge tone={CRED_STATE[r.state][1]}>{CRED_STATE[r.state][0]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Perfil privado" description="Datos visibles solo para el proveedor y el equipo de Fixy.">
            <DefinitionList
              items={[
                ["Razón social", p.legal_name ?? "—"],
                ["CUIT", p.tax_id ?? "—"],
                ["Responsable", p.responsible_name],
                ["Email de contacto", p.contact_email],
                ["Teléfono", p.contact_phone ?? "—"],
                ["Años de experiencia", p.years_experience ?? "—"],
                ["Datos de facturación", p.billing_info ?? "—"],
                ["Zona base", p.base_zone_name ?? "—"],
                ["Acepta trabajos", p.accepting_jobs ? "Sí" : "En pausa"],
                ["Máximo de trabajos activos", p.max_active_jobs],
                ["Enviado a revisión", p.submitted_at ? formatDateTime(p.submitted_at) : "—"],
                ["Aprobado", p.approved_at ? formatDateTime(p.approved_at) : "—"],
              ]}
            />
            <h3 className="mb-1 mt-4 text-sm font-semibold text-muted">Descripción</h3>
            <p className="whitespace-pre-line text-[15px]">{p.description || "—"}</p>
          </Section>

          <Section title="Cobertura y disponibilidad">
            <h3 className="mb-1.5 text-sm font-semibold text-muted">Especialidades</h3>
            <div className="flex flex-wrap gap-1.5">{categories.length ? categories.map((c) => <Badge key={c.id} tone="brand">{c.name}</Badge>) : <span className="text-sm text-muted">Sin especialidades.</span>}</div>
            <h3 className="mb-1.5 mt-4 text-sm font-semibold text-muted">Zonas</h3>
            <div className="flex flex-wrap gap-1.5">{zones.length ? zones.map((z) => <Badge key={z.id} tone="neutral">{z.name}</Badge>) : <span className="text-sm text-muted">Sin zonas.</span>}</div>
            <h3 className="mb-1.5 mt-4 text-sm font-semibold text-muted">Disponibilidad declarada</h3>
            {availability.length ? (
              <ul className="grid gap-1 text-[15px] sm:grid-cols-2">
                {availability.map((a, i) => <li key={i}>{WEEKDAYS[a.weekday]}: {hhmm(a.start_minute)} a {hhmm(a.end_minute)} h</li>)}
              </ul>
            ) : <p className="text-sm text-muted">Sin franjas cargadas.</p>}
          </Section>

          <Section title="Portfolio">
            {portfolio.length === 0 ? <p className="text-sm text-muted">Sin fotos de trabajos.</p> : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {portfolio.map((f) => (
                  <li key={f.id} className="overflow-hidden rounded-xl ring-1 ring-line">
                    <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={f.caption || "Foto de trabajo"} className="aspect-square w-full object-cover" loading="lazy" /></a>
                    {f.caption && <p className="p-2 text-xs text-ink-2">{f.caption}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Checklist de alta">
            <ul className="space-y-1.5 text-[15px]">
              {([
                ["Perfil completo", checklist.profile],
                ["Especialidades y zonas", checklist.coverage],
                ["Disponibilidad", checklist.availability],
                ["Documento de identidad cargado", checklist.identityDocument],
                ["Credenciales obligatorias cargadas", checklist.requiredCredentials.every((r) => r.uploaded)],
                ["Datos bancarios (opcional hasta el primer retiro)", checklist.payouts],
                ["Términos para proveedores aceptados", checklist.termsAccepted],
                ["Fotos de trabajos (recomendado)", checklist.portfolio],
              ] as [string, boolean][]).map(([k, ok]) => (
                <li key={k} className="flex items-center gap-2">
                  {ok ? <CircleCheck className="h-5 w-5 text-ok" aria-hidden /> : <CircleX className="h-5 w-5 text-muted" aria-hidden />}
                  <span>{k}<span className="sr-only">: {ok ? "completo" : "pendiente"}</span></span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Actividad">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Trabajos activos" value={stats.active_jobs} />
              <Stat label="Completados" value={stats.completed_jobs} />
              <Stat label="Reseñas" value={stats.reviews ? `${stats.rating?.toString().replace(".", ",")} ★` : "—"} hint={`${stats.reviews} visibles`} />
              <Stat label="Reclamos abiertos" value={stats.open_disputes} tone={stats.open_disputes ? "warn" : "default"} />
            </div>
            {recentJobs.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {recentJobs.map((j) => (
                  <li key={j.id}>
                    <Link href={`/admin/trabajos/${j.id}`} className="flex min-h-11 items-center justify-between gap-2 py-2 hover:underline">
                      <span className="font-semibold">{j.code}</span>
                      <span className="tabular text-sm text-muted">{formatMoney(j.total_minor)}</span>
                      <StatusBadge status={j.status} labels={jobStatusLabelProvider} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/admin/trabajos?proveedor=${p.id}`} className="mt-3 inline-block text-sm font-semibold text-fixy-800 hover:underline">Ver todos sus trabajos</Link>
          </Section>

          <Section title="Integrantes">
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center justify-between gap-2 py-2.5">
                  <span className={m.active ? "" : "text-muted line-through"}>{m.full_name}</span>
                  <span className="flex gap-1.5">
                    <Badge tone="neutral" icon={false}>{m.role === "admin" ? "Administra" : "Técnico"}</Badge>
                    {!m.active && <Badge tone="neutral" icon={false}>Inactivo</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Historial">
            <EntityHistory events={events} labels={providerStatusLabel} />
          </Section>

          <Section title="Auditoría" description="Intervenciones del equipo sobre este proveedor y sus documentos.">
            <AuditEntries rows={audits} />
          </Section>
        </div>
      </div>
    </>
  );
}

function StatusCard({ label, status, labels, hint }: { label: string; status: string; labels: Record<string, string>; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1.5"><StatusBadge status={status} labels={labels} /></div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
