/**
 * Estados de entrega que Meta informa por webhook (sent, delivered, read, failed) para los mensajes salientes.
 * Meta acepta un mensaje y recién después avisa si no se pudo entregar: sin esto, un envío fallido figura como enviado.
 */
import { sql } from "@/server/db/client";

export type DeliveryStatus = { id: string; status: string; error: string | null };

export function parseStatuses(body: unknown): DeliveryStatus[] {
  const out: DeliveryStatus[] = [];
  const entries = (body as { entry?: { changes?: { value?: Record<string, unknown> }[] }[] })?.entry ?? [];
  for (const e of entries) {
    for (const c of e.changes ?? []) {
      const list = (c.value as { statuses?: Record<string, unknown>[] } | undefined)?.statuses ?? [];
      for (const s of list) {
        if (typeof s.id !== "string" || typeof s.status !== "string") continue;
        const err = (s.errors as { code?: number; title?: string; message?: string; error_data?: { details?: string } }[] | undefined)?.[0];
        out.push({
          id: s.id, status: s.status.slice(0, 20),
          error: err ? `Meta ${err.code ?? "?"}: ${err.error_data?.details || err.message || err.title || "sin detalle"}`.slice(0, 300) : null,
        });
      }
    }
  }
  return out;
}

/** Guarda el estado en whatsapp_messages y, si falló una invitación de captación, el motivo en la campaña. */
export async function recordStatuses(list: DeliveryStatus[]) {
  for (const s of list) {
    // "read" y "delivered" no deben pisar a un estado posterior ni a "failed".
    await sql()`update whatsapp_messages set status = ${s.status}
      where wa_message_id = ${s.id} and direction = 'out' and coalesce(status, '') <> 'failed'
        and not (coalesce(status, '') = 'read' and ${s.status} in ('sent', 'delivered'))
        and not (coalesce(status, '') = 'delivered' and ${s.status} = 'sent')`;
    if (s.status === "failed") {
      await sql()`update supply_campaign_leads set last_error = ${s.error ?? "Meta: no se pudo entregar"} where last_message_id = ${s.id}`;
    }
  }
}
