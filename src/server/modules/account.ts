/**
 * Baja de cuenta autoservicio (Ley 25.326 de Protección de Datos, App Store 5.1.1(v) y Google Play).
 * La cuenta se anonimiza en el momento: se borran nombre, email, teléfonos, WhatsApp, direcciones, datos bancarios
 * y sesiones. Se conservan, sin identificar a la persona, los registros que exige la ley (pagos, registro financiero)
 * y las reseñas ya publicadas (que son anónimas). Si hay algo en curso (un trabajo, plata por cobrar o devolver),
 * primero hay que cerrarlo: la pantalla explica qué falta.
 */
import type { Db } from "@/server/db/client";
import { sql, systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import { invalid } from "@/server/domain/errors";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { cancelRequest } from "./requests";

export const DELETE_CONFIRMATION = "ELIMINAR";

/** Lo que impide dar de baja la cuenta ahora (vacío = se puede). */
export async function deletionBlockers(db: Db, actor: Actor): Promise<string[]> {
  const out: string[] = [];
  if (actor.platformRole) out.push(`Las cuentas del equipo de Fixy se dan de baja desde la operación. Escribinos a ${SUPPORT_EMAIL}.`);
  const [c] = await db<{ jobs: number; disputes: number }[]>`
    select
      (select count(*)::int from jobs j join service_requests r on r.id = j.request_id
        where (r.created_by = ${actor.id} or r.responsible_user_id = ${actor.id}) and j.status not in ('completed','cancelled')) as jobs,
      (select count(*)::int from disputes d where d.opened_by = ${actor.id} and d.status in ('open','in_review','awaiting_response')) as disputes`;
  if (c.jobs) out.push(`Tenés ${c.jobs === 1 ? "un trabajo en curso" : `${c.jobs} trabajos en curso`} como cliente: terminalo o cancelalo primero.`);
  if (c.disputes) out.push("Tenés un reclamo abierto: esperá a que se resuelva.");

  // Profesionales donde sos la única persona administradora: no puede quedar trabajo ni plata pendiente.
  const sole = await db<{ id: string; name: string; jobs: number; balance: number; withdrawals: number; owed: number }[]>`
    select p.id, p.display_name as name,
      (select count(*)::int from jobs j where j.provider_id = p.id and j.status not in ('completed','cancelled')) as jobs,
      (select coalesce(sum(amount_minor), 0)::bigint from payouts po where po.provider_id = p.id and po.status in ('pending','scheduled','processing','failed') and po.amount_minor > 0) as balance,
      (select count(*)::int from withdrawals w where w.provider_id = p.id and w.status = 'requested') as withdrawals,
      (select coalesce(sum(amount_minor), 0)::bigint from provider_recoveries rc where rc.provider_id = p.id and rc.status in ('open','applied')) as owed
    from providers p join provider_members m on m.provider_id = p.id and m.user_id = ${actor.id} and m.active and m.role = 'admin'
    where p.closed_at is null
      and not exists (select 1 from provider_members o where o.provider_id = p.id and o.user_id <> ${actor.id} and o.active and o.role = 'admin')`;
  for (const p of sole) {
    if (p.jobs) out.push(`${p.name}: tiene ${p.jobs === 1 ? "un trabajo en curso" : `${p.jobs} trabajos en curso`}. Terminalos o cancelalos primero.`);
    if (Number(p.balance) > 0 || p.withdrawals) out.push(`${p.name}: tiene saldo por cobrar o un retiro en camino. Cobralo primero o escribinos a ${SUPPORT_EMAIL}.`);
    if (Number(p.owed) > 0) out.push(`${p.name}: tiene un importe a devolver por reembolsos. Escribinos a ${SUPPORT_EMAIL}.`);
  }

  // Organizaciones con otras personas: tiene que quedar otra administradora.
  const orgs = await db<{ name: string }[]>`
    select o.name from organizations o join organization_members m on m.organization_id = o.id and m.user_id = ${actor.id} and m.role = 'admin'
    where exists (select 1 from organization_members x where x.organization_id = o.id and x.user_id <> ${actor.id})
      and not exists (select 1 from organization_members x where x.organization_id = o.id and x.user_id <> ${actor.id} and x.role = 'admin')`;
  for (const o of orgs) out.push(`${o.name}: nombrá a otra persona como administradora de la organización antes de irte.`);
  return out;
}

export async function deleteAccount(actor: Actor, confirmation: string): Promise<void> {
  if (confirmation.trim().toUpperCase() !== DELETE_CONFIRMATION) throw invalid(`Para confirmar, escribí ${DELETE_CONFIRMATION}.`);
  const blockers = await deletionBlockers(sql(), actor);
  if (blockers.length) throw invalid(blockers[0]);

  // Pedidos abiertos: se cancelan (avisa a los profesionales invitados) antes de anonimizar.
  const open = await sql()<{ id: string }[]>`
    select id from service_requests where (created_by = ${actor.id} or responsible_user_id = ${actor.id})
      and status in ('submitted','searching','with_quotes','no_coverage')`;
  for (const r of open) await cancelRequest(actor, r.id, "La persona dio de baja su cuenta").catch(() => null);

  await systemTx(async (tx) => {
    const [u] = await tx<{ whatsapp_phone: string | null }[]>`select whatsapp_phone from users where id = ${actor.id} for update`;

    // Direcciones propias: se borran los datos que ubican el lugar (los pedidos conservan solo zona y rubro).
    await tx`update properties set address_line = 'Dirección eliminada', address_extra = null, contact_name = null, contact_phone = null,
        access_notes = null, lat = null, lng = null, place_id = null, formatted_address = null, gated_name = null, gated_rules_url = null,
        gated_rules_text = null, gated_rules_file_id = null, gated_client_notes = null, archived_at = coalesce(archived_at, now())
      where owner_user_id = ${actor.id}`;
    await tx`update request_private set access_info = null where request_id in (select id from service_requests where created_by = ${actor.id})`;

    // Perfiles profesionales donde era la única administradora: se cierran y dejan de mostrarse.
    const closing = await tx<{ id: string; status: string }[]>`
      select p.id, p.status from providers p join provider_members m on m.provider_id = p.id and m.user_id = ${actor.id} and m.active and m.role = 'admin'
      where p.closed_at is null
        and not exists (select 1 from provider_members o where o.provider_id = p.id and o.user_id <> ${actor.id} and o.active and o.role = 'admin')
      for update of p`;
    for (const p of closing) {
      if (p.status !== "suspended") await tx`update providers set status = 'suspended' where id = ${p.id}`;
      await tx`update providers set closed_at = now(), accepting_jobs = false, social_links = '{}'::jsonb, contact_phone = null where id = ${p.id}`;
      await tx`delete from provider_bank_accounts where provider_id = ${p.id}`;
      await tx`delete from provider_portfolio where provider_id = ${p.id}`;
    }
    await tx`update provider_members set active = false where user_id = ${actor.id}`;
    await tx`delete from organization_members where user_id = ${actor.id}`;

    // Contacto y acceso: fuera.
    if (u?.whatsapp_phone) {
      await tx`delete from whatsapp_conversations where phone = ${u.whatsapp_phone}`;
      await tx`delete from whatsapp_messages where phone = ${u.whatsapp_phone}`;
      await tx`delete from whatsapp_links where phone = ${u.whatsapp_phone}`;
    }
    await tx`delete from whatsapp_link_codes where user_id = ${actor.id}`;
    await tx`delete from push_devices where user_id = ${actor.id}`;
    await tx`delete from notifications where user_id = ${actor.id}`;
    await tx`update outbox set status = 'dead', last_error = 'Cuenta eliminada' where recipient_user_id = ${actor.id} and status in ('pending','failed')`;
    await tx`delete from password_resets where user_id = ${actor.id}`;
    await tx`delete from sessions where user_id = ${actor.id}`;
    await tx`update users set full_name = 'Cuenta eliminada', email = ${`eliminada+${actor.id}@cuentas-eliminadas.fixy.solutions`},
        phone = null, password_hash = null, google_sub = null, whatsapp_phone = null, whatsapp_linked_at = null,
        wa_provider_alerts = false, wa_alerts_consent_at = null, disabled_at = now(), deleted_at = now()
      where id = ${actor.id}`;
    await audit(tx, null, "user.deleted", "user", actor.id, "Baja de cuenta pedida por la persona", { closedProviders: closing.length });
  });
}
