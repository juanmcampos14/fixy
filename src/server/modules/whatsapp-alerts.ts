/**
 * Avisos por WhatsApp para profesionales (pedidos nuevos, te eligieron, te contrataron).
 * - Consentimiento explícito: se activan desde el panel; para vincular el número, el profesional manda
 *   desde su WhatsApp un código de un solo uso (así probamos que el número es suyo).
 * - Baja en cualquier momento: escribiendo BAJA al bot o desde el panel.
 */
import { createHash, randomInt } from "node:crypto";
import { sql, systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import { invalid } from "@/server/domain/errors";
import { rateLimit } from "@/server/rate-limit";

const hash = (code: string) => createHash("sha256").update(`wa-alerts:${code}`).digest("hex");

export async function alertsState(userId: string) {
  const [u] = await sql()<{ whatsapp_phone: string | null; wa_provider_alerts: boolean }[]>`
    select whatsapp_phone, wa_provider_alerts from users where id = ${userId}`;
  return { linked: !!u?.whatsapp_phone, phoneTail: u?.whatsapp_phone?.slice(-4) ?? null, on: !!u?.wa_provider_alerts && !!u?.whatsapp_phone };
}

/** Código de 6 dígitos (30 minutos, un solo uso) para mandar desde WhatsApp. */
export async function createAlertsCode(actor: Actor): Promise<string> {
  await rateLimit(`wa-alerts-code:${actor.id}`, 5, 3600);
  const code = String(randomInt(100000, 1000000));
  await sql()`insert into whatsapp_link_codes (code_hash, user_id, expires_at) values (${hash(code)}, ${actor.id}, now() + interval '30 minutes')`;
  return code;
}

/** Activa o desactiva desde el panel (activar requiere el WhatsApp ya vinculado). */
export async function setProviderAlerts(actor: Actor, on: boolean) {
  await systemTx(async (tx) => {
    const [u] = await tx<{ whatsapp_phone: string | null }[]>`select whatsapp_phone from users where id = ${actor.id} for update`;
    if (on && !u?.whatsapp_phone) throw invalid("Primero vinculá tu WhatsApp.");
    await tx`update users set wa_provider_alerts = ${on}, wa_alerts_consent_at = ${on ? new Date() : null} where id = ${actor.id}`;
    await audit(tx, actor, on ? "whatsapp.alerts_on" : "whatsapp.alerts_off", "user", actor.id, null);
  });
}

/** El bot recibió un código desde un teléfono: vincula ese número a la cuenta que lo pidió y activa los avisos. */
export async function consumeAlertsCode(phone: string, code: string): Promise<{ ok: true; firstName: string } | { ok: false; error: string }> {
  return systemTx(async (tx) => {
    const [c] = await tx<{ code_hash: string; user_id: string }[]>`
      select code_hash, user_id from whatsapp_link_codes where code_hash = ${hash(code)} and used_at is null and expires_at > now() for update`;
    if (!c) return { ok: false, error: "Ese código venció o no es válido. Pedí uno nuevo desde tu panel de Fixy (Inicio → Avisos por WhatsApp)." };
    const [other] = await tx<{ id: string }[]>`select id from users where whatsapp_phone = ${phone} and id <> ${c.user_id}`;
    if (other) return { ok: false, error: "Este WhatsApp ya está vinculado a otra cuenta de Fixy. Escribinos a hola@fixy.solutions si necesitás cambiarlo." };
    const [u] = await tx<{ full_name: string }[]>`
      update users set whatsapp_phone = ${phone}, whatsapp_linked_at = coalesce(whatsapp_linked_at, now()), wa_provider_alerts = true, wa_alerts_consent_at = now()
      where id = ${c.user_id} and disabled_at is null returning full_name`;
    if (!u) return { ok: false, error: "No pudimos vincular la cuenta." };
    await tx`update whatsapp_link_codes set used_at = now() where code_hash = ${c.code_hash}`;
    await audit(tx, null, "whatsapp.alerts_linked", "user", c.user_id, null, { phoneTail: phone.slice(-4) });
    return { ok: true, firstName: u.full_name.split(" ")[0] };
  });
}

/** Baja o alta pedida por el bot (el número ya está vinculado). */
export async function setAlertsByPhone(phone: string, on: boolean): Promise<boolean> {
  const rows = await sql()`update users set wa_provider_alerts = ${on}, wa_alerts_consent_at = ${on ? new Date() : null}
    where whatsapp_phone = ${phone} and exists (select 1 from provider_members m where m.user_id = users.id and m.active) returning id`;
  return rows.length > 0;
}
