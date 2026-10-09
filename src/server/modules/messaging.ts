/** Mensajería dentro de la plataforma: conversación por solicitud + proveedor, que continúa en el trabajo. */
import { systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { forbidden, invalid, notFound } from "@/server/domain/errors";
import { notify } from "@/server/notifications";
import { storeFile } from "@/server/storage";
import { check } from "./authz";
import { can } from "@/server/auth/permissions";
import { maskContactInfo } from "@/server/domain/contact-guard";
import { audit } from "@/server/audit";

export async function sendMessage(actor: Actor, conversationId: string, body: string, file?: { data: Buffer; name: string }) {
  const text = body.trim();
  if (!text && !file) throw invalid("Escribí un mensaje.");
  if (text.length > 4000) throw invalid("El mensaje es demasiado largo.");
  return systemTx(async (tx) => {
    const [c] = await tx<{ id: string; request_id: string; provider_id: string; job_id: string | null }[]>`
      select id, request_id, provider_id, job_id from conversations where id = ${conversationId}`;
    if (!c) throw notFound();
    if (!(await check(tx, "can_see_conversation", actor, conversationId))) throw forbidden();
    const isClient = await check(tx, "is_request_client", actor, c.request_id);
    const [{ role }] = await tx<{ role: string | null }[]>`select app.provider_role(${actor.id}, ${c.provider_id}) as role`;
    const side = role ? "provider" : isClient ? "client" : "platform";
    // Escribir como Fixy (sin enmascarar datos) requiere gestionar la operación, no solo ver el panel.
    if (side === "platform" && !(["solicitudes", "trabajos", "reclamos"] as const).some((s) => can(actor, s, "manage"))) throw forbidden();
    // Antes de contratar, solo se conversa con proveedores invitados a una solicitud abierta.
    const [r] = await tx<{ status: string }[]>`select status from service_requests where id = ${c.request_id}`;
    if (!c.job_id && ["cancelled"].includes(r.status)) throw invalid("La solicitud fue cancelada.");
    const fileId = file
      ? await storeFile(tx, { data: file.data, originalName: file.name, uploadedBy: actor.id, purpose: "message_attachment", ownerType: "conversation", ownerId: conversationId })
      : null;
    // Coordinación y pagos dentro de Fixy: se ocultan teléfonos, emails, enlaces y datos para transferir por fuera.
    const guarded = side === "platform" ? { text, masked: false } : maskContactInfo(text);
    await tx`insert into messages (conversation_id, sender_id, sender_side, body, file_id) values (${conversationId}, ${actor.id}, ${side}, ${guarded.text || "(adjunto)"}, ${fileId})`;
    if (guarded.masked) {
      await tx`insert into messages (conversation_id, sender_id, sender_side, body) values (${conversationId}, null, 'system',
        'Ocultamos datos de contacto para cuidar a ambas partes. Coordiná, compartí la dirección y pagá dentro de Fixy: así todo queda registrado y podemos ayudarte si algo sale mal.')`;
      await audit(tx, actor, "message.contact_masked", "conversation", conversationId, null);
    }
    await tx`insert into conversation_reads (conversation_id, user_id, last_read_at) values (${conversationId}, ${actor.id}, now())
      on conflict (conversation_id, user_id) do update set last_read_at = now()`;
    // Notificar a la contraparte (sin email por cada mensaje, para no saturar).
    const recipients =
      side === "provider"
        ? await tx<{ id: string }[]>`select created_by as id from service_requests where id = ${c.request_id}
            union select responsible_user_id from service_requests where id = ${c.request_id} and responsible_user_id is not null`
        : await tx<{ id: string }[]>`select user_id as id from provider_members where provider_id = ${c.provider_id} and active and role = 'admin'
            union select assigned_user_id from jobs where id = ${c.job_id} and assigned_user_id is not null`;
    const link = side === "provider" ? (c.job_id ? `/app/trabajos/${c.job_id}` : `/app/solicitudes/${c.request_id}`) : c.job_id ? `/proveedor/trabajos/${c.job_id}` : `/proveedor/oportunidades`;
    await notify(tx, recipients.map((x) => x.id).filter((id) => id !== actor.id), { type: "message", title: "Tenés un mensaje nuevo", body: text.slice(0, 120), link, email: false });
  });
}

export async function markConversationRead(actor: Actor, conversationId: string) {
  return systemTx(async (tx) => {
    if (!(await check(tx, "can_see_conversation", actor, conversationId))) return;
    await tx`insert into conversation_reads (conversation_id, user_id, last_read_at) values (${conversationId}, ${actor.id}, now())
      on conflict (conversation_id, user_id) do update set last_read_at = now()`;
  });
}

export async function markNotificationsRead(actor: Actor, ids?: string[]) {
  return systemTx(async (tx) => {
    if (ids?.length) await tx`update notifications set read_at = now() where user_id = ${actor.id} and id in ${tx(ids)} and read_at is null`;
    else await tx`update notifications set read_at = now() where user_id = ${actor.id} and read_at is null`;
  });
}
