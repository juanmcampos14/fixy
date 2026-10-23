import Link from "next/link";
import { requireSection } from "@/server/auth/session";
import { LEAD_SOURCE_LABEL, LEAD_STAGE_LABEL, LEAD_STAGES, type LeadStage } from "@/server/modules/supply";
import {
  coverageByZone, leadFacets, listLeads, supplyByChannel, supplyByLocality, supplyByTrade, supplyFunnel, supplyOwners, supplySpend, supplySyncRuns, supplyWeekly,
} from "@/server/queries/supply";
import { PageHeader, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { ActionForm, ConfirmAction, ReadOnly, SubmitButton } from "@/components/ui/form";
import { DataTable, FilterBar, FilterField, Pagination, Section, Tabs, Td, Th } from "@/components/admin/ui";
import { REGION_LABEL } from "@/lib/regions";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { STAGE_TONE, SUPPLY_TABS } from "./labels";
import { listApiKeys } from "@/server/modules/api-keys";
import { ApiKeyForm } from "@/components/admin/supply/api-key-form";
import { env } from "@/server/env";
import { createApiKeyAction, revokeApiKeyAction, createManualLeadAction, setMarketingSpendAction, syncSheetNowAction, uploadLeadsCsvAction } from "./actions";

export const metadata = { title: "Captación" };
export const dynamic = "force-dynamic";

const VIEWS = ["candidatos", "metricas", "cargar", "integraciones"] as const;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");

type SP = { vista?: string; etapa?: string; origen?: string; oficio?: string; region?: string; q?: string; responsable?: string; pagina?: string; consentimiento?: string };

export default async function SupplyPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { readOnly } = await requireSection("captacion");
  const view = VIEWS.find((v) => v === sp.vista) ?? "candidatos";
  const funnel = await supplyFunnel();
  const reached = funnel.by.contacted + funnel.by.interested + funnel.by.registered + funnel.by.verified + funnel.by.active;
  const registered = funnel.by.registered + funnel.by.verified + funnel.by.active;

  return (
    <>
      <PageHeader eyebrow="Crecimiento" title="Captación de profesionales"
        description="Candidatos del research y de las campañas en un solo lugar. Contactado e Interesado los marca el equipo; Registrado, Verificado y Activo salen del perfil real." />

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Candidatos" value={funnel.total} hint={`${funnel.new7} nuevos en 7 días`} />
        <Stat label="Contactados" value={reached} hint={`${pct(reached, funnel.total)} del total`} />
        <Stat label="Interesados" value={funnel.by.interested} />
        <Stat label="Registrados" value={registered} hint={`${funnel.registered30} en 30 días`} tone="ok" />
        <Stat label="Verificados" value={funnel.by.verified + funnel.by.active} hint={pct(funnel.by.verified + funnel.by.active, registered)} />
        <Stat label="Activos" value={funnel.by.active} hint={`${pct(funnel.by.active, funnel.total)} de conversión`} tone="ok" />
      </div>

      <Tabs current={view} items={SUPPLY_TABS} />

      {view === "candidatos" && <Leads sp={sp} />}
      {view === "metricas" && <Metrics />}
      {view === "cargar" && <Load readOnly={readOnly} />}
      {view === "integraciones" && <Integrations readOnly={readOnly} />}
    </>
  );
}

