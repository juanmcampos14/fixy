import { notFound } from "next/navigation";
import Link from "next/link";
import { CreditCard, TriangleAlert, Lock } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import { paymentsAreTestMode } from "@/server/env";
import { chargeKindLabel } from "@/server/domain/labels";
import { Logo } from "@/components/brand/logo";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";
import { formatMoney } from "@/lib/format";
import { simulateCheckoutAction } from "./actions";

export const metadata = { title: "Pago en modo de prueba" };

export default async function MockCheckout({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const actor = await requireActor(`/pagos/prueba/${ref}`);
  if (!paymentsAreTestMode()) notFound();
  const [c] = await sql()<{ amount_minor: number; status: string; kind: string; job_id: string; code: string; title: string; ok: boolean }[]>`
    select c.amount_minor, c.status, c.kind, c.job_id, j.code, r.title, app.is_job_client(${actor.id}, c.job_id) as ok
    from charges c join jobs j on j.id = c.job_id join service_requests r on r.id = j.request_id where c.external_reference = ${decodeURIComponent(ref)}`;
  if (!c || !c.ok) notFound();
  return (
    <div className="min-h-dvh bg-[repeating-linear-gradient(135deg,#fff9f1_0_22px,#fdf1e2_22px_44px)]">
      <main id="contenido" className="mx-auto max-w-md px-4 py-10">
        <div className="rounded-[28px] bg-surface p-6 shadow-[var(--shadow-lift)] ring-1 ring-line">
          <div className="flex items-center justify-between">
            <Logo size="sm" />
            <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-3 py-1 text-xs font-bold text-warn"><TriangleAlert className="h-3.5 w-3.5" aria-hidden />MODO DE PRUEBA</span>
          </div>
          <h1 className="mt-6 text-2xl font-extrabold">Pasarela de pagos simulada</h1>
          <Alert tone="warn" className="mt-4" title="No se procesa dinero real">
            Esta pantalla reemplaza a la pasarela mientras no haya credenciales reales. No ingreses datos de tarjetas: no se piden ni se guardan.
          </Alert>
          <dl className="tabular mt-5 divide-y divide-line text-[15px]">
            <div className="flex justify-between py-2"><dt className="text-muted">Trabajo</dt><dd className="font-medium">{c.code}</dd></div>
            <div className="flex justify-between gap-4 py-2"><dt className="text-muted">Concepto</dt><dd className="text-right font-medium">{chargeKindLabel[c.kind]} · {c.title}</dd></div>
            <div className="flex justify-between py-3 text-xl font-bold"><dt>Total a pagar</dt><dd>{formatMoney(c.amount_minor)}</dd></div>
          </dl>
          {c.status !== "pending" ? (
            <Alert tone="info" className="mt-4">Este pago ya fue procesado. <Link href={`/app/trabajos/${c.job_id}`}>Volver al trabajo</Link></Alert>
          ) : (
            <ActionForm action={simulateCheckoutAction} className="mt-5 space-y-2">
              <input type="hidden" name="ref" value={decodeURIComponent(ref)} />
              <SubmitButton name="outcome" value="approved" size="lg" className="w-full" pendingText="Procesando pago de prueba…">
                <CreditCard className="h-5 w-5" aria-hidden /> Simular pago aprobado
              </SubmitButton>
              <SubmitButton name="outcome" value="rejected" variant="secondary" className="w-full">Simular pago rechazado</SubmitButton>
            </ActionForm>
          )}
          <p className="mt-5 flex items-start gap-2 text-xs text-muted">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            La confirmación llega a Fixy mediante un aviso firmado de la pasarela (webhook) y se verifica consultando el pago; no depende de esta página.
          </p>
        </div>
      </main>
    </div>
  );
}
