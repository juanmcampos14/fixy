import { ChevronDown } from "lucide-react";
import { requireSection } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getCatalogAdmin } from "@/server/queries/admin";
import { modeLabel } from "@/server/domain/labels";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { CategoryIcon } from "@/components/category-icon";
import { DataTable, Section, Td, Th } from "@/components/admin/ui";
import { formatMoney, minorToInput } from "@/lib/format";
import {
  createZoneAction, deleteQuestionAction, saveCategoryAction, saveCategoryCredentialsAction, saveQuestionAction, saveServiceAction, zoneActiveAction,
} from "../actions";

export const metadata = { title: "Catálogo" };

const ICONS = ["zap", "droplets", "flame", "snowflake", "washing-machine", "key-round", "paint-roller", "brick-wall", "hammer", "sparkles", "wifi", "wrench", "circle-help"];
const REGIONS: Record<string, string> = { CABA: "CABA", GBA_NORTE: "GBA Norte", GBA_OESTE: "GBA Oeste", GBA_SUR: "GBA Sur" };
const KIND_LABEL: Record<string, string> = { text: "Texto libre", select: "Opciones", boolean: "Sí / No" };

type Catalog = Awaited<ReturnType<typeof getCatalogAdmin>>;
type Cat = Catalog["categories"][number];
type Svc = Catalog["services"][number];
type Q = Catalog["questions"][number];