async function Leads({ sp }: { sp: SP }) {
  const stage = LEAD_STAGES.includes(sp.etapa as LeadStage) ? (sp.etapa as LeadStage) : undefined;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const [facets, owners, list] = await Promise.all([
    leadFacets(), supplyOwners(),
    listLeads({ stage, source: sp.origen || undefined, category: sp.oficio || undefined, region: sp.region || undefined, q: sp.q, owner: sp.responsable || undefined, consented: sp.consentimiento === "si", page }),
  ]);
  return (
    <>
      <FilterBar action="/admin/captacion" clearHref="/admin/captacion">
        <FilterField label="Etapa" htmlFor="f-etapa">
          <Select id="f-etapa" name="etapa" defaultValue={stage ?? ""}>
            <option value="">Todas</option>
            {LEAD_STAGES.map((s) => <option key={s} value={s}>{LEAD_STAGE_LABEL[s]}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Oficio" htmlFor="f-oficio">
          <Select id="f-oficio" name="oficio" defaultValue={sp.oficio ?? ""}>
            <option value="">Todos</option>
            {facets.categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Región base" htmlFor="f-region">
          <Select id="f-region" name="region" defaultValue={sp.region ?? ""}>
            <option value="">Todas</option>
            {facets.regions.map((r) => <option key={r} value={r}>{REGION_LABEL[r] ?? r}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Origen" htmlFor="f-origen">
          <Select id="f-origen" name="origen" defaultValue={sp.origen ?? ""}>
            <option value="">Todos</option>
            {facets.sources.map((s) => <option key={s} value={s}>{LEAD_SOURCE_LABEL[s] ?? s}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Responsable" htmlFor="f-resp">
          <Select id="f-resp" name="responsable" defaultValue={sp.responsable ?? ""}>
            <option value="">Cualquiera</option>
            <option value="none">Sin asignar</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
          </Select>
        </FilterField>
        <FilterField label="Consentimiento" htmlFor="f-cons">
          <Select id="f-cons" name="consentimiento" defaultValue={sp.consentimiento ?? ""}>
            <option value="">Todos</option>
            <option value="si">Con consentimiento para WhatsApp</option>
          </Select>
        </FilterField>
        <FilterField label="Buscar" htmlFor="f-q" className="min-w-56">
          <Input id="f-q" name="q" defaultValue={sp.q ?? ""} placeholder="Nombre, FX-012, localidad, teléfono" />
        </FilterField>
      </FilterBar>

      {list.rows.length === 0 ? (
        <EmptyState title="No hay candidatos con esos filtros" description="Probá con otros filtros, o cargalos desde «Cargar y sincronizar»." />
      ) : (
        <DataTable caption="Candidatos" minWidth={980}>
          <thead><tr><Th>Candidato</Th><Th>Oficio</Th><Th>Localidad base</Th><Th>Contacto</Th><Th>Etapa</Th><Th>Responsable</Th><Th>Último movimiento</Th></tr></thead>
          <tbody>
            {list.rows.map((l) => (
              <tr key={l.id} className="hover:bg-cream/40">
                <Td>
                  <Link href={`/admin/captacion/${l.id}`} className="font-semibold text-fixy-800 hover:underline">{l.business_name}</Link>
                  <div className="text-xs text-muted">{l.code} · {LEAD_SOURCE_LABEL[l.source] ?? l.source}</div>
                </Td>
                <Td className="max-w-56 text-sm">{l.categories.length ? l.categories.join(", ") : <span className="text-muted">{l.trades_raw ?? "—"}</span>}</Td>
                <Td className="text-sm">{l.zone ?? l.base_locality ?? "—"}{l.base_region && <div className="text-xs text-muted">{REGION_LABEL[l.base_region] ?? l.base_region}</div>}</Td>
                <Td className="text-sm">{l.phone_raw ?? <span className="text-muted">Sin teléfono</span>}{l.email && <div className="max-w-48 truncate text-xs text-muted">{l.email}</div>}</Td>
                <Td>
                  <Badge tone={STAGE_TONE[l.stage]} icon={false}>{LEAD_STAGE_LABEL[l.stage]}</Badge>
                  {l.do_not_contact && <div className="mt-1"><Badge tone="danger" icon={false}>No contactar</Badge></div>}
                  {l.wa_consent && !l.do_not_contact && <div className="mt-1"><Badge tone="ok" icon={false}>Consintió WhatsApp</Badge></div>}
                </Td>
                <Td className="text-sm">{l.owner ?? <span className="text-muted">—</span>}</Td>
                <Td className="text-sm text-muted">{l.last_event_at ? formatDate(l.last_event_at) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
      <Pagination basePath="/admin/captacion" page={list.page} hasMore={list.hasMore}
        params={{ etapa: sp.etapa, origen: sp.origen, oficio: sp.oficio, region: sp.region, q: sp.q, responsable: sp.responsable, consentimiento: sp.consentimiento }} />
    </>
  );
}

async function Metrics() {
  const [trades, localities, coverage, channels, weekly] = await Promise.all([supplyByTrade(), supplyByLocality(), coverageByZone(), supplyByChannel(), supplyWeekly()]);
  const maxWeek = Math.max(1, ...weekly.map((w) => Math.max(w.new_leads, w.registered)));
  return (
    <>
      <Section className="mb-6" title="Por oficio" description="Arriba, los oficios con menos profesionales activos. «Pedidos por activo» alto = falta oferta: priorizá esos en la captación.">
        <DataTable caption="Captación por oficio" minWidth={760}>
          <thead><tr><Th>Oficio</Th><Th>Candidatos</Th><Th>En contacto</Th><Th>Registrados</Th><Th>Activos en Fixy</Th><Th>Pedidos 30 días</Th><Th>Pedidos por activo</Th></tr></thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.slug}>
                <Td className="font-semibold"><Link href={`/admin/captacion?oficio=${t.slug}`} className="hover:underline">{t.name}</Link></Td>
                <Td className="tabular">{t.leads}</Td>
                <Td className="tabular">{t.contacted}</Td>
                <Td className="tabular">{t.registered}</Td>
                <Td className={t.active_providers === 0 ? "tabular font-semibold text-danger" : "tabular"}>{t.active_providers}</Td>
                <Td className="tabular">{t.demand30d}</Td>
                <Td className="tabular">{t.active_providers === 0 ? (t.demand30d ? "Sin oferta" : "—") : t.ratio}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Section>

      <Section className="mb-6" title="Altas por semana" description="Candidatos nuevos que llegaron solos (campañas, WhatsApp, web) y profesionales que se registraron, últimas 12 semanas.">
        <DataTable caption="Altas por semana" minWidth={560}>
          <thead><tr><Th>Semana del</Th><Th>Nuevos por campañas y web</Th><Th>Registrados</Th></tr></thead>
          <tbody>
            {weekly.map((w) => (
              <tr key={w.week.toISOString()}>
                <Td className="text-sm">{formatDate(w.week)}</Td>
                <Td><Bar value={w.new_leads} max={maxWeek} /></Td>
                <Td><Bar value={w.registered} max={maxWeek} strong /></Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Section>

      <Section className="mb-6" title="Por canal" description="El canal es la fuente de la campaña (utm_source: meta, google…) o el origen. El costo usa el gasto cargado con el mismo nombre de canal.">
        <DataTable caption="Captación por canal" minWidth={720}>
          <thead><tr><Th>Canal</Th><Th>Candidatos</Th><Th>Registrados</Th><Th>Conversión</Th><Th>Activos</Th><Th>Gasto</Th><Th>Costo por registrado</Th><Th>Costo por activo</Th></tr></thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.channel}>
                <Td className="font-semibold">{LEAD_SOURCE_LABEL[c.channel] ?? c.channel}</Td>
                <Td className="tabular">{c.leads}</Td>
                <Td className="tabular">{c.registered}</Td>
                <Td className="tabular">{pct(c.registered, c.leads)}</Td>
                <Td className="tabular">{c.active}</Td>
                <Td className="tabular">{c.spend_minor ? formatMoney(c.spend_minor) : "—"}</Td>
                <Td className="tabular">{c.spend_minor && c.registered ? formatMoney(Math.round(c.spend_minor / c.registered)) : "—"}</Td>
                <Td className="tabular">{c.spend_minor && c.active ? formatMoney(Math.round(c.spend_minor / c.active)) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Por localidad base" description="Dónde están los candidatos (no es la zona que cubren).">
          <DataTable caption="Candidatos por localidad base" minWidth={420}>
            <thead><tr><Th>Localidad</Th><Th>Candidatos</Th><Th>Registrados</Th></tr></thead>
            <tbody>
              {localities.map((l) => (
                <tr key={l.locality}>
                  <Td className="text-sm">{l.locality}{l.region && <span className="text-xs text-muted"> · {REGION_LABEL[l.region] ?? l.region}</span>}</Td>
                  <Td className="tabular">{l.leads}</Td>
                  <Td className="tabular">{l.registered}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Section>
        <Section title="Cobertura por zona" description="Profesionales activos que trabajan en cada zona. Arriba, las de menos cobertura; los barrios cerrados marcan dónde hay más demanda potencial.">
          <DataTable caption="Cobertura por zona" minWidth={480}>
            <thead><tr><Th>Zona</Th><Th>Activos que la cubren</Th><Th>Candidatos con base ahí</Th><Th>Barrios cerrados</Th></tr></thead>
            <tbody>
              {coverage.map((z) => (
                <tr key={z.zone}>
                  <Td className="text-sm">{z.zone}<span className="text-xs text-muted"> · {REGION_LABEL[z.region] ?? z.region}</span></Td>
                  <Td className={z.providers === 0 ? "tabular font-semibold text-danger" : "tabular"}>{z.providers}</Td>
                  <Td className="tabular">{z.leads_based}</Td>
                  <Td className="tabular text-sm">{z.gated ? `${z.gated} (${z.gated_lots.toLocaleString("es-AR")} lotes)` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Section>
      </div>
    </>
  );
}

function Bar({ value, max, strong }: { value: number; max: number; strong?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 w-40 overflow-hidden rounded-full bg-cream-2" aria-hidden>
        <div className={strong ? "h-full rounded-full bg-fixy-700" : "h-full rounded-full bg-fixy-500/60"} style={{ width: `${(value / max) * 100}%` }} />
      </div>
      <span className="tabular text-sm">{value}</span>
    </div>
  );
}

async function Load({ readOnly }: { readOnly: boolean }) {
  const [runs, spend] = await Promise.all([supplySyncRuns(), supplySpend()]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <ReadOnly when={readOnly}>
      <Section className="mb-6" title="Planilla de research"
        description="Se sincroniza todos los días a las 7: entran los candidatos nuevos y se completan datos vacíos. Lo que el equipo trabajó (etapa, notas, responsable, «no contactar») nunca se pisa."
        action={!readOnly && <ConfirmAction action={syncSheetNowAction} label="Sincronizar ahora" variant="secondary" title="Sincronizar con la planilla"
          description="Lee la planilla de Google y agrega lo nuevo. Se puede repetir sin duplicar." confirmLabel="Sincronizar" />}>
        {runs.length === 0 ? <EmptyState title="Todavía no hubo sincronizaciones" description="La primera corre esta noche o con «Sincronizar ahora»." /> : (
          <DataTable caption="Sincronizaciones" minWidth={820}>
            <thead><tr><Th>Fecha</Th><Th>Fuente</Th><Th>Resultado</Th><Th>Nuevos</Th><Th>Actualizados</Th><Th>Salteados</Th><Th>Avisos</Th></tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <Td className="text-sm">{formatDateTime(r.started_at)}<div className="text-xs text-muted">{r.trigger === "cron" ? "Automática" : r.actor ?? r.trigger}</div></Td>
                  <Td className="text-sm">{r.source}</Td>
                  <Td><Badge tone={r.ok ? "ok" : r.ok === false ? "danger" : "info"}>{r.ok ? "Bien" : r.ok === false ? "Falló" : "En curso"}</Badge></Td>
                  <Td className="tabular">{r.inserted}</Td>
                  <Td className="tabular">{r.updated}</Td>
                  <Td className="tabular">{r.skipped}</Td>
                  <Td className="max-w-96 text-xs text-muted">
                    {r.issues.length === 0 ? "—" : (
                      <details><summary className="cursor-pointer">{r.issues.length} {r.issues.length === 1 ? "aviso" : "avisos"}</summary>
                        <ul className="mt-1 space-y-0.5">{r.issues.slice(0, 30).map((i, n) => <li key={n}><strong>{i.code}</strong>: {i.problem}</li>)}</ul>
                      </details>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Cargar un candidato" description="Por ejemplo, uno que recomendó un ferretero o un cliente. Se le asigna un código AL-.">
          <ActionForm action={createManualLeadAction} resetOnSuccess className="space-y-3">
            <Field label="Nombre o nombre comercial" htmlFor="m-name" required><Input id="m-name" name="businessName" required maxLength={200} /></Field>
            <Field label="Oficio" htmlFor="m-trades" required hint="Como lo diga: «plomero gasista», «pintor»…"><Input id="m-trades" name="trades" required maxLength={200} /></Field>
            <Field label="Localidad base" htmlFor="m-loc"><Input id="m-loc" name="locality" maxLength={120} placeholder="San Isidro" /></Field>
            <Field label="Celular" htmlFor="m-phone"><Input id="m-phone" name="phone" type="tel" maxLength={60} placeholder="11 5555-5555" /></Field>
            <Field label="Email" htmlFor="m-email"><Input id="m-email" name="email" type="email" maxLength={200} /></Field>
            <Field label="Web o red social" htmlFor="m-web"><Input id="m-web" name="website" maxLength={500} /></Field>
            <Field label="¿De dónde salió?" htmlFor="m-src"><Input id="m-src" name="sourceDetail" maxLength={200} placeholder="Recomendado por Ferretería López" /></Field>
            <SubmitButton>Cargar candidato</SubmitButton>
          </ActionForm>
        </Section>

        <div className="space-y-6">
          <Section title="Subir una base" description="CSV con columnas Nombre, Oficio, Localidad, Teléfono y Email (ID es opcional: sin ID se les asigna un código AL-). No duplica: si el teléfono o el email ya están, se saltea. Desde Excel o Google: Archivo › Descargar › CSV.">
            <ActionForm action={uploadLeadsCsvAction} encType="multipart/form-data" className="space-y-3">
              <Field label="Archivo CSV" htmlFor="u-file" required><Input id="u-file" name="file" type="file" accept=".csv,text/csv" required /></Field>
              <Checkbox name="consent" label="Estos contactos dieron su consentimiento para recibir WhatsApp de Fixy" />
              <Field label="¿De dónde sale el consentimiento?" htmlFor="u-consent" hint="Queda guardado en cada contacto. Es lo que te pueden pedir si alguien reclama (guardá también el respaldo).">
                <Input id="u-consent" name="consentSource" maxLength={300} placeholder="Base oficial de …, autorizaron recibir comunicaciones de …" />
              </Field>
              <SubmitButton>Importar</SubmitButton>
            </ActionForm>
          </Section>

          <Section title="Gasto en captación" description="Por canal y mes, para calcular el costo por profesional registrado y activo. Usá el mismo nombre que el utm_source de la campaña (meta, google…).">
            <ActionForm action={setMarketingSpendAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
              <Field label="Canal" htmlFor="s-ch" required><Input id="s-ch" name="channel" required maxLength={40} placeholder="meta" /></Field>
              <Field label="Mes" htmlFor="s-month" required><Input id="s-month" name="month" type="month" required defaultValue={thisMonth} /></Field>
              <Field label="Importe" htmlFor="s-amount" required><Input id="s-amount" name="amount" required inputMode="decimal" placeholder="150.000" /></Field>
              <Field label="Nota" htmlFor="s-note"><Input id="s-note" name="note" maxLength={300} /></Field>
              <div className="sm:col-span-2"><SubmitButton>Guardar gasto</SubmitButton></div>
            </ActionForm>
            {spend.length > 0 && (
              <ul className="mt-4 divide-y divide-line text-sm">
                {spend.map((s) => (
                  <li key={`${s.channel}-${s.month.toISOString()}`} className="flex justify-between gap-3 py-2">
                    <span><strong>{s.channel}</strong> · {s.month.toLocaleDateString("es-AR", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
                    <span className="tabular">{formatMoney(s.amount_minor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </ReadOnly>
  );
}

async function Integrations({ readOnly }: { readOnly: boolean }) {
  const keys = await listApiKeys();
  const base = env().APP_URL.replace(/\/$/, "");
  return (
    <ReadOnly when={readOnly}>
      <Section className="mb-6" title="API de solo lectura"
        description="Para que ChatGPT, Claude o una planilla consulten los datos de captación sin exportar archivos. Solo lee: no puede cambiar nada. No entrega teléfonos ni emails de los candidatos. Cada consulta queda registrada y la clave se puede revocar.">
        <ol className="mb-5 list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2">
          <li>Creá una clave acá abajo y copiala (se muestra una sola vez).</li>
          <li><strong>ChatGPT:</strong> en un GPT personalizado › Configurar › Acciones › Importar desde URL: <code className="break-all">{base}/api/v1/openapi.json</code>. En Autenticación elegí «Clave de API», tipo «Bearer», y pegá la clave.</li>
          <li><strong>Claude u otras herramientas:</strong> las mismas direcciones, con el encabezado <code>Authorization: Bearer &lt;clave&gt;</code>.</li>
          <li>Qué se puede consultar: resumen y embudo, oficios (oferta y demanda), zonas y cobertura, localidades, canales, campañas, candidatos y «¿ya lo tenemos?» para no duplicar el research.</li>
        </ol>
        {!readOnly && <ApiKeyForm action={createApiKeyAction} />}
      </Section>
      <Section title="Claves">
        {keys.length === 0 ? <EmptyState title="Todavía no hay claves" description="Creá una para conectar ChatGPT o Claude." /> : (
          <DataTable caption="Claves de la API" minWidth={760}>
            <thead><tr><Th>Nombre</Th><Th>Clave</Th><Th>Creada</Th><Th>Vence</Th><Th>Último uso</Th><Th>Consultas 7 días</Th><Th>Estado</Th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <Td className="font-semibold">{k.name}<div className="text-xs font-normal text-muted">{k.created_by ?? "—"}</div></Td>
                  <Td><code className="text-sm">{k.prefix}…</code></Td>
                  <Td className="text-sm">{formatDate(k.created_at)}</Td>
                  <Td className="text-sm">{k.expires_at ? formatDate(k.expires_at) : "Nunca"}</Td>
                  <Td className="text-sm">{k.last_used_at ? formatDateTime(k.last_used_at) : "Nunca"}</Td>
                  <Td className="tabular">{k.requests7d}</Td>
                  <Td>
                    {k.revoked_at ? <Badge tone="neutral" icon={false}>Revocada</Badge>
                      : k.expires_at && k.expires_at < new Date() ? <Badge tone="warn" icon={false}>Vencida</Badge>
                      : !readOnly ? <ConfirmAction action={revokeApiKeyAction} label="Revocar" size="sm" variant="danger" title={`Revocar «${k.name}»`}
                          description="Deja de funcionar en el momento. Lo que la use va a tener que configurarse con una clave nueva." confirmLabel="Revocar" hidden={{ keyId: k.id }} />
                      : <Badge tone="ok" icon={false}>Activa</Badge>}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </ReadOnly>
  );
}
