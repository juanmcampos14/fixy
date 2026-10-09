import { requireSection } from "@/server/auth/session";
import { env } from "@/server/env";
import { listTemplates, whatsappConfigured } from "@/server/whatsapp/client";
import { WA_LANGUAGE, WA_TEMPLATES } from "@/server/whatsapp/templates";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { createWhatsAppTemplatesAction } from "../actions";

export const metadata = { title: "WhatsApp" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral" }> = {
  APPROVED: { label: "Aprobada", tone: "ok" },
  PENDING: { label: "En revisión", tone: "warn" },
  IN_APPEAL: { label: "En apelación", tone: "warn" },
  REJECTED: { label: "Rechazada", tone: "danger" },
  PAUSED: { label: "Pausada", tone: "warn" },
  DISABLED: { label: "Deshabilitada", tone: "danger" },
};

export default async function WhatsAppAdmin() {
  await requireSection("whatsapp");
  const e = env();
  const remote = await listTemplates().catch(() => null);
  const ours = Object.values(WA_TEMPLATES).map((t) => ({ ...t, remote: remote?.find((r) => r.name === t.name && r.language === WA_LANGUAGE) ?? null }));
  const missing = ours.filter((t) => !t.remote).length;
  return (
    <>
      <PageHeader eyebrow="Operación" title="WhatsApp" description="Estado del número y plantillas para avisar a los clientes fuera de la ventana de 24 horas." />
      <div className="space-y-5">
        {!whatsappConfigured() && <Alert tone="warn" title="WhatsApp sin configurar">Faltan WHATSAPP_ACCESS_TOKEN o WHATSAPP_PHONE_NUMBER_ID: los mensajes se registran sin enviarse.</Alert>}
        {!e.WHATSAPP_WABA_ID && <Alert tone="warn" title="Falta WHATSAPP_WABA_ID">Sin el identificador de la cuenta de WhatsApp Business no se pueden crear ni consultar plantillas.</Alert>}
        <Card>
          <CardHeader title="Plantillas" description="Meta las revisa (suele tardar minutos u horas). Mientras no estén aprobadas, los avisos se reintentan y solo llegan a quien nos escribió en las últimas 24 h." />
          {remote === null && whatsappConfigured() && e.WHATSAPP_WABA_ID && <p className="mb-3 text-sm text-warn">No se pudo consultar el estado en Meta. Revisá que el token tenga el permiso whatsapp_business_management.</p>}
          <ul className="divide-y divide-line">
            {ours.map((t) => {
              const st = t.remote ? STATUS[t.remote.status] ?? { label: t.remote.status, tone: "neutral" as const } : null;
              return (
                <li key={t.name} className="py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-sm font-semibold">{t.name}</p>
                    {st ? <Badge tone={st.tone}>{st.label}</Badge> : <Badge tone="neutral" icon={false}>Sin crear</Badge>}
                  </div>
                  <p className="mt-2 rounded-xl bg-cream px-3 py-2 text-[15px]">{t.body}</p>
                  <p className="mt-1 text-sm text-muted">Botón: «{t.button}» → abre el pedido en Fixy.</p>
                  {t.remote?.rejected_reason && t.remote.rejected_reason !== "NONE" && <p className="mt-1 text-sm text-danger">Motivo del rechazo: {t.remote.rejected_reason}</p>}
                </li>
              );
            })}
          </ul>
          {missing > 0 && (
            <ActionForm action={createWhatsAppTemplatesAction} className="mt-4">
              <SubmitButton pendingText="Enviando a Meta…">Crear {missing === 1 ? "la plantilla faltante" : `las ${missing} plantillas faltantes`}</SubmitButton>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
