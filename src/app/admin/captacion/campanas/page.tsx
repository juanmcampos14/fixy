import Link from "next/link";
import { requireSection } from "@/server/auth/session";
import { CHANNEL_LABEL, complianceGaps, DEFAULT_EMAIL_FIRST, DEFAULT_EMAIL_FOLLOWUP, DEFAULT_EMAIL_SUBJECT, DEFAULT_WHATSAPP_FIRST, DEFAULT_WHATSAPP_FOLLOWUP, getCompliance } from "@/server/modules/supply-campaigns";
import { campaignFormOptions, listCampaigns } from "@/server/queries/supply";
import { SUPPLY_TEMPLATES, supplyNumberConfigured, supplyNumberStatus, supplyTemplatesStatus } from "@/server/whatsapp/supply-number";
import { kommoConfigured } from "@/server/integrations/kommo";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { ActionForm, ConfirmAction, ReadOnly, SubmitButton } from "@/components/ui/form";
import { DataTable, Section, Tabs, Td, Th } from "@/components/admin/ui";
import { CampaignForm } from "@/components/admin/supply/campaign-form";
import { REGION_LABEL } from "@/lib/regions";
import { formatDate } from "@/lib/format";
import { CAMPAIGN_STATUS, SUPPLY_TABS } from "../labels";
import { createCampaignAction, createSupplyTemplatesAction, setComplianceAction, setupKommoAction } from "../actions";

export const metadata = { title: "Campañas de captación" };
export const dynamic = "force-dynamic";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");

