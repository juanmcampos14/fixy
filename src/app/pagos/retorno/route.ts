/**
 * Vuelta desde Mercado Pago (back_urls). No confiamos en los parámetros del navegador: si viene un payment_id,
 * consultamos el pago a Mercado Pago (misma verificación que el webhook) y llevamos al cliente a su trabajo.
 */
import { NextResponse } from "next/server";
import { sql } from "@/server/db/client";
import { syncPaymentFromGateway } from "@/server/modules/payments";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ref = (url.searchParams.get("external_reference") ?? "").slice(0, 80);
  const paymentId = (url.searchParams.get("payment_id") ?? url.searchParams.get("collection_id") ?? "").replace(/\D/g, "").slice(0, 25);
  const [charge] = ref ? await sql()<{ job_id: string }[]>`select job_id from charges where external_reference = ${ref} and gateway = 'mercadopago'` : [];
  if (charge && paymentId) {
    await sql().begin((tx) => syncPaymentFromGateway(tx as never, "mercadopago", paymentId)).catch(() => {
      console.warn("[mercadopago] no se pudo verificar el pago a la vuelta; queda el webhook");
    });
  }
  const status = url.searchParams.get("status") ?? url.searchParams.get("collection_status") ?? "";
  const aviso = status === "rejected" || status === "null" ? "rechazado" : "procesado";
  return NextResponse.redirect(new URL(charge ? `/app/trabajos/${charge.job_id}?pago=${aviso}` : "/app", url.origin), 303);
}
