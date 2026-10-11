/**
 * Cuentas para la revisión de App Store y Google Play.
 * Apple y Google exigen un usuario de prueba para recorrer la app. Se crean un cliente y un profesional "de cajón de arena":
 * solo se cruzan entre sí (ver `sandbox` en el emparejamiento), no reciben correos y no cuentan en las métricas.
 */
import { randomBytes } from "node:crypto";
import type { Actor } from "@/server/auth/actor";
import { isPlatformAdmin, loadActor } from "@/server/auth/actor";
import { hashPassword } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { sql, systemTx } from "@/server/db/client";
import { forbidden } from "@/server/domain/errors";
import { activeGateway } from "@/server/payments";
import { createProperty } from "./properties";
import { acceptProviderTerms, createProvider, updateCoverage } from "./providers";
import { registerUser } from "./users";

export const REVIEW_CLIENT_EMAIL = "revision.cliente@fixy.solutions";
export const REVIEW_PROVIDER_EMAIL = "revision.profesional@fixy.solutions";

async function ensureUser(email: string, fullName: string, password: string) {
  const [existing] = await sql()<{ id: string }[]>`select id from users where lower(email) = ${email}`;
  const id = existing?.id ?? (await registerUser({ fullName, email, password, acceptTerms: true, phone: "11 5555-0100" }, { isDemo: true }));
  // Contraseña nueva en cada generación: las sesiones anteriores dejan de servir.
  await sql()`update users set password_hash = ${await hashPassword(password)}, is_demo = true, sandbox = true, disabled_at = null where id = ${id}`;
  await sql()`delete from sessions where user_id = ${id}`;
  return id;
}

/** Crea las dos cuentas (o les renueva la contraseña) y devuelve las credenciales para cargarlas en las tiendas. Solo el dueño. */
export async function ensureReviewAccounts(actor: Actor) {
  if (!isPlatformAdmin(actor)) throw forbidden("Solo el dueño de la plataforma puede generar las cuentas de revisión.");
  const password = randomBytes(12).toString("base64url");
  const clientId = await ensureUser(REVIEW_CLIENT_EMAIL, "Revisión Cliente (demo)", password);
  const providerUserId = await ensureUser(REVIEW_PROVIDER_EMAIL, "Revisión Profesional (demo)", password);
  const load = async (id: string) => (await systemTx((tx) => loadActor(tx, id)))!;

  const zones = await sql()<{ id: string; code: string }[]>`select id, code from zones where active and code <> 'otra-zona' order by sort`;
  const home = zones.find((z) => z.code === "caba-palermo") ?? zones[0];

  const [hasProperty] = await sql()`select 1 from properties where owner_user_id = ${clientId} limit 1`;
  if (!hasProperty) {
    await createProperty(await load(clientId), { kind: "home", label: "Casa", addressLine: "Av. de Prueba 1234, 3° B", zoneId: home.id, contactName: "Revisión", contactPhone: "11 5555-0100", accessNotes: "Timbre 3B." });
  }

  let [provider] = await sql()<{ id: string }[]>`
    select p.id from providers p join provider_members m on m.provider_id = p.id where m.user_id = ${providerUserId} limit 1`;
  if (!provider) {
    const id = await createProvider(await load(providerUserId), {
      kind: "individual", displayName: "Servicios de Prueba Fixy (demo)", responsibleName: "Revisión Profesional", contactEmail: REVIEW_PROVIDER_EMAIL, contactPhone: "11 5555-0101",
      description: "Perfil de demostración para la revisión de la app. Atiende todos los rubros y zonas, y no corresponde a un profesional real.", yearsExperience: 10,
    });
    provider = { id };
  }
  const categories = await sql()<{ id: string }[]>`select id from categories where active`;
  const me = await load(providerUserId);
  await updateCoverage(me, provider.id, {
    categoryIds: categories.map((c) => c.id), zoneIds: zones.map((z) => z.id), baseZoneId: home.id, acceptingJobs: true, maxActiveJobs: 50,
    availability: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 8 * 60, endMinute: 20 * 60 })),
  });
  await acceptProviderTerms(me);
  await systemTx(async (tx) => {
    // La máquina de estados no deja saltar de «pendiente» a «aprobado».
    await tx`update providers set status = 'in_review', submitted_at = coalesce(submitted_at, now()) where id = ${provider.id} and status = 'pending'`;
    await tx`update providers set is_demo = true, sandbox = true, status = 'approved', identity_status = 'verified', approved_at = coalesce(approved_at, now()),
      payouts_status = 'enabled', payout_provider = coalesce(payout_provider, ${activeGateway().name}), payout_account_ref = coalesce(payout_account_ref, ${`sandbox-${provider.id}`})
      where id = ${provider.id}`;
    await audit(tx, actor, "review_accounts.generated", "user", clientId, "Cuentas para la revisión de las tiendas", { providerId: provider.id });
  });
  return { clientEmail: REVIEW_CLIENT_EMAIL, providerEmail: REVIEW_PROVIDER_EMAIL, password };
}
