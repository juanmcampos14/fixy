/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/server/auth/session";
import { asUser } from "@/server/db/client";
import { categoryOptions, getRequestAdmin } from "@/server/queries/admin";
import { findCandidates, TIME_WINDOWS } from "@/server/modules/requests";
import { jobStatusLabelProvider, modeLabel, propertyKindLabel, quoteStatusLabel, requestStatusLabel, urgencyLabel } from "@/server/domain/labels";
import { PageHeader, DefinitionList } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ConfirmAction } from "@/components/ui/form";
import { Timeline } from "@/components/domain/timeline";
import { BackLink, DataTable, Section, Td, Th, hoursSince } from "@/components/admin/ui";
import { AuditEntries } from "@/components/admin/history";
import { formatDate, formatDateTime, formatMoney, relativeTime } from "@/lib/format";
import { cancelRequestAction, inviteProviderAction, runMatchingAction, setCategoryAction } from "../../actions";

export const metadata = { title: "Solicitud" };

const INVITATION_STATUS: Record<string, string> = { invited: "Invitado", viewed: "Vio el pedido", declined: "No lo tomó", quoted: "Cotizó", expired: "Vencida", closed: "Cerrada" };
const INVITATION_SOURCE: Record<string, string> = { matching: "Matching automático", client: "Elegido por el cliente", operator: "Invitación manual del equipo" };
const ACTIVE = ["submitted", "searching", "with_quotes", "no_coverage"];

