/**
 * Botón de arrepentimiento (Res. 424/2020 SCI): cualquier persona, con o sin sesión, puede pedir revocar una contratación.
 * Se registra con un código de seguimiento, se avisa al equipo y se responde por correo.
 */
import { z } from "zod";
import type { Db } from "@/server/db/client";
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { can } from "@/server/auth/permissions";
import { audit } from "@/server/audit";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { notify, staffRecipients } from "@/server/notifications";

export const revocationSchema = z.object({
  fullName: z.string().trim().min(2, "Ingresá tu nombre.").max(160),
  email: z.string().trim().toLowerCase().email("Ingresá un correo válido.").max(200),
  reference: z.string().trim().max(120).default(""),
  details: z.string().trim().max(2000).default(""),
});

export async function createRevocation(actor: Actor | null, input: z.input<typeof revocationSchema>) {
  const d = revocationSchema.parse(input);
  return systemTx(async (tx) => {
    const [r] = await tx<{ id: string; code: string }[]>`
      insert into revocation_requests (user_id, full_name, email, reference, details)
      values (${actor?.id ?? null}, ${d.fullName}, ${d.email}, ${d.reference || null}, ${d.details || null}) returning id, code`;
    await audit(tx, actor, "revocation.request", "revocation_request", r.id, null, { code: r.code });
    await notify(tx, await staffRecipients(tx), {
      type: "dispute", title: `Pedido de arrepentimiento ${r.code}`, body: `${d.fullName}${d.reference ? ` · ${d.reference}` : ""}. Respondé dentro de las 24 h.`, link: "/admin/arrepentimientos",
    });
    return r.code;
  });
}

export async function resolveRevocation(actor: Actor, id: string, resolution: string) {
  if (!can(actor, "arrepentimientos", "manage")) throw forbidden();
  if (resolution.trim().length < 5) throw invalid("Indicá cómo se resolvió.");
  return systemTx(async (tx) => {
    const [r] = await tx<{ status: string }[]>`select status from revocation_requests where id = ${id} for update`;
    if (!r) throw notFound();
    if (r.status !== "received") throw invalid("Ya está resuelto.");
    await tx`update revocation_requests set status = 'resolved', resolved_at = now(), resolved_by = ${actor.id}, resolution = ${resolution.trim()} where id = ${id}`;
    await audit(tx, actor, "revocation.resolve", "revocation_request", id, resolution);
  });
}

export async function listRevocations(db: Db) {
  return db<{ id: string; code: string; full_name: string; email: string; reference: string | null; details: string | null; status: string; created_at: Date; resolution: string | null; user_id: string | null }[]>`
    select id, code, full_name, email, reference, details, status, created_at, resolution, user_id from revocation_requests order by status, created_at desc limit 200`;
}
