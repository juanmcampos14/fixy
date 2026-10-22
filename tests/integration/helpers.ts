import { sql, systemTx } from "@/server/db/client";
import { loadActor, type Actor } from "@/server/auth/actor";
import { demoEmail } from "@/server/seed/demo";
import { processPaymentWebhook } from "@/server/modules/payments";
import { buildMockWebhook, mockCompleteCheckout } from "@/server/payments/mock";
import * as quotes from "@/server/modules/quotes";

export async function actor(key: string): Promise<Actor> {
  const [u] = await sql()<{ id: string }[]>`select id from users where email = ${demoEmail(key)}`;
  return (await systemTx((tx) => loadActor(tx, u.id)))!;
}

export const id = async (q: string, params: unknown[] = []) => (await sql().unsafe(q, params as never[]))[0]?.id as string;
export const zoneId = (code: string) => id("select id from zones where code = $1", [code]);
export const catId = (slug: string) => id("select id from categories where slug = $1", [slug]);
export const providerId = (name: string) => id("select id from providers where display_name like $1", [`${name}%`]);
export const propertyOf = (userKey: string, label: string) =>
  id("select p.id from properties p join users u on u.id = p.owner_user_id where u.email = $1 and p.label = $2", [demoEmail(userKey), label]);
export const invitationFor = (requestId: string, pid: string) => id("select id from request_invitations where request_id = $1 and provider_id = $2", [requestId, pid]);

export async function payPending(jobId: string, outcome: "approved" | "rejected" = "approved") {
  const [c] = await sql()<{ external_reference: string }[]>`select external_reference from charges where job_id = ${jobId} and status = 'pending' order by created_at desc limit 1`;
  const paymentId = await systemTx((tx) => mockCompleteCheckout(tx, c.external_reference, outcome));
  const hook = buildMockWebhook(paymentId);
  const result = await processPaymentWebhook("mock", hook.rawBody, hook.headers);
  return { paymentId, result, hook };
}

export async function simpleQuote(a: Actor, invitationId: string, laborMinor = 3_000_000, validDays = 7) {
  return quotes.createQuote(a, {
    invitationId, mode: "quote", scope: "Reparación descripta por el cliente.", exclusions: "", materialsIncluded: false,
    proposedDate: "", proposedWindow: "", validDays, items: [{ kind: "labor", description: "Mano de obra", quantity: 1, unitPriceMinor: laborMinor }],
  });
}

export async function totalOf(quoteId: string) {
  const [q] = await sql()<{ total_minor: number }[]>`select total_minor from quotes where id = ${quoteId}`;
  return q.total_minor;
}

export const ledgerBalance = async () => (await sql()<{ s: number }[]>`select coalesce(sum(amount_minor),0)::bigint as s from ledger_entries`)[0].s;

export const visitCode = async (jobId: string) => (await sql()<{ visit_code: string }[]>`select visit_code from jobs where id = ${jobId}`)[0].visit_code;

/** Token del último enlace de confirmación de email encolado para el usuario. */
export async function lastVerifyToken(userId: string) {
  const [o] = await sql()<{ payload: { link: string } }[]>`
    select payload from outbox where recipient_user_id = ${userId} and payload->>'kind' = 'verify_email' order by created_at desc limit 1`;
  return o?.payload.link.split("/").pop() ?? null;
}

/** Confirma el email de una cuenta recién registrada, como si abriera el enlace del correo. */
export async function verifyEmailOf(userId: string) {
  const { confirmEmail } = await import("@/server/modules/email-verification");
  await confirmEmail((await lastVerifyToken(userId))!);
}