export default async function RequestAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireStaff();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getRequestAdmin(actor.id, id);
  if (!data) notFound();
  const { r, accessInfo, questions, photos, invitations, quotes, job, events, audits } = data;
  const active = ACTIVE.includes(r.status);
  const [cats, candidates] = await Promise.all([
    categoryOptions(actor.id),
    // Candidatos elegibles todavía no invitados (mismo filtro que el matching), leídos con RLS de operación.
    active && r.category_id ? asUser(actor.id, (tx) => findCandidates(tx, id, { excludeInvited: true })) : Promise.resolve([]),
  ]);
  const sentQuotes = quotes.filter((q) => q.sent_at);
  const unanswered = ["submitted", "searching", "no_coverage"].includes(r.status) && sentQuotes.length === 0 && r.submitted_at && hoursSince(r.submitted_at) > 24;
  const needsCategory = active && (r.needs_review || !r.category_id || r.category_requires_review);
  const labelFor = (k: string) => questions.find((q) => q.key === k)?.label ?? k;

  return (
    <>
      <PageHeader
        back={<BackLink href="/admin/solicitudes">Solicitudes</BackLink>}
        eyebrow={r.code}
        title={r.title}
        description={<>De {r.client_name}{r.organization_name && ` · ${r.organization_name}`} · creada {formatDateTime(r.created_at)}</>}
        action={
          <>
            {active && r.category_id && !r.category_requires_review && (
              <ConfirmAction
                action={runMatchingAction}
                label="Volver a buscar"
                variant="secondary"
                title="Reintentar el matching"
                description="Busca proveedores elegibles que todavía no fueron invitados e invita hasta el límite configurado."
                confirmLabel="Buscar"
                hidden={{ requestId: r.id }}
                requireReason
              />
            )}
            {active && (
              <ConfirmAction
                action={cancelRequestAction}
                label="Cancelar solicitud"
                variant="danger"
                title="Cancelar la solicitud"
                description="Se cierran las invitaciones activas y se rechazan los presupuestos enviados. Se notifica al cliente y a los proveedores."
                confirmLabel="Cancelar solicitud"
                hidden={{ requestId: r.id }}
                requireReason
                reasonLabel="Motivo (lo ve el cliente)"
              />
            )}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <StatusBadge status={r.status} labels={requestStatusLabel} />
        {r.needs_review && <Badge tone="warn">Para revisar</Badge>}
        {unanswered && <Badge tone="danger">Sin respuesta hace más de 24 h</Badge>}
        <Badge tone="neutral" icon={false}>{urgencyLabel[r.urgency] ?? r.urgency}</Badge>
        {r.safety_flag && <Badge tone="danger">Alerta de seguridad: {r.safety_flag}</Badge>}
      </div>

      {r.status === "no_coverage" && (
        <Alert tone="warn" className="mb-5" title="Sin cobertura">
          No hay proveedores elegibles para {r.category_name ?? "esta categoría"} en {r.zone_name}. Podés invitar manualmente a alguien elegible, reasignar la categoría o
          cancelar con un motivo claro para el cliente.
        </Alert>
      )}
      {r.needs_review && (
        <Alert tone="warn" className="mb-5" title="Necesita revisión del equipo">
          {r.review_reason ?? "Marcada para revisión."} Asigná la categoría correcta para que empiece la búsqueda.
        </Alert>
      )}
      {unanswered && r.status !== "no_coverage" && (
        <Alert tone="warn" className="mb-5" title="Sin respuesta">
          Pasaron más de 24 h desde el envío y ningún proveedor mandó presupuesto. Considerá reintentar la búsqueda o invitar manualmente.
        </Alert>
      )}
      {r.cancel_reason && <Alert tone="info" className="mb-5" title="Motivo de cancelación">{r.cancel_reason}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          {needsCategory && (
            <Section title="Asignar categoría" description="Al asignarla se quita la marca de revisión y se corre el matching.">
              <ConfirmAction
                action={setCategoryAction}
                label="Elegir categoría"
                title="Asignar categoría"
                description="Elegí el oficio que corresponde al pedido."
                confirmLabel="Asignar y buscar"
                hidden={{ requestId: r.id }}
                requireReason
              >
                <div className="mt-4 space-y-1.5">
                  <label htmlFor="cat-select" className="block text-[15px] font-semibold">Categoría</label>
                  <select id="cat-select" name="categoryId" required defaultValue="" className="block h-12 w-full rounded-xl border border-[#d3dfdc] bg-white px-3.5">
                    <option value="" disabled>Elegí una categoría</option>
                    {cats.filter((c) => c.active && !c.requires_review).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </ConfirmAction>
            </Section>
          )}

          <Section title="Pedido">
            <p className="whitespace-pre-line text-[15px]">{r.description}</p>
            <DefinitionList
              className="mt-4"
              items={[
                ["Categoría", r.category_name ?? "Sin categoría"],
                ["Servicio de catálogo", r.service_name ?? "—"],
                ["Franjas preferidas", r.preferred_windows?.length ? r.preferred_windows.map((w) => TIME_WINDOWS.find((t) => t.key === w)?.label ?? w).join(", ") : "Sin preferencia"],
                ["Origen de la clasificación", r.assistant_source === "ai" ? "Asistente (IA)" : r.assistant_source === "manual" ? "Manual" : "Reglas"],
                ["Proveedor elegido por el cliente", r.target_provider_name ?? "—"],
                ["Responsable", r.responsible_name ?? "—"],
                ["Enviada", r.submitted_at ? formatDateTime(r.submitted_at) : "—"],
              ]}
            />
            {Object.keys(r.answers ?? {}).length > 0 && (
              <>
                <h3 className="mb-1 mt-4 text-sm font-semibold text-muted">Respuestas</h3>
                <DefinitionList items={Object.entries(r.answers).map(([k, v]) => [labelFor(k), typeof v === "boolean" ? (v ? "Sí" : "No") : String(v)])} />
              </>
            )}
            {photos.length > 0 && (
              <>
                <h3 className="mb-2 mt-4 text-sm font-semibold text-muted">Fotos</h3>
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {photos.map((ph) => (
                    <li key={ph.file_id}>
                      <a href={ph.url} target="_blank" rel="noreferrer"><img src={ph.url} alt={`Foto: ${ph.original_name}`} className="aspect-square w-full rounded-xl object-cover ring-1 ring-line" loading="lazy" /></a>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Section>

          <Section title="Invitaciones" description="Orden y motivos del matching, o quién invitó manualmente.">
            {invitations.length === 0 ? <p className="text-sm text-muted">Todavía no se invitó a ningún proveedor.</p> : (
              <ul className="space-y-3">
                {invitations.map((i) => (
                  <li key={i.id} className="rounded-2xl p-4 ring-1 ring-line">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <Link href={`/admin/proveedores/${i.provider_id}`} className="font-semibold text-fixy-800 hover:underline">{i.provider_name}</Link>
                        <p className="text-xs text-muted">
                          {INVITATION_SOURCE[i.source] ?? i.source}{i.invited_by_name && ` (${i.invited_by_name})`} · {formatDateTime(i.created_at)}
                          {i.rank_position != null && ` · puesto ${i.rank_position}, puntaje ${i.rank_score}`}
                        </p>
                      </div>
                      <Badge tone={i.status === "quoted" ? "ok" : i.status === "declined" || i.status === "expired" ? "neutral" : "info"}>{INVITATION_STATUS[i.status] ?? i.status}</Badge>
                    </div>
                    {i.rank_reasons?.length > 0 && <ul className="mt-2 flex flex-wrap gap-1.5">{i.rank_reasons.map((x) => <li key={x}><Badge tone="neutral" icon={false}>{x}</Badge></li>)}</ul>}
                    {i.decline_reason && <p className="mt-2 text-sm text-ink-2">Motivo: {i.decline_reason}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {active && (
            <Section title="Invitar manualmente" description="Proveedores elegibles (categoría, zona, credenciales vigentes, cobros habilitados) que todavía no fueron invitados.">
              {!r.category_id || r.category_requires_review ? (
                <p className="text-sm text-muted">Asigná primero una categoría de oficio para ver candidatos.</p>
              ) : candidates.length === 0 ? (
                <p className="text-sm text-muted">No hay más proveedores elegibles para esta categoría y zona.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {candidates.map((c) => (
                    <li key={c.providerId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div className="min-w-0">
                        <Link href={`/admin/proveedores/${c.providerId}`} className="font-semibold text-fixy-800 hover:underline">{c.displayName}</Link>
                        <p className="text-xs text-muted">Puntaje {c.score} · {c.reasons.join(" · ")}</p>
                      </div>
                      <ConfirmAction
                        action={inviteProviderAction}
                        label="Invitar"
                        size="sm"
                        variant="soft"
                        title={`Invitar a ${c.displayName}`}
                        description="Recibe la oportunidad y puede enviar un presupuesto."
                        confirmLabel="Invitar"
                        hidden={{ requestId: r.id, providerId: c.providerId }}
                        requireReason
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title="Presupuestos" description="Cada presupuesto guarda las tasas de comisión vigentes al enviarlo.">
            {quotes.length === 0 ? <p className="text-sm text-muted">Sin presupuestos.</p> : (
              <DataTable caption="Presupuestos" minWidth={680}>
                <thead><tr><Th>Proveedor</Th><Th>Modalidad</Th><Th>Estado</Th><Th>Subtotal</Th><Th>Total cliente</Th><Th>Enviado · vence</Th></tr></thead>
                <tbody>
                  {quotes.map((q) => (
                    <tr key={q.id}>
                      <Td className="font-semibold">{q.provider_name}</Td>
                      <Td className="text-sm">{modeLabel[q.mode] ?? q.mode}<div className="text-xs text-muted">Tasas: proveedor {q.provider_rate_bps / 100} % · cliente {q.client_rate_bps / 100} %</div></Td>
                      <Td><StatusBadge status={q.status} labels={quoteStatusLabel} /></Td>
                      <Td className="tabular">{formatMoney(q.subtotal_minor)}</Td>
                      <Td className="tabular font-semibold">{formatMoney(q.total_minor)}</Td>
                      <Td className="text-sm text-muted">{q.sent_at ? relativeTime(q.sent_at) : "Borrador"}<div>Vence {formatDate(q.valid_until)}</div></Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
            {job && (
              <p className="mt-4 text-[15px]">
                Trabajo contratado: <Link href={`/admin/trabajos/${job.id}`} className="font-semibold text-fixy-800 hover:underline">{job.code}</Link>{" "}
                <StatusBadge status={job.status} labels={jobStatusLabelProvider} />
              </p>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Lugar y acceso" description="Datos sensibles: visibles para el equipo, el cliente y el proveedor contratado con pago aprobado.">
            <DefinitionList
              items={[
                ["Propiedad", `${r.property_label} (${propertyKindLabel[r.property_kind] ?? r.property_kind})`],
                ["Dirección", `${r.address_line}${r.address_extra ? `, ${r.address_extra}` : ""}`],
                ["Zona", `${r.zone_name} · ${r.region.replace("_", " ")}`],
                ["Contacto en el lugar", r.contact_name ? `${r.contact_name}${r.contact_phone ? ` · ${r.contact_phone}` : ""}` : "—"],
                ["Notas de acceso de la propiedad", r.access_notes ?? "—"],
                ["Indicaciones de acceso del pedido", accessInfo ?? "—"],
              ]}
            />
          </Section>
          <Section title="Historial">
            <Timeline events={events} kind="request" />
          </Section>
          <Section title="Auditoría">
            <AuditEntries rows={audits} />
          </Section>
        </div>
      </div>
    </>
  );
}
