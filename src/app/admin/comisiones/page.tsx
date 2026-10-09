import { requireSection } from "@/server/auth/session";
import { can } from "@/server/auth/permissions";
import { getCommissionsAdmin } from "@/server/queries/admin";
import { computeBreakdown } from "@/server/domain/money";
import { PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm, ConfirmAction, SubmitButton } from "@/components/ui/form";
import { Field, Input, Select } from "@/components/ui/field";
import { DataTable, Section, Td, Th } from "@/components/admin/ui";
import { formatDateTime, formatMoney } from "@/lib/format";
import { removeCategoryRuleAction, replaceCommissionAction, updateReviewSettingsAction, updateSettingsAction } from "../actions";

export const metadata = { title: "Comisiones" };

const pct = (bps: number) => `${(bps / 100).toLocaleString("es-AR", { maximumFractionDigits: 2 })} %`;
const pctInput = (bps: number) => (bps / 100).toLocaleString("es-AR", { maximumFractionDigits: 2, useGrouping: false });

export default async function CommissionsAdmin() {
  const actor = (await requireSection("comisiones")).actor;
  const canEdit = can(actor, "comisiones", "manage");
  const { rules, settings, categories } = await getCommissionsAdmin(actor.id);
  const active = rules.filter((r) => r.active);
  const def = active.find((r) => !r.category_id);
  const history = rules.filter((r) => !r.active).slice(0, 30);
  const setting = (k: string) => settings.find((s) => s.key === k);
  const inviteLimit = Number(setting("matching.invite_limit")?.value ?? 4);
  const validDays = Number(setting("quotes.default_valid_days")?.value ?? 7);
  const listOf = (k: string, fb: number[]) => { const v = setting(k)?.value; return (Array.isArray(v) ? v : fb).join(", "); };
  const reviewDelays = listOf("reviews.publish_delay_hours", [48, 72, 168]);
  const reviewJitter = Number(setting("reviews.publish_jitter_hours")?.value ?? 12);
  const reminderDays = listOf("reviews.reminder_days", [1, 3, 7]);
  const example = def ? computeBreakdown({ laborMinor: 10_000_000, materialsMinor: 0, visitMinor: 0 }, { providerRateBps: def.provider_rate_bps, clientRateBps: def.client_rate_bps, clientFeeTaxBps: def.client_fee_tax_bps }) : null;

  return (
    <>
      <PageHeader
        eyebrow="Configuración"
        title="Comisiones y parámetros"
        description="Reglas de comisión vigentes (general y por categoría) y parámetros de la operación."
      />
      <Alert tone="info" className="mb-5" title="Los presupuestos ya enviados no cambian">
        Cada presupuesto guarda las tasas vigentes al momento de enviarlo, y cada trabajo conserva las de su contrato. Una regla nueva solo aplica a presupuestos que se
        envíen después del cambio.
      </Alert>

      <div className="space-y-6">
        <Section title="Reglas vigentes" description="Si una categoría no tiene regla propia, se aplica la general.">
          <DataTable caption="Reglas de comisión vigentes" minWidth={720}>
            <thead><tr><Th>Alcance</Th><Th>Comisión al proveedor</Th><Th>Cargo de servicio al cliente</Th><Th>Impuesto sobre el cargo</Th><Th>Desde</Th>{canEdit && <Th>Acción</Th>}</tr></thead>
            <tbody>
              {active.map((r) => (
                <tr key={r.id}>
                  <Td className="font-semibold">{r.category_name ?? <>General <Badge tone="brand" icon={false}>Por defecto</Badge></>}</Td>
                  <Td className="tabular">{pct(r.provider_rate_bps)}</Td>
                  <Td className="tabular">{pct(r.client_rate_bps)}</Td>
                  <Td className="tabular">{r.client_fee_tax_bps ? pct(r.client_fee_tax_bps) : <span className="text-muted">Sin impuesto</span>}</Td>
                  <Td className="text-sm text-muted">{formatDateTime(r.created_at)}{r.created_by_name && <div>{r.created_by_name}</div>}</Td>
                  {canEdit && (
                    <Td>
                      {r.category_id ? (
                        <ConfirmAction
                          action={removeCategoryRuleAction}
                          label="Usar la general"
                          size="sm"
                          variant="danger"
                          title={`Quitar la regla de ${r.category_name}`}
                          description="Los próximos presupuestos de esta categoría usan la regla general."
                          confirmLabel="Quitar regla"
                          hidden={{ categoryId: r.category_id }}
                          requireReason
                        />
                      ) : <span className="text-sm text-muted">—</span>}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
          {example && (
            <p className="mt-3 text-sm text-ink-2">
              Ejemplo con la regla general sobre un presupuesto de {formatMoney(example.subtotalMinor)}: el cliente paga {formatMoney(example.totalMinor)} (cargo {formatMoney(example.clientFeeMinor)}
              {example.clientFeeTaxMinor ? ` + impuesto ${formatMoney(example.clientFeeTaxMinor)}` : ""}), el proveedor recibe {formatMoney(example.providerNetMinor)} y Fixy
              ingresa {formatMoney(example.platformRevenueMinor)}.
            </p>
          )}
        </Section>

        {canEdit && (
          <Section title="Crear o reemplazar regla" description="Desactiva la regla vigente del mismo alcance y crea la nueva en una sola operación. Porcentajes con hasta 2 decimales.">
            <ActionForm action={replaceCommissionAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Alcance" htmlFor="cr-scope" required className="sm:col-span-2">
                <Select id="cr-scope" name="categoryId" defaultValue="default">
                  <option value="default">General (por defecto)</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>Categoría: {c.name}</option>)}
                </Select>
              </Field>
              <p className="rounded-xl bg-ok-bg px-3 py-2 text-sm text-ok sm:col-span-2"><strong>Comisión al profesional: 0 %.</strong> Es una promesa comercial de Fixy y la base de datos no permite otro valor. Los ingresos salen del cargo de servicio al cliente.</p>
              <Field label="Cargo de servicio al cliente (%)" htmlFor="cr-client" required hint="Se suma al total que paga el cliente.">
                <Input id="cr-client" name="clientRate" inputMode="decimal" required defaultValue={def ? pctInput(def.client_rate_bps) : "5"} />
              </Field>
              <Field label="Impuesto sobre el cargo (%)" htmlFor="cr-tax" required hint="0 si no hay impuestos configurados.">
                <Input id="cr-tax" name="clientFeeTax" inputMode="decimal" required defaultValue={def ? pctInput(def.client_fee_tax_bps) : "0"} />
              </Field>
              <Field label="Motivo del cambio" htmlFor="cr-reason" required className="sm:col-span-2"><Input id="cr-reason" name="reason" required minLength={5} maxLength={500} /></Field>
              <div className="sm:col-span-2"><SubmitButton>Guardar regla</SubmitButton></div>
            </ActionForm>
          </Section>
        )}

        <Section title="Parámetros de operación">
          <ActionForm action={updateSettingsAction}>
            <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-2">
              <legend className="sr-only">Parámetros</legend>
              <Field label="Proveedores invitados por ronda de matching" htmlFor="st-invite" required hint="matching.invite_limit · entre 1 y 10.">
                <Input id="st-invite" name="inviteLimit" type="number" min={1} max={10} required defaultValue={inviteLimit} />
              </Field>
              <Field label="Validez sugerida de un presupuesto (días)" htmlFor="st-valid" required hint="quotes.default_valid_days · entre 1 y 30.">
                <Input id="st-valid" name="quoteValidDays" type="number" min={1} max={30} required defaultValue={validDays} />
              </Field>
              {canEdit && (
                <>
                  <Field label="Motivo del cambio" htmlFor="st-reason" required className="sm:col-span-2"><Input id="st-reason" name="reason" required minLength={5} maxLength={500} /></Field>
                  <div className="sm:col-span-2"><SubmitButton variant="secondary">Guardar parámetros</SubmitButton></div>
                </>
              )}
            </fieldset>
          </ActionForm>
          <ul className="mt-4 space-y-1 text-xs text-muted">
            {settings.map((s) => <li key={s.key}><code>{s.key}</code> · actualizado {formatDateTime(s.updated_at)}{s.updated_by_name && ` por ${s.updated_by_name}`}</li>)}
          </ul>
        </Section>

        <Section title="Reseñas: publicación anónima y diferida" description="Sin reseña del cliente no se libera la liquidación. Cada reseña se publica tras un plazo elegido al azar entre los que definas, más una variación aleatoria, para que el profesional no pueda saber qué cliente la dejó. Podés cambiar la regla cuando quieras: aplica a las reseñas nuevas.">
          <ActionForm action={updateReviewSettingsAction}>
            <fieldset disabled={!canEdit} className="grid gap-4 sm:grid-cols-3">
              <legend className="sr-only">Regla de reseñas</legend>
              <Field label="Plazos posibles (horas)" htmlFor="rv-delays" required hint="Separados por coma. Ej.: 48, 72, 168 (2 días, 3 días, 1 semana).">
                <Input id="rv-delays" name="delays" required defaultValue={reviewDelays} />
              </Field>
              <Field label="Variación aleatoria (horas)" htmlFor="rv-jitter" required hint="Se suma al azar entre 0 y este valor.">
                <Input id="rv-jitter" name="jitterHours" type="number" min={0} max={72} required defaultValue={reviewJitter} />
              </Field>
              <Field label="Recordatorios al cliente (días)" htmlFor="rv-rem" required hint="Días después de completado. Ej.: 1, 3, 7.">
                <Input id="rv-rem" name="reminderDays" required defaultValue={reminderDays} />
              </Field>
              {canEdit && (
                <>
                  <Field label="Motivo del cambio" htmlFor="rv-reason" required className="sm:col-span-3"><Input id="rv-reason" name="reason" required minLength={5} maxLength={500} /></Field>
                  <div className="sm:col-span-3"><SubmitButton variant="secondary">Guardar regla de reseñas</SubmitButton></div>
                </>
              )}
            </fieldset>
          </ActionForm>
        </Section>

        <Section title="Historial de reglas" description="Reglas reemplazadas (las más recientes primero).">
          {history.length === 0 ? <p className="text-sm text-muted">Todavía no se reemplazó ninguna regla.</p> : (
            <DataTable caption="Historial de reglas" minWidth={620}>
              <thead><tr><Th>Alcance</Th><Th>Proveedor</Th><Th>Cliente</Th><Th>Impuesto</Th><Th>Creada</Th></tr></thead>
              <tbody>
                {history.map((r) => (
                  <tr key={r.id} className="text-ink-2">
                    <Td>{r.category_name ?? "General"}</Td>
                    <Td className="tabular">{pct(r.provider_rate_bps)}</Td>
                    <Td className="tabular">{pct(r.client_rate_bps)}</Td>
                    <Td className="tabular">{pct(r.client_fee_tax_bps)}</Td>
                    <Td className="text-sm">{formatDateTime(r.created_at)}{r.created_by_name && ` · ${r.created_by_name}`}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
      </div>
    </>
  );
}