export default async function CampaignsPage() {
  const { readOnly } = await requireSection("captacion");
  const [campaigns, compliance, options] = await Promise.all([listCampaigns(), getCompliance(), campaignFormOptions()]);
  const waGaps = complianceGaps(compliance, "whatsapp");
  const apiGaps = complianceGaps(compliance, "whatsapp_api");
  const emailGaps = complianceGaps(compliance, "email");
  // Estado en Meta del número comercial y de las plantillas (solo si está conectado).
  const [number, templates] = supplyNumberConfigured() ? await Promise.all([supplyNumberStatus(), supplyTemplatesStatus()]) : [null, null];
  return (
    <>
      <PageHeader eyebrow="Crecimiento" title="Campañas de captación"
        description="Tandas de candidatos por oficio y zona, con invitación personalizada, seguimiento y resultados. Se arman en borrador y se activan cuando están los requisitos." />
      <Tabs current="campanas" items={SUPPLY_TABS} />

      <ReadOnly when={readOnly}>
        <Section className="mb-6" title="Requisitos antes de enviar"
          description="Las campañas se pueden armar y revisar, pero no se activan hasta completar esto. Ver docs/captacion.md.">
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Badge tone={waGaps.length ? "warn" : "ok"}>{waGaps.length ? `WhatsApp asistido: falta ${waGaps.length}` : "WhatsApp asistido: listo"}</Badge>
            <Badge tone={apiGaps.length || templates?.first !== "APPROVED" ? "warn" : "ok"}>{apiGaps.length || templates?.first !== "APPROVED" ? "WhatsApp automático: falta" : "WhatsApp automático: listo"}</Badge>
            <Badge tone={emailGaps.length ? "warn" : "ok"}>{emailGaps.length ? `Email: falta ${emailGaps.length}` : "Email: listo"}</Badge>
          </div>
          {[...new Set([...waGaps, ...apiGaps, ...emailGaps])].length > 0 && (
            <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-ink-2">{[...new Set([...waGaps, ...apiGaps, ...emailGaps])].map((g) => <li key={g}>{g}</li>)}</ul>
          )}
          <div className="mb-5 rounded-2xl bg-cream-2 p-4 text-[15px]">
            <p className="font-semibold">WhatsApp automático (API de Meta + Kommo)</p>
            <ul className="mt-2 space-y-1 text-sm">
              <li>Número: {number ? <>{number.display} · {number.name ?? "sin nombre visible"} · calidad <strong>{number.quality ?? "—"}</strong> · límite {number.tier ?? "—"}</> : "sin conectar (cargar SUPPLY_WHATSAPP_PHONE_NUMBER_ID, SUPPLY_WHATSAPP_WABA_ID y el token en Vercel)"}</li>
              <li>Plantillas: {templates ? Object.entries(templates).map(([k, v]) => `${k === "first" ? "invitación" : "recordatorio"} ${v}`).join(" · ") : "—"}</li>
              <li>Kommo: {kommoConfigured() ? "conectado" : "sin conectar (cargar KOMMO_TOKEN y KOMMO_SUBDOMINIO en Vercel)"}</li>
            </ul>
            {!readOnly && (
              <div className="mt-3 flex flex-wrap gap-2">
                <ConfirmAction action={createSupplyTemplatesAction} label="Crear plantillas en Meta" size="sm" variant="secondary" title="Mandar las plantillas a revisión"
                  description="Crea en la cuenta de WhatsApp del número comercial las dos plantillas de invitación (categoría marketing). Meta suele aprobarlas en minutos u horas." confirmLabel="Crear" />
                <ConfirmAction action={setupKommoAction} label="Armar embudo en Kommo" size="sm" variant="secondary" title="Armar el embudo «Captación Fixy»"
                  description="Crea en Kommo el embudo con las etapas Invitado, Recordatorio, Respondió, Interesado, Se registró y No le interesa / Baja. No borra nada." confirmLabel="Armar" />
              </div>
            )}
          </div>
          <ActionForm action={setComplianceAction} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="WhatsApp comercial" htmlFor="cm-num" hint="El número desde el que se mandan las invitaciones. Tiene que ser distinto del bot.">
                <Input id="cm-num" name="commercialNumber" type="tel" defaultValue={compliance.commercialNumber} placeholder="+54 9 11 5555-5555" maxLength={30} />
              </Field>
              <Field label="Inscripción de la base ante la AAIP (recomendada)" htmlFor="cm-aaip" hint="Número o constancia del Registro Nacional de Bases de Datos. No es obligatorio para activar.">
                <Input id="cm-aaip" name="aaipRegistration" defaultValue={compliance.aaipRegistration} maxLength={120} />
              </Field>
            </div>
            <Checkbox name="metaPolicyReviewed" defaultChecked={compliance.metaPolicyReviewed}
              label={<>Revisamos las políticas de WhatsApp Business: los mensajes salen del número comercial (no del bot), los manda una persona, con tope diario, y quien pide la baja no se vuelve a contactar.</>} />
            <Checkbox name="emailPolicyReviewed" defaultChecked={compliance.emailPolicyReviewed}
              label={<>Revisamos los emails: remitente identificado (FLIPS S.R.L.), origen del dato, link de baja en cada envío y frecuencia baja (Ley 25.326, art. 27).</>} />
            <SubmitButton variant="secondary">Guardar requisitos</SubmitButton>
            {compliance.updatedAt && <p className="text-xs text-muted">Último cambio: {compliance.updatedBy ?? "—"}, {formatDate(compliance.updatedAt)}.</p>}
          </ActionForm>
        </Section>

        <Section className="mb-6" title="Campañas">
          {campaigns.length === 0 ? <EmptyState title="Todavía no hay campañas" description="Armá la primera piloto acá abajo: 15 a 20 candidatos de un oficio y una zona." /> : (
            <DataTable caption="Campañas" minWidth={900}>
              <thead><tr><Th>Campaña</Th><Th>Estado</Th><Th>Candidatos</Th><Th>Enviados</Th><Th>Abrieron el link</Th><Th>Respondieron</Th><Th>Registrados</Th><Th>Activos</Th><Th>Bajas</Th></tr></thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <Td>
                      <Link href={`/admin/captacion/campanas/${c.id}`} className="font-semibold text-fixy-800 hover:underline">{c.name}</Link>
                      <div className="text-xs text-muted">{CHANNEL_LABEL[c.channel]} · {[...c.categories, ...c.regions.map((r) => REGION_LABEL[r] ?? r), ...c.zones].join(", ") || "Todos"}</div>
                    </Td>
                    <Td><Badge tone={CAMPAIGN_STATUS[c.status].tone} icon={false}>{CAMPAIGN_STATUS[c.status].label}</Badge></Td>
                    <Td className="tabular">{c.total}</Td>
                    <Td className="tabular">{c.sent}{c.followups_due ? <div className="text-xs text-warn">{c.followups_due} seguimientos</div> : null}</Td>
                    <Td className="tabular">{c.clicked} <span className="text-xs text-muted">{pct(c.clicked, c.sent)}</span></Td>
                    <Td className="tabular">{c.replied}</Td>
                    <Td className="tabular font-semibold">{c.registered} <span className="text-xs font-normal text-muted">{pct(c.registered, c.sent)}</span></Td>
                    <Td className="tabular">{c.active}</Td>
                    <Td className="tabular">{c.opted_out}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>

        {!readOnly && (
          <Section title="Armar una campaña" description="Toma candidatos que todavía no se registraron, sin «no contactar», sin otra campaña abierta y con el canal elegido. Queda en borrador: la revisás, sacás a quien no corresponda y recién ahí la activás.">
            <CampaignForm action={createCampaignAction} categories={options.categories} zones={options.zones}
              consented={options.consented}
              templates={{ first: SUPPLY_TEMPLATES.first.body, followup: SUPPLY_TEMPLATES.followup.body }}
              regions={options.regions.map((r) => ({ code: r.code, label: REGION_LABEL[r.code] ?? r.code, candidates: r.candidates }))}
              defaults={{ whatsapp: { first: DEFAULT_WHATSAPP_FIRST, followup: DEFAULT_WHATSAPP_FOLLOWUP }, email: { subject: DEFAULT_EMAIL_SUBJECT, first: DEFAULT_EMAIL_FIRST, followup: DEFAULT_EMAIL_FOLLOWUP } }} />
          </Section>
        )}
      </ReadOnly>
    </>
  );
}
