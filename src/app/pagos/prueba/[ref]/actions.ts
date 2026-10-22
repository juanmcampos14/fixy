"use server";

import { redirect } from "next/navigation";
import { act, str } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { requireActor } from "@/server/auth/session";
import { sql, systemTx } from "@/server/db/client";
import { paymentsAreTestMode } from "@/server/env";
import { payLink, processPaymentWebhook, retryCharge } from "@/server/modules/payments";
import { buildMockWebhook, mockCompleteCheckout } from "@/server/payments/mock";
import { DomainError, forbidden } from "@/server/domain/errors";

/**
 * Simula la acción del comprador en la pasarela de prueba. La aprobación NO se aplica desde acá:
 * la pasarela simulada emite un webhook firmado y el cobro se confirma por la misma vía que en producción.
 */
export async function simulateCheckoutAction(_: ActionState, f: FormData): Promise<ActionState> {
  let jobId = "";
  const r = await act(async () => {
    if (!paymentsAreTestMode()) throw new DomainError("forbidden", "La simulación de pagos solo existe en modo de prueba.");
    const actor = await requireActor();
    const ref = str(f, "ref");
    const outcome = str(f, "outcome") === "rejected" ? "rejected" : "approved";
    const [c] = await sql()<{ job_id: string; status: string; ok: boolean }[]>`
      select job_id, status, app.is_job_client(${actor.id}, job_id) as ok from charges where external_reference = ${ref}`;
    if (!c?.ok) throw forbidden();
    jobId = c.job_id;
    if (c.status !== "pending") return;
    const paymentId = await systemTx((tx) => mockCompleteCheckout(tx, ref, outcome));
    const hook = buildMockWebhook(paymentId);
    await processPaymentWebhook("mock", hook.rawBody, hook.headers);
  });
  if (r.error) return r;
  redirect(`/app/trabajos/${jobId}?pago=${str(f, "outcome") === "rejected" ? "rechazado" : "procesado"}`);
}

export async function retryChargeAction(_: ActionState, f: FormData): Promise<ActionState> {
  let url = "";
  const r = await act(async () => {
    const actor = await requireActor();
    const c = await retryCharge(actor, str(f, "chargeId"));
    url = payLink(c.id);
  });
  if (r.error) return r;
  redirect(url);
}
