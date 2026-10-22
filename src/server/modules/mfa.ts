/**
 * Segundo factor del equipo: alta, verificación, códigos de respaldo y reinicio por el dueño de la cuenta.
 * Criptografía y TOTP en src/server/auth/mfa.ts. Todo queda en la auditoría, sin secretos ni códigos.
 */
import { systemTx, sql } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import { canAccessAdmin, isPlatformAdmin } from "@/server/auth/actor";
import { audit } from "@/server/audit";
import { DomainError, forbidden, invalid, notFound } from "@/server/domain/errors";
import { rateLimit } from "@/server/rate-limit";
import {
  decryptSecret, encryptSecret, matchTotp, mfaAvailable, newRecoveryCodes, newSecret, otpauthUri, remainingRecoveryCodes, useRecoveryCode,
} from "@/server/auth/mfa";

export type MfaStatus = { available: boolean; enabled: boolean; recoveryLeft: number };

export async function mfaStatus(actor: Actor): Promise<MfaStatus> {
  const [m] = await sql()<{ enabled: boolean }[]>`select enabled_at is not null as enabled from user_mfa where user_id = ${actor.id}`;
  return { available: mfaAvailable(), enabled: !!m?.enabled, recoveryLeft: m?.enabled ? await remainingRecoveryCodes(sql(), actor.id) : 0 };
}

/** Prepara el alta: genera un secreto nuevo (sin activar) y devuelve lo necesario para escanearlo. */
export async function startMfaEnrollment(actor: Actor) {
  if (!canAccessAdmin(actor)) throw forbidden("El segundo factor es para el equipo de Fixy.");
  if (!mfaAvailable()) throw new DomainError("forbidden", "El segundo factor todavía no está configurado en el servidor (falta MFA_ENCRYPTION_KEY).");
  const secret = await systemTx(async (tx) => {
    const [m] = await tx<{ enabled: boolean; secret_enc: string; fresh: boolean }[]>`
      select enabled_at is not null as enabled, secret_enc, created_at > now() - interval '15 minutes' as fresh from user_mfa where user_id = ${actor.id} for update`;
    if (m?.enabled) throw invalid("Ya tenés el segundo factor activado.");
    // Si recarga la página mientras escanea, se mantiene el mismo secreto (si no, el código escaneado dejaría de servir).
    if (m?.fresh) return decryptSecret(m.secret_enc);
    const s = newSecret();
    await tx`insert into user_mfa (user_id, secret_enc) values (${actor.id}, ${encryptSecret(s)})
      on conflict (user_id) do update set secret_enc = excluded.secret_enc, last_step = 0, created_at = now()`;
    return s;
  });
  return { secret, uri: otpauthUri(secret, actor.email) };
}

/** Confirma el alta con el primer código. Devuelve los códigos de respaldo (se muestran una sola vez). */
export async function confirmMfaEnrollment(actor: Actor, code: string): Promise<string[]> {
  await rateLimit(`mfa:${actor.id}`, 10, 600);
  return systemTx(async (tx) => {
    const [m] = await tx<{ secret_enc: string; enabled_at: Date | null }[]>`select secret_enc, enabled_at from user_mfa where user_id = ${actor.id} for update`;
    if (!m) throw invalid("Empezá de nuevo el alta del segundo factor.");
    if (m.enabled_at) throw invalid("Ya tenés el segundo factor activado.");
    const step = matchTotp(decryptSecret(m.secret_enc), code.trim());
    if (step === null) throw invalid("El código no coincide. Revisá que la hora del celular esté en automático y probá con el código nuevo.");
    const { plain, hashes } = newRecoveryCodes();
    await tx`update user_mfa set enabled_at = now(), last_step = ${step} where user_id = ${actor.id}`;
    await tx`delete from user_mfa_recovery_codes where user_id = ${actor.id}`;
    for (const h of hashes) await tx`insert into user_mfa_recovery_codes (user_id, code_hash) values (${actor.id}, ${h})`;
    await audit(tx, actor, "mfa.enabled", "user", actor.id, null);
    return plain;
  });
}

/**
 * Verifica un código (de la app o de respaldo). Un código de la app no se acepta dos veces. Con límite de intentos.
 * Devuelve si se usó un código de respaldo (para avisar cuántos quedan).
 */
export async function verifyMfaCode(actor: Actor, code: string): Promise<{ recovery: boolean }> {
  await rateLimit(`mfa:${actor.id}`, 10, 600);
  const clean = code.trim();
  return systemTx(async (tx) => {
    const [m] = await tx<{ secret_enc: string; enabled_at: Date | null; last_step: number }[]>`
      select secret_enc, enabled_at, last_step from user_mfa where user_id = ${actor.id} for update`;
    if (!m?.enabled_at) throw invalid("No tenés el segundo factor activado.");
    if (/^\d{6}$/.test(clean)) {
      const step = matchTotp(decryptSecret(m.secret_enc), clean);
      if (step === null || step <= Number(m.last_step)) {
        await audit(tx, actor, "mfa.failed", "user", actor.id, null);
        throw invalid("El código no es válido o ya se usó. Esperá el próximo.");
      }
      await tx`update user_mfa set last_step = ${step} where user_id = ${actor.id}`;
      await audit(tx, actor, "mfa.verified", "user", actor.id, null);
      return { recovery: false };
    }
    if (await useRecoveryCode(tx, actor.id, clean)) {
      await audit(tx, actor, "mfa.recovery_used", "user", actor.id, null);
      return { recovery: true };
    }
    await audit(tx, actor, "mfa.failed", "user", actor.id, null);
    throw invalid("El código no es válido.");
  });
}

/** Genera códigos de respaldo nuevos (anula los anteriores). Pide un código vigente. */
export async function regenerateRecoveryCodes(actor: Actor, code: string): Promise<string[]> {
  await verifyMfaCode(actor, code);
  return systemTx(async (tx) => {
    const { plain, hashes } = newRecoveryCodes();
    await tx`delete from user_mfa_recovery_codes where user_id = ${actor.id}`;
    for (const h of hashes) await tx`insert into user_mfa_recovery_codes (user_id, code_hash) values (${actor.id}, ${h})`;
    await audit(tx, actor, "mfa.recovery_regenerated", "user", actor.id, null);
    return plain;
  });
}

/**
 * El dueño de la cuenta reinicia el segundo factor de un miembro que perdió el celular y los códigos: se borra, se
 * cierran sus sesiones y al volver a entrar tiene que activarlo de nuevo. Con motivo y auditoría.
 */
export async function resetMemberMfa(actor: Actor, userId: string, reason: string) {
  if (!isPlatformAdmin(actor)) throw forbidden("Solo el dueño de la cuenta puede reiniciar el segundo factor.");
  if (reason.trim().length < 10) throw invalid("Contá el motivo (mínimo 10 caracteres).");
  if (userId === actor.id) throw invalid("No podés reiniciar tu propio segundo factor: usá un código de respaldo.");
  await systemTx(async (tx) => {
    const rows = await tx`delete from user_mfa where user_id = ${userId} returning user_id`;
    if (!rows.length) throw notFound("Ese usuario no tiene segundo factor.");
    await tx`delete from user_mfa_recovery_codes where user_id = ${userId}`;
    await tx`delete from sessions where user_id = ${userId}`;
    await audit(tx, actor, "mfa.reset", "user", userId, reason.trim());
  });
}
