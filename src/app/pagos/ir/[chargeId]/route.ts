/**
 * "Ir a pagar": prepara el checkout en la pasarela si todavía no existe (fuera de cualquier transacción, con la clave
 * idempotente del cobro) y redirige. Si la pasarela no responde, vuelve al trabajo con un aviso y se reintenta solo.
 */
import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import { drainPaymentCommands } from "@/server/modules/payments";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ chargeId: string }> }) {
  const { chargeId } = await params;
  const origin = new URL(req.url).origin;
  const actor = await getActor();
  if (!actor) return NextResponse.redirect(new URL(`/ingresar?next=${encodeURIComponent(`/pagos/ir/${chargeId}`)}`, origin), 303);
  if (!/^[0-9a-f-]{36}$/.test(chargeId)) return NextResponse.redirect(new URL("/app", origin), 303);
  const load = async () => {
    const [c] = await sql()<{ job_id: string; status: string; checkout_url: string | null; ok: boolean }[]>`
      select job_id, status, checkout_url, app.is_job_client(${actor.id}, job_id) as ok from charges where id = ${chargeId}`;
    return c;
  };
  let c = await load();
  if (!c?.ok) return NextResponse.redirect(new URL("/app", origin), 303);
  const back = (aviso?: string) => NextResponse.redirect(new URL(`/app/trabajos/${c.job_id}${aviso ? `?pago=${aviso}` : ""}`, origin), 303);
  if (c.status !== "pending") return back();
  if (!c.checkout_url) {
    await drainPaymentCommands({ chargeId });
    c = await load();
  }
  if (!c.checkout_url) return back("preparando");
  return NextResponse.redirect(new URL(c.checkout_url, origin), 303);
}
