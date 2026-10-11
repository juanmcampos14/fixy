import Link from "next/link";
import { Fragment } from "react";
import { requireSection } from "@/server/auth/session";
import { isPlatformAdmin } from "@/server/auth/actor";
import { sql } from "@/server/db/client";
import { reconcile } from "@/server/modules/payments";
import { getLedger, jobsForAdjustment, listCharges, listPayouts, listRefunds } from "@/server/queries/admin";
import { chargeKindLabel, chargeStatusLabel, jobStatusLabelProvider, payoutStatusLabel, payoutsStatusLabel } from "@/server/domain/labels";
import { PageHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge, StatusBadge, TestModeBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { ConfirmAction } from "@/components/ui/form";
import { DataTable, Section, Tabs, Td, Th } from "@/components/admin/ui";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listChargebacks, listPendingWithdrawals, listRecoveries } from "@/server/modules/withdrawals";
import { payWithdrawalAction, rejectWithdrawalAction, executePayoutAction, releaseWithoutReviewAction, manualAdjustmentAction, payoutHoldAction, resyncChargeAction, settleRecoveryAction, waiveRecoveryAction } from "../actions";

export const metadata = { title: "Finanzas" };

const TABS = [
  { key: "retiros", label: "Retiros" },
  { key: "cobros", label: "Cobros" },
  { key: "liquidaciones", label: "Liquidaciones" },
  { key: "reembolsos", label: "Reembolsos" },
  { key: "recuperos", label: "Recuperos" },
  { key: "contracargos", label: "Contracargos" },
  { key: "conciliacion", label: "Conciliación" },
  { key: "registro", label: "Registro financiero" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const ACCOUNT_LABEL: Record<string, string> = {
  gateway_clearing: "Pasarela (fondos en tránsito)",
  client_payments: "Pagos de clientes",
  platform_revenue: "Ingresos de plataforma",
  provider_payable: "A pagar a proveedores",
  taxes_payable: "Impuestos a pagar",
  refunds: "Reembolsos",
};
const ENTRY_LABEL: Record<string, string> = {
  charge: "Cobro", deposit: "Anticipo", balance: "Saldo", extra: "Adicional", platform_fee: "Comisión / cargo", provider_payable: "Neto proveedor",
  refund: "Reembolso", chargeback: "Contracargo", payout: "Liquidación", adjustment: "Ajuste", reversal: "Reverso",
};

const STATUS_FILTER = ["pending", "processing", "approved", "failed", "partially_refunded", "refunded"];

export default async function FinanceAdmin({ searchParams }: { searchParams: Promise<{ tab?: string; estado?: string }> }) {
  const sp = await searchParams;
  const actor = (await requireSection("finanzas")).actor;
  const tab: TabKey = (TABS.find((t) => t.key === sp.tab)?.key ?? "retiros") as TabKey;

  return (
    <>
      <PageHeader
        eyebrow="Operación"
        title="Finanzas"
        description="Cobros, liquidaciones, reembolsos y registro financiero. Los movimientos no se editan ni se borran: las correcciones se hacen con ajustes o reversos."
      />
      <Alert tone="info" className="mb-5" title="Comprobante de pago no es factura">
        Fixy emite comprobantes de pago internos (registro del cobro). Esta versión del MVP no emite facturas fiscales: la facturación electrónica queda pendiente.
      </Alert>
      <Tabs current={tab} items={TABS.map((t) => ({ key: t.key, label: t.label, href: `/admin/finanzas?tab=${t.key}` }))} />
      {tab === "retiros" && <Withdrawals canPayEarly={isPlatformAdmin(actor)} />}
      {tab === "cobros" && <Charges userId={actor.id} status={STATUS_FILTER.includes(sp.estado ?? "") ? sp.estado : undefined} />}
      {tab === "liquidaciones" && <Payouts userId={actor.id} />}
      {tab === "reembolsos" && <Refunds userId={actor.id} />}
      {tab === "recuperos" && <Recoveries all={sp.estado === "todos"} canWaive={isPlatformAdmin(actor)} />}
      {tab === "contracargos" && <Chargebacks />}
      {tab === "conciliacion" && <Reconciliation />}
      {tab === "registro" && <Ledger userId={actor.id} canAdjust={isPlatformAdmin(actor)} />}
    </>
  );
}

async function Withdrawals({ canPayEarly }: { canPayEarly: boolean }) {
  const rows = await listPendingWithdrawals(sql());
  if (!rows.length) return <EmptyState title="No hay retiros pendientes" description="Los profesionales piden retirar su saldo una vez por mes; cada pedido se transfiere a los 20 días." />;
  return (
    <Section id="retiros" title="Retiros a transferir" description="Transferí a la cuenta indicada y registrá la referencia. Los datos bancarios son confidenciales.">
      <DataTable caption="Retiros pendientes">
        <thead><tr><Th>Profesional</Th><Th className="text-right">Monto</Th><Th>Transferir el</Th><Th>Cuenta destino</Th><Th>Acciones</Th></tr></thead>
        <tbody className="divide-y divide-line">
          {rows.map((w) => (
            <tr key={w.id} className="align-top">
              <Td><Link href={`/admin/proveedores/${w.provider_id}`} className="font-semibold hover:underline">{w.provider_name}</Link><div className="text-xs text-muted">{w.jobs} trabajo{w.jobs === 1 ? "" : "s"} · pedido {formatDateTime(w.requested_at)}</div></Td>
              <Td className="text-right font-semibold">{formatMoney(w.amount_minor)}{w.is_test && <div><TestModeBadge /></div>}</Td>
              <Td>{formatDate(w.scheduled_for)}{w.due ? <div><Badge tone="warn">Vence hoy o antes</Badge></div> : null}</Td>
              <Td className="text-sm">
                <div className="font-semibold">{w.bank_snapshot.holderName}</div>
                <div className="text-muted">CUIT/CUIL {w.bank_snapshot.holderTaxId}</div>
                {w.bank_snapshot.cbu && <div className="font-mono">CBU {w.bank_snapshot.cbu}</div>}
                {w.bank_snapshot.alias && <div>Alias {w.bank_snapshot.alias}</div>}
                {w.bank_snapshot.bankName && <div className="text-muted">{w.bank_snapshot.bankName}</div>}
              </Td>
              <Td>
                <div className="flex flex-col items-start gap-2">
                  {(w.due || canPayEarly) && (
                    <ConfirmAction action={payWithdrawalAction} label={w.due ? "Registrar transferencia" : "Transferir antes de fecha"} size="sm" title="Registrar transferencia"
                      description={`Confirmá que transferiste ${formatMoney(w.amount_minor)} a ${w.bank_snapshot.holderName}.${w.is_test ? " Modo de prueba: no se mueve dinero real." : ""}`}
                      requireReason reasonLabel="Referencia de la transferencia" hidden={{ withdrawalId: w.id, early: w.due ? "0" : "1" }} confirmLabel="Registrar" />
                  )}
                  {!w.due && !canPayEarly && <span className="text-sm text-muted">Disponible desde el {formatDate(w.scheduled_for)}</span>}
                  <ConfirmAction action={rejectWithdrawalAction} label="Rechazar" variant="ghost" size="sm" title="Rechazar retiro"
                    description="El saldo vuelve a estar disponible y el profesional puede volver a pedirlo este mes." requireReason hidden={{ withdrawalId: w.id }} confirmLabel="Rechazar" />
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Section>
  );
}

async function Charges({ userId, status }: { userId: string; status?: string }) {
  const rows = await listCharges(userId, status);
  return (
    <>
      <nav aria-label="Filtrar cobros por estado" className="mb-4 flex flex-wrap gap-2 text-sm">
        <Link href="/admin/finanzas?tab=cobros" className={!status ? "font-bold underline" : "text-fixy-800 hover:underline"}>Todos</Link>
        {STATUS_FILTER.map((s) => (
          <Link key={s} href={`/admin/finanzas?tab=cobros&estado=${s}`} className={status === s ? "font-bold underline" : "text-fixy-800 hover:underline"}>{chargeStatusLabel[s]}</Link>
        ))}
      </nav>
      {rows.length === 0 ? <EmptyState title="Sin cobros" description="No hay cobros con ese estado." /> : (
        <DataTable caption="Cobros" minWidth={1080}>
          <thead><tr><Th>Fecha</Th><Th>Trabajo</Th><Th>Concepto</Th><Th>Estado</Th><Th>Importe</Th><Th>Cargo cliente + imp.</Th><Th>Comisión prov.</Th><Th>Neto prov.</Th><Th>Reembolsado</Th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <Td className="text-sm">{formatDateTime(c.created_at)}{c.approved_at && <div className="text-xs text-muted">Aprobado {formatDateTime(c.approved_at)}</div>}</Td>
                <Td><Link href={`/admin/trabajos/${c.job_id}`} className="font-semibold text-fixy-800 hover:underline">{c.job_code}</Link><div className="text-xs text-muted">{c.external_reference}</div></Td>
                <Td className="text-sm">{chargeKindLabel[c.kind] ?? c.kind}<div className="mt-1 flex flex-wrap gap-1">{c.is_test && <TestModeBadge />}<Badge tone="neutral" icon={false}>{c.gateway === "mock" ? "Pasarela simulada" : "Mercado Pago"}</Badge></div></Td>
                <Td><StatusBadge status={c.status} labels={chargeStatusLabel} />{c.failure_reason && <div className="mt-1 text-xs text-muted">{c.failure_reason}</div>}</Td>
                <Td className="tabular font-semibold">{formatMoney(c.amount_minor)}</Td>
                <Td className="tabular">{formatMoney(c.client_fee_minor + c.tax_minor)}</Td>
                <Td className="tabular">{formatMoney(c.provider_fee_minor)}</Td>
                <Td className="tabular">{formatMoney(c.provider_net_minor)}</Td>
                <Td className="tabular">{c.refunded_minor ? formatMoney(c.refunded_minor) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}

async function Payouts({ userId }: { userId: string }) {
  const rows = await listPayouts(userId);
  return (
    <>
      <Alert tone="warn" className="mb-4" title="Liquidaciones simuladas">
        «Ejecutar» registra una transferencia en la pasarela simulada: es un evento de prueba y no mueve dinero real. Solo se liquidan trabajos completados, sin retención,
        de proveedores con cobros habilitados.
      </Alert>
      {rows.length === 0 ? <EmptyState title="Sin liquidaciones" description="Se generan cuando un trabajo se completa." /> : (
        <DataTable caption="Liquidaciones" minWidth={1040}>
          <thead><tr><Th>Trabajo</Th><Th>Proveedor</Th><Th>Estado</Th><Th>Bruto</Th><Th>Comisión</Th><Th>Ajustes</Th><Th>Neto</Th><Th>Acciones</Th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const open = ["pending", "scheduled", "failed"].includes(p.status);
              return (
                <tr key={p.id}>
                  <Td>
                    <Link href={`/admin/trabajos/${p.job_id}`} className="font-semibold text-fixy-800 hover:underline">{p.job_code}</Link>
                    <div className="mt-1"><StatusBadge status={p.job_status} labels={jobStatusLabelProvider} /></div>
                  </Td>
                  <Td className="text-sm"><Link href={`/admin/proveedores/${p.provider_id}`} className="hover:underline">{p.provider_name}</Link><div className="text-xs text-muted">{payoutsStatusLabel[p.payouts_status]}</div></Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={p.status} labels={payoutStatusLabel} />
                      {p.on_hold && <Badge tone="danger">Retenida</Badge>}
                      {p.awaiting_review && open && <Badge tone="warn">Esperando reseña</Badge>}
                      {p.is_test && <TestModeBadge />}
                    </div>
                    {p.hold_reason && <div className="mt-1 text-xs text-muted">{p.hold_reason}</div>}
                    {p.review_override_reason && <div className="mt-1 text-xs text-muted">Liberada sin reseña: {p.review_override_reason}</div>}
                    {p.paid_at && <div className="mt-1 text-xs text-muted">Pagada {formatDateTime(p.paid_at)}</div>}
                    {p.scheduled_for && !p.paid_at && <div className="mt-1 text-xs text-muted">Programada {formatDate(p.scheduled_for)}</div>}
                  </Td>
                  <Td className="tabular">{formatMoney(p.gross_minor)}</Td>
                  <Td className="tabular">− {formatMoney(p.fee_minor)}</Td>
                  <Td className="tabular">{p.adjustments_minor ? `${p.adjustments_minor < 0 ? "− " : ""}${formatMoney(Math.abs(p.adjustments_minor))}` : "—"}</Td>
                  <Td className="tabular font-semibold">{formatMoney(p.amount_minor)}</Td>
                  <Td>
                    {open ? (
                      <div className="flex flex-wrap gap-2">
                        {p.awaiting_review && (
                          <ConfirmAction
                            action={releaseWithoutReviewAction}
                            label="Liberar sin reseña"
                            size="sm"
                            variant="secondary"
                            title={`Excepción: liberar sin reseña · ${p.job_code}`}
                            description="Regla: sin reseña del cliente no se libera la liquidación. Usá esta excepción solo en casos justificados (por ejemplo, cliente que no responde tras los recordatorios). Queda auditada. Solo administradores."
                            confirmLabel="Liberar sin reseña"
                            hidden={{ payoutId: p.id }}
                            requireReason
                          />
                        )}
                        {!p.on_hold && !p.awaiting_review && (
                          <ConfirmAction
                            action={executePayoutAction}
                            label="Ejecutar (simulada)"
                            size="sm"
                            title={`Ejecutar liquidación simulada · ${p.job_code}`}
                            description={<>Se registra una transferencia <strong>simulada</strong> de {formatMoney(p.amount_minor)} a {p.provider_name}. No se mueve dinero real.</>}
                            confirmLabel="Registrar liquidación simulada"
                            hidden={{ payoutId: p.id }}
                            requireReason
                            reasonLabel="Motivo o referencia (ej.: Liquidación simulada semanal)"
                          />
                        )}
                        <ConfirmAction
                          action={payoutHoldAction}
                          label={p.on_hold ? "Liberar" : "Retener"}
                          size="sm"
                          variant={p.on_hold ? "secondary" : "danger"}
                          title={p.on_hold ? "Liberar liquidación" : "Retener liquidación"}
                          description={p.on_hold ? "La liquidación vuelve a poder ejecutarse." : "No se podrá ejecutar hasta que la liberes."}
                          confirmLabel={p.on_hold ? "Liberar" : "Retener"}
                          hidden={{ payoutId: p.id, hold: p.on_hold ? "0" : "1" }}
                          requireReason
                        />
                      </div>
                    ) : <span className="text-sm text-muted">{p.external_ref ? `Ref. ${p.external_ref}` : "—"}</span>}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </DataTable>
      )}
    </>
  );
}

async function Refunds({ userId }: { userId: string }) {
  const rows = await listRefunds(userId);
  if (rows.length === 0) return <EmptyState title="Sin reembolsos" description="Los reembolsos se inician desde el detalle de un trabajo o al resolver un reclamo." />;
  return (
    <DataTable caption="Reembolsos" minWidth={900}>
      <thead><tr><Th>Fecha</Th><Th>Trabajo</Th><Th>Cobro original</Th><Th>Importe</Th><Th>Motivo</Th><Th>Pidió</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="text-sm">{formatDateTime(r.created_at)}</Td>
            <Td><Link href={`/admin/trabajos/${r.job_id}`} className="font-semibold text-fixy-800 hover:underline">{r.job_code}</Link>{r.dispute_id && <div><Link href={`/admin/reclamos/${r.dispute_id}`} className="text-xs text-fixy-800 hover:underline">Por reclamo</Link></div>}</Td>
            <Td className="text-sm">{chargeKindLabel[r.charge_kind] ?? r.charge_kind} · {formatMoney(r.charge_amount_minor)}<div className="mt-1 flex flex-wrap gap-1"><StatusBadge status={r.charge_status} labels={chargeStatusLabel} />{r.is_test && <TestModeBadge />}</div></Td>
            <Td className="tabular font-semibold">{formatMoney(r.amount_minor)}<div className="text-xs font-normal text-muted">{r.status === "approved" ? "Aprobado" : r.status === "failed" ? "Fallido" : "Pendiente"}</div></Td>
            <Td className="max-w-72 text-sm">{r.reason}</Td>
            <Td className="text-sm">{r.requested_by_name ?? "—"}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

const RECOVERY_STATUS: Record<string, { label: string; tone: "warn" | "info" | "ok" | "neutral" }> = {
  open: { label: "Pendiente", tone: "warn" },
  applied: { label: "En un retiro", tone: "info" },
  settled: { label: "Saldado", tone: "ok" },
  waived: { label: "Condonado", tone: "neutral" },
};

async function Recoveries({ all, canWaive }: { all: boolean; canWaive: boolean }) {
  const rows = await listRecoveries(sql(), all ? "all" : "pending");
  const pending = rows.filter((r) => r.status === "open" || r.status === "applied").reduce((s, r) => s + Number(r.amount_minor), 0);
  return (
    <>
      <p className="mb-3 text-[15px] text-ink-2">
        Lo que un profesional cobró de más por un reembolso o contracargo posterior. Se descuenta solo de su próximo retiro; también podés registrar que lo devolvió por transferencia
        {canWaive ? " o condonarlo si el error fue de Fixy" : ""}.
      </p>
      <nav aria-label="Filtrar recuperos" className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/admin/finanzas?tab=recuperos" className={!all ? "font-bold underline" : "text-fixy-800 hover:underline"}>Pendientes</Link>
        <Link href="/admin/finanzas?tab=recuperos&estado=todos" className={all ? "font-bold underline" : "text-fixy-800 hover:underline"}>Todos</Link>
        {pending > 0 && <span className="ml-auto font-semibold">Pendiente de recuperar: <span className="tabular">{formatMoney(pending)}</span></span>}
      </nav>
      {rows.length === 0 ? <EmptyState title="Sin recuperos pendientes" description="Aparecen cuando se reembolsa un trabajo que el profesional ya cobró." /> : (
        <DataTable caption="Recuperos" minWidth={960}>
          <thead><tr><Th>Fecha</Th><Th>Profesional</Th><Th>Trabajo</Th><Th>Importe</Th><Th>Estado</Th><Th>Motivo</Th><Th>Acciones</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="align-top">
                <Td className="text-sm">{formatDateTime(r.created_at)}{r.settled_at && <div className="text-xs text-muted">Cerrado {formatDateTime(r.settled_at)}</div>}</Td>
                <Td><Link href={`/admin/proveedores/${r.provider_id}`} className="font-semibold hover:underline">{r.provider_name}</Link>{r.payout_kind === "referral" && <div className="text-xs text-muted">Por recomendación</div>}</Td>
                <Td>{r.job_id ? <Link href={`/admin/trabajos/${r.job_id}`} className="font-semibold text-fixy-800 hover:underline">{r.job_code}</Link> : "—"}</Td>
                <Td className="tabular font-semibold">{formatMoney(Number(r.amount_minor))}{r.is_test && <div><TestModeBadge /></div>}</Td>
                <Td><Badge tone={RECOVERY_STATUS[r.status].tone} icon={false}>{RECOVERY_STATUS[r.status].label}</Badge></Td>
                <Td className="max-w-72 text-sm text-ink-2">{r.reason}</Td>
                <Td>
                  {r.status === "open" ? (
                    <div className="flex flex-col items-start gap-2">
                      <ConfirmAction action={settleRecoveryAction} label="Registrar devolución" size="sm" variant="secondary" title="El profesional devolvió el importe"
                        description={`Confirmá que recibiste ${formatMoney(Number(r.amount_minor))} de ${r.provider_name}. Deja de descontarse de sus retiros.`}
                        requireReason reasonLabel="Referencia de la transferencia recibida" hidden={{ recoveryId: r.id }} confirmLabel="Registrar" />
                      {canWaive && (
                        <ConfirmAction action={waiveRecoveryAction} label="Condonar" size="sm" variant="ghost" title="Condonar recupero"
                          description="Fixy absorbe el importe y no se descuenta al profesional. Queda auditado. Solo administradores."
                          requireReason reasonLabel="Motivo (mínimo 10 caracteres)" hidden={{ recoveryId: r.id }} confirmLabel="Condonar" />
                      )}
                    </div>
                  ) : <span className="text-sm text-muted">{r.status === "applied" ? "Se salda al transferir el retiro" : "—"}</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}

async function Chargebacks() {
  const rows = await listChargebacks(sql());
  if (!rows.length) {
    return <EmptyState title="Sin contracargos ni reclamos" description="Cuando un cliente abre un reclamo o desconoce un pago en Mercado Pago, aparece acá: retenemos la liquidación del profesional y registramos el reembolso si el banco lo devuelve." />;
  }
  return (
    <DataTable caption="Contracargos y reclamos en la pasarela" minWidth={820}>
      <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Trabajo</Th><Th>Profesional</Th><Th>Importe</Th><Th>Liquidación</Th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.kind}-${r.id}`}>
            <Td className="text-sm">{formatDateTime(r.created_at)}</Td>
            <Td>{r.kind === "chargeback" ? <Badge tone="danger">Contracargo</Badge> : <Badge tone="warn">Reclamo abierto</Badge>}{r.is_test && <div className="mt-1"><TestModeBadge /></div>}</Td>
            <Td><Link href={`/admin/trabajos/${r.job_id}`} className="font-semibold text-fixy-800 hover:underline">{r.job_code}</Link></Td>
            <Td className="text-sm">{r.provider_name}</Td>
            <Td className="tabular font-semibold">{formatMoney(Number(r.amount_minor))}</Td>
            <Td className="text-sm">{r.on_hold ? "Retenida" : "Liberada"}</Td>
          </tr>
        ))}
      </tbody>
    </DataTable>
  );
}

async function Reconciliation() {
  // La pasarela simulada vive en tablas de sistema: se lee con la conexión del servidor (página ya restringida a operación).
  const rows = await reconcile(sql());
  return (
    <>
      <p className="mb-4 text-[15px] text-ink-2">Compara cada cobro (últimos 500) con el estado informado por la pasarela. Si hay diferencias, «Re-sincronizar» consulta la pasarela y aplica el estado con la misma lógica que los webhooks.</p>
      {rows.length === 0 ? <EmptyState title="Sin diferencias" description="Todos los cobros coinciden con la pasarela." /> : (
        <DataTable caption="Diferencias de conciliación" minWidth={860}>
          <thead><tr><Th>Trabajo</Th><Th>Referencia</Th><Th>Diferencia</Th><Th>Interno</Th><Th>Pasarela</Th><Th>Acción</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.chargeId}>
                <Td className="font-semibold">{r.jobCode}</Td>
                <Td className="text-xs text-muted">{r.externalReference}</Td>
                <Td><Badge tone="warn">{r.issue}</Badge></Td>
                <Td className="text-sm">{chargeStatusLabel[r.internalStatus] ?? r.internalStatus}<div className="tabular">{formatMoney(r.internalAmount)}</div></Td>
                <Td className="text-sm">{r.gatewayStatus ?? "—"}<div className="tabular">{formatMoney(r.gatewayAmount)}</div></Td>
                <Td>
                  <ConfirmAction
                    action={resyncChargeAction}
                    label="Re-sincronizar"
                    size="sm"
                    variant="secondary"
                    title="Re-sincronizar cobro"
                    description="Consulta la pasarela y, si corresponde, actualiza el cobro y el registro financiero. Queda auditado."
                    confirmLabel="Re-sincronizar"
                    hidden={{ chargeId: r.chargeId }}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}

async function Ledger({ userId, canAdjust }: { userId: string; canAdjust: boolean }) {
  const [{ entries, totals }, jobs] = await Promise.all([getLedger(userId), canAdjust ? jobsForAdjustment(userId) : Promise.resolve([])]);
  const accounts = [...new Set(totals.map((t) => t.account))];
  const groups: { txn: string; rows: (typeof entries)[number][] }[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.txn === e.txn_id) last.rows.push(e);
    else groups.push({ txn: e.txn_id, rows: [e] });
  }
  return (
    <div className="space-y-6">
      <Alert tone="info" title="Registro inmutable">
        Cada transacción agrupa asientos que suman cero (débito positivo, crédito negativo). Los asientos no se editan ni se borran: cualquier corrección se registra como
        ajuste o reverso, con motivo y responsable.
      </Alert>

      <Section title="Saldos por cuenta" description="Suma histórica de cada cuenta, separada entre movimientos reales y de prueba.">
        {accounts.length === 0 ? <p className="text-sm text-muted">Sin movimientos.</p> : (
          <DataTable caption="Saldos por cuenta" minWidth={560}>
            <thead><tr><Th>Cuenta</Th><Th>Real</Th><Th>Modo de prueba</Th></tr></thead>
            <tbody>
              {accounts.map((acc) => {
                const real = totals.find((t) => t.account === acc && !t.is_test);
                const test = totals.find((t) => t.account === acc && t.is_test);
                return (
                  <tr key={acc}>
                    <Td className="font-semibold">{ACCOUNT_LABEL[acc] ?? acc}</Td>
                    <Td className="tabular">{real ? `${formatMoney(real.total)} (${real.entries})` : "—"}</Td>
                    <Td className="tabular">{test ? `${formatMoney(test.total)} (${test.entries})` : "—"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Section>

      {canAdjust && (
        <Section title="Ajuste manual" description="Solo administradores. Agrega una transacción compensatoria entre «A pagar a proveedores» e «Ingresos de plataforma».">
          <ConfirmAction
            action={manualAdjustmentAction}
            label="Registrar ajuste"
            variant="secondary"
            title="Registrar ajuste manual"
            description="No modifica asientos existentes ni la liquidación ya generada: queda como movimiento nuevo, auditado."
            confirmLabel="Registrar ajuste"
            requireReason
            reasonLabel="Motivo descriptivo (mínimo 10 caracteres)"
          >
            <div className="mt-4 space-y-1.5">
              <label htmlFor="adj-job" className="block text-[15px] font-semibold">Trabajo</label>
              <select id="adj-job" name="jobId" required defaultValue="" className="block h-12 w-full rounded-xl border border-control bg-surface px-3.5">
                <option value="" disabled>Elegí un trabajo</option>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.code} · {j.provider_name}</option>)}
              </select>
            </div>
            <div className="mt-4 space-y-1.5">
              <label htmlFor="adj-dir" className="block text-[15px] font-semibold">Sentido</label>
              <select id="adj-dir" name="direction" required defaultValue="credit" className="block h-12 w-full rounded-xl border border-control bg-surface px-3.5">
                <option value="credit">A favor del proveedor (sale de ingresos de plataforma)</option>
                <option value="debit">A cargo del proveedor (vuelve a ingresos de plataforma)</option>
              </select>
            </div>
            <div className="mt-4 space-y-1.5">
              <label htmlFor="adj-amount" className="block text-[15px] font-semibold">Importe (ARS)</label>
              <input id="adj-amount" name="amount" inputMode="decimal" required placeholder="12.500,50" className="block h-12 w-full rounded-xl border border-control px-3.5" />
            </div>
          </ConfirmAction>
        </Section>
      )}

      <Section title="Últimos movimientos" description="Los 200 asientos más recientes, agrupados por transacción.">
        {groups.length === 0 ? <p className="text-sm text-muted">Sin movimientos.</p> : (
          <DataTable caption="Registro financiero" minWidth={900}>
            <thead><tr><Th>Cuenta</Th><Th>Tipo</Th><Th>Importe</Th><Th>Trabajo</Th><Th>Motivo</Th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g.txn}>
                  <tr className="bg-cream/50">
                    <Td colSpan={5} className="py-2 text-xs text-muted">
                      Transacción <code className="font-mono">{g.txn.slice(0, 8)}</code> · {formatDateTime(g.rows[0].created_at)}
                      {g.rows[0].actor_name && ` · ${g.rows[0].actor_name}`}
                      {g.rows[0].is_test && <TestModeBadge className="ml-2" />}
                    </Td>
                  </tr>
                  {g.rows.map((e) => (
                    <tr key={e.id}>
                      <Td className="text-sm">{ACCOUNT_LABEL[e.account] ?? e.account}</Td>
                      <Td className="text-sm">{ENTRY_LABEL[e.entry_type] ?? e.entry_type}</Td>
                      <Td className={e.amount_minor < 0 ? "tabular text-ink-2" : "tabular font-semibold"}>{e.amount_minor < 0 ? "− " : ""}{formatMoney(Math.abs(e.amount_minor))}</Td>
                      <Td className="text-sm">{e.job_id ? <Link href={`/admin/trabajos/${e.job_id}`} className="text-fixy-800 hover:underline">{e.job_code}</Link> : "—"}</Td>
                      <Td className="text-sm text-ink-2">{e.reason}</Td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </div>
  );
}
