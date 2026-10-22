import { requireSection } from "@/server/auth/session";
import { systemHealth } from "@/server/ops/health";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { ConfirmAction } from "@/components/ui/form";
import { DataTable, Section, Td, Th } from "@/components/admin/ui";
import { formatDateTime } from "@/lib/format";
import { replayOutboxAction, runTaskNowAction } from "../actions";

export const metadata = { title: "Salud del sistema" };
export const dynamic = "force-dynamic";

const CHANNEL: Record<string, string> = { email: "Email", whatsapp: "WhatsApp", push: "Celular" };
const ALERT: Record<string, string> = {
  outbox_backlog: "Avisos demorados", outbox_dead: "Avisos sin enviar", payment_incidents: "Diferencias de pagos",
};
const ago = (d: Date | null) => {
  if (!d) return "nunca";
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} d`;
};

export default async function HealthPage() {
  const { readOnly } = await requireSection("salud");
  const h = await systemHealth();
  return (
    <>
      <PageHeader eyebrow="Operación" title="Salud del sistema"
        description="Tareas programadas, avisos y alertas. Las alertas le llegan al equipo; la guía de cada una está en docs/operations-runbooks.md." />

      <Section className="mb-6" title="Alertas abiertas">
        {h.alerts.length === 0 ? <EmptyState title="Todo en orden" description="No hay alertas abiertas." /> : (
          <ul className="space-y-2">
            {h.alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
                <Badge tone={a.severity === "critical" ? "danger" : "warn"}>{a.severity === "critical" ? "Crítica" : "Atención"}</Badge>
                <span className="font-semibold">{ALERT[a.kind] ?? (a.kind.startsWith("cron_") ? `Tarea con fallas: ${a.kind.slice(5)}` : a.kind)}</span>
                <span className="text-sm text-muted">desde {formatDateTime(a.opened_at)} · {JSON.stringify(a.detail)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section className="mb-6" title="Tareas programadas">
        <DataTable caption="Tareas programadas" minWidth={860}>
          <thead><tr><Th>Tarea</Th><Th>Cada</Th><Th>Última corrida</Th><Th>Últimas 24 h</Th><Th>Depende de</Th>{!readOnly && <Th>Acción</Th>}</tr></thead>
          <tbody>
            {h.tasks.map((t) => (
              <tr key={t.key}>
                <Td className="font-semibold">{t.label}</Td>
                <Td>{t.everyMinutes} min</Td>
                <Td className="text-sm">
                  {t.last ? <><Badge tone={t.last.ok ? "ok" : t.last.ok === false ? "danger" : "info"}>{t.last.ok ? "Bien" : t.last.ok === false ? "Falló" : "En curso"}</Badge> <span className="text-muted">{ago(t.last.started_at)}{t.last.duration_ms != null ? ` · ${Math.round(t.last.duration_ms / 100) / 10} s` : ""}</span>
                    {t.last.error && <div className="mt-1 max-w-80 break-all text-xs text-danger">{t.last.error}</div>}</> : <span className="text-muted">Todavía no corrió</span>}
                </Td>
                <Td className="text-sm">{t.runs24h} corridas · {t.failures24h} fallas{t.p95 != null ? ` · p95 ${Math.round(t.p95 / 100) / 10} s` : ""}</Td>
                <Td className="text-sm text-muted">{t.external}</Td>
                {!readOnly && (
                  <Td><ConfirmAction action={runTaskNowAction} label="Ejecutar ahora" size="sm" variant="secondary" title={`Ejecutar «${t.label}»`}
                    description="Corre la tarea ahora (si ya está corriendo, no se duplica). Queda en la auditoría." confirmLabel="Ejecutar" hidden={{ task: t.key }} /></Td>
                )}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Section>

      <Section className="mb-6" title="Colas de avisos">
        <DataTable caption="Colas de avisos" minWidth={720}>
          <thead><tr><Th>Canal</Th><Th>Esperando</Th><Th>Enviándose</Th><Th>Reintentando</Th><Th>Más viejo</Th><Th>Enviados 24 h</Th><Th>Sin enviar 24 h</Th></tr></thead>
          <tbody>
            {h.queues.map((q) => (
              <tr key={q.channel}>
                <Td className="font-semibold">{CHANNEL[q.channel] ?? q.channel}</Td>
                <Td className="tabular">{q.waiting}</Td>
                <Td className="tabular">{q.processing}</Td>
                <Td className="tabular">{q.retrying}</Td>
                <Td className={q.oldest_min != null && q.oldest_min > 30 ? "text-warn" : ""}>{q.oldest_min != null ? `${q.oldest_min} min` : "—"}</Td>
                <Td className="tabular">{q.sent24h}</Td>
                <Td className={q.dead24h ? "tabular text-danger" : "tabular"}>{q.dead24h}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <p className="mt-3 text-sm text-muted">
          Último aviso de pago recibido: {ago(h.signals.last_payment_webhook)} · último WhatsApp recibido: {ago(h.signals.last_whatsapp_in)} ·
          conexiones a la base: {h.signals.connections} · tamaño de la base: {h.signals.db_size_mb} MB
        </p>
      </Section>

      <Section className="mb-6" title="Avisos que no se pudieron enviar (últimos 7 días)">
        {h.dead.length === 0 ? <EmptyState title="Ninguno" description="Todos los avisos se enviaron." /> : (
          <DataTable caption="Avisos sin enviar" minWidth={820}>
            <thead><tr><Th>Fecha</Th><Th>Canal</Th><Th>Para</Th><Th>Aviso</Th><Th>Error</Th>{!readOnly && <Th>Acción</Th>}</tr></thead>
            <tbody>
              {h.dead.map((d) => (
                <tr key={d.id}>
                  <Td className="text-sm">{formatDateTime(d.created_at)}</Td>
                  <Td>{CHANNEL[d.channel] ?? d.channel}</Td>
                  <Td>{d.who ?? "—"}</Td>
                  <Td className="max-w-60 text-sm">{d.what ?? "—"}</Td>
                  <Td className="max-w-72 text-xs text-muted break-all">{d.last_error ?? "—"} ({d.attempts} intentos)</Td>
                  {!readOnly && (
                    <Td><ConfirmAction action={replayOutboxAction} label="Reintentar" size="sm" variant="secondary" title="Reintentar el aviso"
                      description="Vuelve a la cola y sale en la próxima vuelta. Revisá antes que el motivo del error esté resuelto." confirmLabel="Reintentar" hidden={{ outboxId: d.id }} /></Td>
                  )}
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Section>
    </>
  );
}