export default async function CatalogAdmin() {
  const actor = (await requireSection("catalogo")).actor;
  const canEdit = can(actor, "catalogo", "manage");
  const c = await getCatalogAdmin(actor.id);

  return (
    <>
      <PageHeader
        eyebrow="Configuración"
        title="Catálogo"
        description="Categorías, servicios, preguntas guiadas, credenciales requeridas y zonas de cobertura. Cada cambio queda auditado con su motivo."
      />

      <div className="space-y-6">
        <Section title="Categorías y servicios" description="Desactivar una categoría o servicio no afecta solicitudes ni trabajos existentes: deja de ofrecerse para nuevos pedidos.">
          <ul className="space-y-3">
            {c.categories.map((cat) => (
              <li key={cat.id}>
                <details className="group rounded-2xl ring-1 ring-line open:bg-cream/30">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-fixy-50 text-fixy-800"><CategoryIcon icon={cat.icon} className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{cat.name} <span className="text-sm font-normal text-muted">· {cat.slug}</span></span>
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {cat.active ? <Badge tone="ok">Activa</Badge> : <Badge tone="neutral">Inactiva</Badge>}
                        {cat.requires_review && <Badge tone="warn">Deriva a revisión</Badge>}
                        <Badge tone="neutral" icon={false}>{c.services.filter((s) => s.category_id === cat.id).length} servicio(s)</Badge>
                        <Badge tone="neutral" icon={false}>{c.questions.filter((q) => q.category_id === cat.id).length} pregunta(s)</Badge>
                        {c.required.filter((r) => r.category_id === cat.id).length > 0 && <Badge tone="info">Requiere credenciales</Badge>}
                      </span>
                    </span>
                    <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="space-y-6 border-t border-line p-4">
                    <CategoryForm cat={cat} canEdit={canEdit} />
                    <CredentialsForm cat={cat} types={c.credentialTypes} selected={c.required.filter((r) => r.category_id === cat.id).map((r) => r.credential_type_id)} canEdit={canEdit} />
                    <div>
                      <h3 className="mb-2 font-bold">Servicios</h3>
                      <ul className="space-y-2">
                        {c.services.filter((s) => s.category_id === cat.id).map((s) => (
                          <li key={s.id}>
                            <details className="rounded-xl bg-surface ring-1 ring-line">
                              <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                                <span className="font-semibold">{s.name}</span>
                                <Badge tone="neutral" icon={false}>{modeLabel[s.pricing_mode]}</Badge>
                                {s.fixed_price_minor != null && <span className="tabular text-sm text-muted">{formatMoney(s.fixed_price_minor)}</span>}
                                {s.diagnostic_price_minor != null && <span className="tabular text-sm text-muted">Visita {formatMoney(s.diagnostic_price_minor)}</span>}
                                {!s.active && <Badge tone="neutral">Inactivo</Badge>}
                              </summary>
                              <div className="border-t border-line p-3"><ServiceForm categoryId={cat.id} s={s} canEdit={canEdit} /></div>
                            </details>
                          </li>
                        ))}
                      </ul>
                      {canEdit && (
                        <details className="mt-2 rounded-xl bg-surface border border-dashed border-control">
                          <summary className="min-h-12 cursor-pointer px-3 py-3 font-semibold text-fixy-800">Agregar servicio</summary>
                          <div className="border-t border-line p-3"><ServiceForm categoryId={cat.id} canEdit /></div>
                        </details>
                      )}
                    </div>
                    <div>
                      <h3 className="mb-2 font-bold">Preguntas guiadas</h3>
                      <p className="mb-2 text-sm text-muted">Se muestran al pedir. Eliminar una pregunta no borra las respuestas ya guardadas en solicitudes.</p>
                      <ul className="space-y-2">
                        {c.questions.filter((q) => q.category_id === cat.id).map((q) => (
                          <li key={q.id}>
                            <details className="rounded-xl bg-surface ring-1 ring-line">
                              <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-2 px-3 py-2">
                                <span className="font-semibold">{q.label}</span>
                                <code className="text-xs text-muted">{q.key}</code>
                                <Badge tone="neutral" icon={false}>{KIND_LABEL[q.kind]}</Badge>
                                {q.required && <Badge tone="info" icon={false}>Obligatoria</Badge>}
                              </summary>
                              <div className="space-y-3 border-t border-line p-3">
                                <QuestionForm categoryId={cat.id} q={q} canEdit={canEdit} />
                                {canEdit && (
                                  <ConfirmAction
                                    action={deleteQuestionAction}
                                    label="Eliminar pregunta"
                                    size="sm"
                                    variant="danger"
                                    title="Eliminar pregunta"
                                    description="Deja de mostrarse en nuevas solicitudes. Las respuestas existentes se conservan."
                                    confirmLabel="Eliminar"
                                    hidden={{ id: q.id }}
                                    requireReason
                                  />
                                )}
                              </div>
                            </details>
                          </li>
                        ))}
                      </ul>
                      {canEdit && (
                        <details className="mt-2 rounded-xl bg-surface border border-dashed border-control">
                          <summary className="min-h-12 cursor-pointer px-3 py-3 font-semibold text-fixy-800">Agregar pregunta</summary>
                          <div className="border-t border-line p-3"><QuestionForm categoryId={cat.id} canEdit /></div>
                        </details>
                      )}
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {canEdit && (
            <details className="mt-4 rounded-2xl border border-dashed border-control">
              <summary className="min-h-12 cursor-pointer px-4 py-3 font-semibold text-fixy-800">Nueva categoría</summary>
              <div className="border-t border-line p-4"><CategoryForm canEdit /></div>
            </details>
          )}
        </Section>

        <Section title="Zonas de cobertura" description="Desactivar una zona la quita de nuevas solicitudes y altas; no cambia la cobertura ya declarada por proveedores.">
          <DataTable caption="Zonas" minWidth={620}>
            <thead><tr><Th>Zona</Th><Th>Región</Th><Th>Proveedores</Th><Th>Estado</Th>{canEdit && <Th>Acción</Th>}</tr></thead>
            <tbody>
              {c.zones.map((z) => (
                <tr key={z.id}>
                  <Td className="font-semibold">{z.name}<div className="text-xs font-normal text-muted">{z.code}</div></Td>
                  <Td className="text-sm">{REGIONS[z.region] ?? z.region}</Td>
                  <Td className="tabular">{z.providers}</Td>
                  <Td>{z.active ? <Badge tone="ok">Activa</Badge> : <Badge tone="neutral">Inactiva</Badge>}</Td>
                  {canEdit && (
                    <Td>
                      <ConfirmAction
                        action={zoneActiveAction}
                        label={z.active ? "Desactivar" : "Activar"}
                        size="sm"
                        variant={z.active ? "danger" : "soft"}
                        title={`${z.active ? "Desactivar" : "Activar"} ${z.name}`}
                        confirmLabel={z.active ? "Desactivar" : "Activar"}
                        hidden={{ zoneId: z.id, active: z.active ? "0" : "1" }}
                        requireReason
                      />
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
          {canEdit && (
            <details className="mt-4 rounded-2xl border border-dashed border-control">
              <summary className="min-h-12 cursor-pointer px-4 py-3 font-semibold text-fixy-800">Agregar zona</summary>
              <ActionForm action={createZoneAction} className="grid gap-4 border-t border-line p-4 sm:grid-cols-2" resetOnSuccess>
                <Field label="Nombre" htmlFor="z-name" required><Input id="z-name" name="name" required maxLength={80} placeholder="Ej.: Caballito" /></Field>
                <Field label="Código" htmlFor="z-code" required hint="Único, en mayúsculas."><Input id="z-code" name="code" required maxLength={40} placeholder="CABA_CABALLITO" /></Field>
                <Field label="Región" htmlFor="z-region" required>
                  <Select id="z-region" name="region" required defaultValue="CABA">
                    {Object.entries(REGIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="Orden" htmlFor="z-sort"><Input id="z-sort" name="sort" type="number" min={0} defaultValue={0} /></Field>
                <Field label="Motivo del cambio" htmlFor="z-reason" required className="sm:col-span-2"><Input id="z-reason" name="reason" required minLength={5} /></Field>
                <div className="sm:col-span-2"><SubmitButton>Agregar zona</SubmitButton></div>
              </ActionForm>
            </details>
          )}
        </Section>
      </div>
    </>
  );
}

function ReasonField({ id }: { id: string }) {
  return (
    <Field label="Motivo del cambio" htmlFor={id} required hint="Queda en la auditoría.">
      <Input id={id} name="reason" required minLength={5} maxLength={500} />
    </Field>
  );
}

function CategoryForm({ cat, canEdit }: { cat?: Cat; canEdit: boolean }) {
  const p = cat?.id ?? "new-cat";
  return (
    <ActionForm action={saveCategoryAction} resetOnSuccess={!cat}>
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-bold">{cat ? "Datos de la categoría" : "Nueva categoría"}</legend>
        {cat && <input type="hidden" name="id" value={cat.id} />}
        <Field label="Nombre" htmlFor={`${p}-name`} required><Input id={`${p}-name`} name="name" required maxLength={80} defaultValue={cat?.name} /></Field>
        {cat ? (
          <Field label="Identificador" htmlFor={`${p}-slug`} hint="No se cambia: se usa en enlaces."><Input id={`${p}-slug`} value={cat.slug} readOnly disabled /></Field>
        ) : (
          <Field label="Identificador (slug)" htmlFor={`${p}-slug`} required hint="Minúsculas y guiones, ej.: jardineria."><Input id={`${p}-slug`} name="slug" required maxLength={60} /></Field>
        )}
        <Field label="Descripción" htmlFor={`${p}-desc`} className="sm:col-span-2"><Textarea id={`${p}-desc`} name="description" maxLength={400} defaultValue={cat?.description} className="min-h-20" /></Field>
        <Field label="Ícono" htmlFor={`${p}-icon`} required>
          <Select id={`${p}-icon`} name="icon" defaultValue={cat?.icon ?? "wrench"}>
            {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
          </Select>
        </Field>
        <Field label="Orden" htmlFor={`${p}-sort`}><Input id={`${p}-sort`} name="sort" type="number" min={0} defaultValue={cat?.sort ?? 0} /></Field>
        <Field label="Nota de seguridad" htmlFor={`${p}-safety`} className="sm:col-span-2" hint="Se muestra al pedir (ej.: olor a gas: cortá la llave y ventilá).">
          <Textarea id={`${p}-safety`} name="safetyNote" maxLength={600} defaultValue={cat?.safety_note ?? ""} className="min-h-20" />
        </Field>
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Checkbox name="active" defaultChecked={cat?.active ?? true} label="Activa (se ofrece en nuevas solicitudes)" />
          <Checkbox name="requiresReview" defaultChecked={cat?.requires_review ?? false} label="Deriva a revisión del equipo (ej.: «Otro problema / no sé»)" />
        </div>
        {canEdit && (
          <>
            <div className="sm:col-span-2"><ReasonField id={`${p}-reason`} /></div>
            <div className="sm:col-span-2"><SubmitButton>{cat ? "Guardar categoría" : "Crear categoría"}</SubmitButton></div>
          </>
        )}
      </fieldset>
    </ActionForm>
  );
}

function CredentialsForm({ cat, types, selected, canEdit }: { cat: Cat; types: Catalog["credentialTypes"]; selected: string[]; canEdit: boolean }) {
  return (
    <ActionForm action={saveCategoryCredentialsAction}>
      <fieldset disabled={!canEdit} className="space-y-3">
        <legend className="mb-1 font-bold">Credenciales requeridas</legend>
        <p className="text-sm text-muted">Sin estas credenciales aprobadas y vigentes, un proveedor no recibe pedidos de la categoría ni puede ser aprobado con ella.</p>
        <input type="hidden" name="categoryId" value={cat.id} />
        {types.map((t) => (
          <Checkbox key={t.id} name="credentialTypeIds" value={t.id} defaultChecked={selected.includes(t.id)} label={<>{t.name}{t.expires && <span className="text-sm text-muted"> · vence</span>}</>} />
        ))}
        {canEdit && (
          <>
            <ReasonField id={`${cat.id}-cred-reason`} />
            <SubmitButton variant="secondary">Guardar credenciales</SubmitButton>
          </>
        )}
      </fieldset>
    </ActionForm>
  );
}

function ServiceForm({ categoryId, s, canEdit }: { categoryId: string; s?: Svc; canEdit: boolean }) {
  const p = s?.id ?? `new-svc-${categoryId}`;
  return (
    <ActionForm action={saveServiceAction} resetOnSuccess={!s}>
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">{s ? `Servicio ${s.name}` : "Nuevo servicio"}</legend>
        <input type="hidden" name="categoryId" value={categoryId} />
        {s && <input type="hidden" name="id" value={s.id} />}
        <Field label="Nombre" htmlFor={`${p}-name`} required><Input id={`${p}-name`} name="name" required maxLength={120} defaultValue={s?.name} /></Field>
        {s ? (
          <Field label="Identificador" htmlFor={`${p}-slug`}><Input id={`${p}-slug`} value={s.slug} readOnly disabled /></Field>
        ) : (
          <Field label="Identificador (slug)" htmlFor={`${p}-slug`} required><Input id={`${p}-slug`} name="slug" required maxLength={60} /></Field>
        )}
        <Field label="Modalidad de precio" htmlFor={`${p}-mode`} required>
          <Select id={`${p}-mode`} name="pricingMode" defaultValue={s?.pricing_mode ?? "quote"}>
            {Object.entries(modeLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Orden" htmlFor={`${p}-sort`}><Input id={`${p}-sort`} name="sort" type="number" min={0} defaultValue={s?.sort ?? 0} /></Field>
        <Field label="Precio de referencia (ARS)" htmlFor={`${p}-fixed`} hint="Obligatorio para precio cerrado.">
          <Input id={`${p}-fixed`} name="fixedPrice" inputMode="decimal" placeholder="25.000" defaultValue={s?.fixed_price_minor != null ? minorToInput(s.fixed_price_minor) : ""} />
        </Field>
        <Field label="Precio de visita (ARS)" htmlFor={`${p}-diag`} hint="Obligatorio para visita de diagnóstico.">
          <Input id={`${p}-diag`} name="diagnosticPrice" inputMode="decimal" placeholder="12.000" defaultValue={s?.diagnostic_price_minor != null ? minorToInput(s.diagnostic_price_minor) : ""} />
        </Field>
        <Field label="Descripción" htmlFor={`${p}-desc`} className="sm:col-span-2"><Textarea id={`${p}-desc`} name="description" maxLength={600} defaultValue={s?.description} className="min-h-20" /></Field>
        <Field label="Alcance (qué incluye)" htmlFor={`${p}-scope`} className="sm:col-span-2"><Textarea id={`${p}-scope`} name="scope" maxLength={2000} defaultValue={s?.scope} className="min-h-20" /></Field>
        <Field label="Exclusiones (qué no incluye)" htmlFor={`${p}-excl`} className="sm:col-span-2"><Textarea id={`${p}-excl`} name="exclusions" maxLength={2000} defaultValue={s?.exclusions} className="min-h-20" /></Field>
        <div className="sm:col-span-2"><Checkbox name="active" defaultChecked={s?.active ?? true} label="Activo" /></div>
        {canEdit && (
          <>
            <div className="sm:col-span-2"><ReasonField id={`${p}-reason`} /></div>
            <div className="sm:col-span-2"><SubmitButton variant="secondary">{s ? "Guardar servicio" : "Crear servicio"}</SubmitButton></div>
          </>
        )}
      </fieldset>
    </ActionForm>
  );
}

function QuestionForm({ categoryId, q, canEdit }: { categoryId: string; q?: Q; canEdit: boolean }) {
  const p = q?.id ?? `new-q-${categoryId}`;
  return (
    <ActionForm action={saveQuestionAction} resetOnSuccess={!q}>
      <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">{q ? `Pregunta ${q.key}` : "Nueva pregunta"}</legend>
        <input type="hidden" name="categoryId" value={categoryId} />
        {q && <input type="hidden" name="id" value={q.id} />}
        <Field label="Pregunta" htmlFor={`${p}-label`} required className="sm:col-span-2"><Input id={`${p}-label`} name="label" required maxLength={200} defaultValue={q?.label} /></Field>
        <Field label="Clave" htmlFor={`${p}-key`} required hint="Minúsculas y guion bajo. Cambiarla no migra respuestas viejas."><Input id={`${p}-key`} name="key" required maxLength={40} defaultValue={q?.key} /></Field>
        <Field label="Tipo" htmlFor={`${p}-kind`} required>
          <Select id={`${p}-kind`} name="kind" defaultValue={q?.kind ?? "text"}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </Field>
        <Field label="Opciones" htmlFor={`${p}-opts`} className="sm:col-span-2" hint="Solo para tipo «Opciones»: una por línea o separadas por coma.">
          <Textarea id={`${p}-opts`} name="options" defaultValue={(q?.options ?? []).join("\n")} className="min-h-20" />
        </Field>
        <Field label="Orden" htmlFor={`${p}-sort`}><Input id={`${p}-sort`} name="sort" type="number" min={0} defaultValue={q?.sort ?? 0} /></Field>
        <div className="flex items-end pb-3"><Checkbox name="required" defaultChecked={q?.required ?? false} label="Obligatoria" /></div>
        {canEdit && (
          <>
            <div className="sm:col-span-2"><ReasonField id={`${p}-reason`} /></div>
            <div className="sm:col-span-2"><SubmitButton variant="secondary">{q ? "Guardar pregunta" : "Agregar pregunta"}</SubmitButton></div>
          </>
        )}
      </fieldset>
    </ActionForm>
  );
}
