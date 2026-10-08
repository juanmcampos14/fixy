import { describe, expect, it, beforeAll } from "vitest";
import { asUser, sql, systemTx } from "@/server/db/client";
import type { Actor } from "@/server/auth/actor";
import * as requests from "@/server/modules/requests";
import * as quotes from "@/server/modules/quotes";
import * as jobs from "@/server/modules/jobs";
import * as providers from "@/server/modules/providers";
import { processPaymentWebhook, refundCharge, reconcile } from "@/server/modules/payments";
import { buildMockWebhook, mockCompleteCheckout } from "@/server/payments/mock";
import { actor, catId, invitationFor, payPending, propertyOf, providerId, simpleQuote, totalOf, ledgerBalance } from "./helpers";

let ana: Actor, bruno: Actor, lucia: Actor, roberto: Actor, martin: Actor, operador: Actor, admin: Actor, jorge: Actor, carla: Actor, diego: Actor;
let luciaPid: string, sinPid: string, anaCasa: string;

beforeAll(async () => {
  [ana, bruno, lucia, roberto, martin, operador, admin, jorge, carla, diego] = await Promise.all(
    ["ana", "bruno", "lucia", "roberto", "martin", "operador", "admin", "jorge", "carla", "diego"].map(actor),
  );
  luciaPid = await providerId("Plomería Sosa");
  sinPid = await providerId("Servicios Integrales Norte");
  anaCasa = await propertyOf("ana", "Casa");
});

/** Solicitud de plomería en Palermo: invita a Lucía y a Servicios Integrales Norte. */
async function plumbingRequest(title = "Pérdida en el baño") {
  return requests.createRequest(ana, {
    propertyId: anaCasa, categoryId: await catId("plomeria"), title, description: "Gotea la canilla del baño todo el día.",
    answers: {}, urgency: "normal", preferredWindows: [],
  });
}

describe("contratación", () => {
  it("la aceptación concurrente de presupuestos crea una única orden de trabajo", async () => {
    const reqId = await plumbingRequest("Concurrencia");
    const q1 = await simpleQuote(lucia, await invitationFor(reqId, luciaPid), 2_000_000);
    const q2 = await simpleQuote(roberto, await invitationFor(reqId, sinPid), 2_500_000);
    const results = await Promise.allSettled([
      quotes.acceptQuote(ana, q1, { totalMinor: await totalOf(q1), acceptedTerms: true }),
      quotes.acceptQuote(ana, q2, { totalMinor: await totalOf(q2), acceptedTerms: true }),
      quotes.acceptQuote(ana, q1, { totalMinor: await totalOf(q1), acceptedTerms: true }), // doble clic
    ]);
    const [{ n }] = await sql()<{ n: number }[]>`select count(*)::int as n from jobs where request_id = ${reqId}`;
    expect(n).toBe(1);
    const [{ c }] = await sql()<{ c: number }[]>`select count(*)::int as c from charges ch join jobs j on j.id = ch.job_id where j.request_id = ${reqId}`;
    expect(c).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    const [{ accepted }] = await sql()<{ accepted: number }[]>`select count(*)::int as accepted from quotes where request_id = ${reqId} and status = 'accepted'`;
    expect(accepted).toBe(1);
  });

  it("el doble clic sobre el mismo presupuesto es idempotente", async () => {
    const reqId = await plumbingRequest("Doble clic");
    const q = await simpleQuote(lucia, await invitationFor(reqId, luciaPid));
    const total = await totalOf(q);
    const a = await quotes.acceptQuote(ana, q, { totalMinor: total, acceptedTerms: true });
    const b = await quotes.acceptQuote(ana, q, { totalMinor: total, acceptedTerms: true });
    expect(b.jobId).toBe(a.jobId);
    expect(b.alreadyAccepted).toBe(true);
  });

  it("no acepta presupuestos vencidos ni retirados", async () => {
    const reqId = await plumbingRequest("Vencido");
    const q = await simpleQuote(lucia, await invitationFor(reqId, luciaPid));
    await systemTx(async (tx) => {
      await tx`alter table quotes disable trigger quotes_protect_sent`;
      await tx`update quotes set valid_until = now() - interval '1 hour' where id = ${q}`;
      await tx`alter table quotes enable trigger quotes_protect_sent`;
    });
    await expect(quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true })).rejects.toThrow(/venci/);
    const [s] = await sql()<{ status: string }[]>`select status from quotes where id = ${q}`;
    expect(s.status).toBe("expired");

    const q2 = await simpleQuote(roberto, await invitationFor(reqId, sinPid));
    await quotes.withdrawQuote(roberto, q2, "Error en el precio");
    await expect(quotes.acceptQuote(ana, q2, { totalMinor: await totalOf(q2), acceptedTerms: true })).rejects.toThrow(/disponible/);
  });

  it("detecta cambios de precio y protege importes contratados", async () => {
    const reqId = await plumbingRequest("Cambio de precio");
    const q = await simpleQuote(lucia, await invitationFor(reqId, luciaPid));
    const total = await totalOf(q);
    await expect(quotes.acceptQuote(ana, q, { totalMinor: total - 100, acceptedTerms: true })).rejects.toThrow(/total cambió/);
    await expect(sql()`update quotes set total_minor = total_minor + 1, subtotal_minor = subtotal_minor + 1, labor_minor = labor_minor + 1 where id = ${q}`).rejects.toThrow(/immutable_quote/);
    const r = await quotes.acceptQuote(ana, q, { totalMinor: total, acceptedTerms: true });
    await expect(sql()`update jobs set total_minor = 1 where id = ${r.jobId}`).rejects.toThrow(/immutable_contract/);
    await expect(sql()`update jobs set contract_snapshot = '{}'::jsonb where id = ${r.jobId}`).rejects.toThrow(/immutable_contract/);
  });

  it("no invita ni permite contratar a proveedores suspendidos", async () => {
    const reqId = await plumbingRequest("Suspensión");
    const q = await simpleQuote(lucia, await invitationFor(reqId, luciaPid));
    await providers.reviewProvider(operador, luciaPid, "suspend", "Prueba de suspensión");
    try {
      await expect(quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true })).rejects.toThrow(/habilitado/);
      const reqId2 = await plumbingRequest("Suspensión 2");
      const inv = await sql()`select 1 from request_invitations where request_id = ${reqId2} and provider_id = ${luciaPid}`;
      expect(inv).toHaveLength(0);
      await expect(sql()`insert into jobs (request_id, quote_id, provider_id, client_user_id, property_id, mode, contract_snapshot, total_minor, provider_net_minor)
        select request_id, id, provider_id, ${ana.id}, ${anaCasa}, mode, '{}'::jsonb, total_minor, provider_net_minor from quotes where id = ${q}`).rejects.toThrow(/provider_not_eligible/);
    } finally {
      await providers.reviewProvider(operador, luciaPid, "reinstate", "Fin de la prueba");
    }
  });

  it("rechaza transiciones inválidas en el servicio y en la base", async () => {
    const [job] = await sql()<{ id: string }[]>`select id from jobs where status = 'in_progress' limit 1`;
    await expect(jobs.approveJob(carla, job.id)).rejects.toThrow(/estado actual/);
    await expect(sql()`update jobs set status = 'completed' where id = ${job.id}`).rejects.toThrow(/invalid_transition/);
    await expect(sql()`update service_requests set status = 'draft' where status = 'converted'`).rejects.toThrow(/invalid_transition/);
  });

  it("los adicionales requieren aceptación explícita y se cobran aparte", async () => {
    const [job] = await sql()<{ id: string }[]>`select j.id from jobs j join job_extras e on e.job_id = j.id where e.status = 'proposed' limit 1`;
    const [extra] = await sql()<{ id: string; total_minor: number }[]>`select id, total_minor from job_extras where job_id = ${job.id} and status = 'proposed'`;
    const before = await sql()`select id from charges where job_id = ${job.id}`;
    // El técnico no puede proponer precios; el proveedor no puede aceptarse su propio adicional
    await expect(jobs.proposeExtra(jorge, job.id, { description: "Algo más", reason: "Porque sí", laborMinor: 100, materialsMinor: 0 })).rejects.toThrow(/permiso/);
    await expect(jobs.decideExtra(roberto, extra.id, "accepted", "", extra.total_minor)).rejects.toThrow(/permiso/);
    await expect(jobs.finishJob(jorge, job.id, "")).rejects.toThrow(/adicional pendiente/);
    expect((await sql()`select id from charges where job_id = ${job.id}`).length).toBe(before.length);
    // Un miembro sin ser responsable/creador no decide; la admin de la organización sí
    await expect(jobs.decideExtra(diego, extra.id, "accepted", "", extra.total_minor)).resolves.toBeTruthy(); // Diego es responsable de la solicitud
    const after = await sql()<{ kind: string; status: string; amount_minor: number }[]>`select kind, status, amount_minor from charges where extra_id = ${extra.id}`;
    expect(after).toEqual([{ kind: "extra", status: "pending", amount_minor: extra.total_minor }]);
    await jobs.finishJob(jorge, job.id, "Terminado");
    await expect(jobs.approveJob(carla, job.id)).rejects.toThrow(/pendiente de pago/);
    await payPending(job.id);
    await jobs.approveJob(carla, job.id);
    const [p] = await sql()<{ amount_minor: number }[]>`select amount_minor from payouts where job_id = ${job.id}`;
    const [{ nets }] = await sql()<{ nets: number }[]>`select sum(provider_net_minor)::bigint as nets from charges where job_id = ${job.id} and status = 'approved'`;
    expect(p.amount_minor).toBe(nets);
  });
});

describe("pagos", () => {
  it("procesa webhooks idempotentes, descarta duplicados, firmas inválidas y eventos fuera de orden", async () => {
    const reqId = await plumbingRequest("Webhooks");
    const q = await simpleQuote(lucia, await invitationFor(reqId, luciaPid));
    const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });

    // Firma inválida: no cambia nada
    const [c0] = await sql()<{ external_reference: string }[]>`select external_reference from charges where job_id = ${jobId}`;
    const paymentId = await systemTx((tx) => mockCompleteCheckout(tx, c0.external_reference, "approved"));
    const forged = buildMockWebhook(paymentId);
    forged.headers.set("x-mock-signature", "0".repeat(64));
    expect(await processPaymentWebhook("mock", forged.rawBody, forged.headers)).toBe("rejected");
    expect((await sql()<{ status: string }[]>`select status from charges where job_id = ${jobId}`)[0].status).toBe("pending");

    // Evento válido + duplicado
    const hook = buildMockWebhook(paymentId);
    expect(await processPaymentWebhook("mock", hook.rawBody, hook.headers)).toBe("applied");
    expect(await processPaymentWebhook("mock", hook.rawBody, hook.headers)).toBe("ignored_duplicate");
    const ledgerRows = await sql()`select id from ledger_entries where job_id = ${jobId}`;
    // Evento nuevo y tardío sobre un pago ya aplicado: sin efectos
    const late = buildMockWebhook(paymentId);
    expect(await processPaymentWebhook("mock", late.rawBody, late.headers)).toBe("ignored_stale");
    expect((await sql()`select id from ledger_entries where job_id = ${jobId}`).length).toBe(ledgerRows.length);
    // Fuera de orden: la pasarela informa "rechazado" después de "aprobado" → se ignora
    await sql()`update mock_gateway_payments set status = 'rejected' where id = ${paymentId}`;
    const ooo = buildMockWebhook(paymentId);
    expect(await processPaymentWebhook("mock", ooo.rawBody, ooo.headers)).toBe("ignored_stale");
    expect((await sql()<{ status: string }[]>`select status from charges where job_id = ${jobId}`)[0].status).toBe("approved");
    await sql()`update mock_gateway_payments set status = 'approved' where id = ${paymentId}`;
    expect(await ledgerBalance()).toBe(0);
  });

  it("rechaza pagos con monto distinto al cobro y permite reintentar pagos fallidos", async () => {
    const reqId = await plumbingRequest("Monto distinto");
    const q = await simpleQuote(lucia, await invitationFor(reqId, luciaPid));
    const { jobId } = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
    const [c] = await sql()<{ external_reference: string }[]>`select external_reference from charges where job_id = ${jobId}`;
    const pidPay = await systemTx((tx) => mockCompleteCheckout(tx, c.external_reference, "approved"));
    await sql()`update mock_gateway_payments set amount_minor = amount_minor - 1 where id = ${pidPay}`;
    const h = buildMockWebhook(pidPay);
    expect(await processPaymentWebhook("mock", h.rawBody, h.headers)).toBe("rejected");
    expect((await sql()<{ status: string }[]>`select status from charges where job_id = ${jobId}`)[0].status).toBe("pending");
    const diffs = await reconcile(sql());
    expect(diffs.some((d) => d.externalReference === c.external_reference && d.issue === "Monto distinto")).toBe(true);
  });

  it("los reembolsos se vinculan al cobro original, no superan lo cobrado y mantienen el registro balanceado", async () => {
    const [ch] = await sql()<{ id: string; amount_minor: number; job_id: string }[]>`select id, amount_minor, job_id from charges where status = 'approved' and kind = 'job_total' order by created_at limit 1`;
    await expect(refundCharge(ana, { chargeId: ch.id, amountMinor: 100, reason: "No autorizado" })).rejects.toThrow(/permiso/);
    await expect(refundCharge(admin, { chargeId: ch.id, amountMinor: ch.amount_minor + 1, reason: "Excede" })).rejects.toThrow(/máximo/);
    const refundId = await refundCharge(admin, { chargeId: ch.id, amountMinor: 50_000, reason: "Ajuste por demora" });
    const [r] = await sql()<{ charge_id: string }[]>`select charge_id from refunds where id = ${refundId}`;
    expect(r.charge_id).toBe(ch.id);
    const [after] = await sql()<{ status: string; refunded_minor: number }[]>`select status, refunded_minor from charges where id = ${ch.id}`;
    expect(after).toEqual({ status: "partially_refunded", refunded_minor: 50_000 });
    await expect(sql()`delete from ledger_entries where refund_id = ${refundId}`).rejects.toThrow(/immutable/);
    await expect(sql()`update charges set refunded_minor = 0 where id = ${ch.id}`).rejects.toThrow();
    expect(await ledgerBalance()).toBe(0);
  });

  it("diferencia cobro, trabajo y liquidación en los paneles", async () => {
    const rows = await sql()<{ code: string; job: string; charge: string; payout: string | null }[]>`
      select j.code, j.status as job, c.status as charge, p.status as payout from jobs j
      join charges c on c.job_id = j.id and c.kind in ('job_total','visit') left join payouts p on p.job_id = j.id`;
    expect(rows.some((r) => r.charge === "approved" && r.job !== "completed")).toBe(true);
    expect(rows.some((r) => r.job === "completed" && r.payout === "pending")).toBe(true);
    expect(rows.some((r) => r.job === "completed" && r.payout === "paid")).toBe(true);
  });
});

describe("aislamiento y permisos (RLS + servidor)", () => {
  it("un cliente no ve solicitudes, trabajos ni cobros ajenos", async () => {
    const mine = await asUser(bruno.id, (tx) => tx<{ created_by: string }[]>`select created_by from service_requests`);
    expect(mine.every((r) => r.created_by === bruno.id)).toBe(true);
    const otherJobs = await asUser(bruno.id, (tx) => tx`select id from jobs where client_user_id <> ${bruno.id}`);
    expect(otherJobs).toHaveLength(0);
    const charges = await asUser(bruno.id, (tx) => tx`select c.id from charges c join jobs j on j.id = c.job_id where j.client_user_id <> ${bruno.id}`);
    expect(charges).toHaveLength(0);
    expect(await asUser(bruno.id, (tx) => tx`select id from ledger_entries`)).toHaveLength(0);
  });

  it("las organizaciones están aisladas y sus miembros acceden según rol", async () => {
    expect(await asUser(ana.id, (tx) => tx`select id from organizations`)).toHaveLength(0);
    expect(await asUser(ana.id, (tx) => tx`select id from properties where organization_id is not null`)).toHaveLength(0);
    const carlaSees = await asUser(carla.id, (tx) => tx`select id from service_requests where organization_id is not null`);
    const diegoSees = await asUser(diego.id, (tx) => tx`select id from service_requests where organization_id is not null`);
    expect(carlaSees.length).toBeGreaterThan(diegoSees.length); // la admin ve todo; el miembro, lo propio o asignado
  });

  it("un proveedor solo ve solicitudes a las que fue invitado y sus propios presupuestos", async () => {
    const reqs = await asUser(martin.id, (tx) => tx<{ id: string }[]>`select id from service_requests`);
    for (const r of reqs) {
      const [{ ok }] = await sql()<{ ok: boolean }[]>`select exists (select 1 from request_invitations i join provider_members m on m.provider_id = i.provider_id where i.request_id = ${r.id} and m.user_id = ${martin.id}) as ok`;
      expect(ok).toBe(true);
    }
    const qs = await asUser(martin.id, (tx) => tx<{ provider_id: string }[]>`select provider_id from quotes`);
    const [{ id: martinPid }] = await sql()<{ id: string }[]>`select provider_id as id from provider_members where user_id = ${martin.id}`;
    expect(qs.every((q) => q.provider_id === martinPid)).toBe(true);
    // Ningún proveedor ve datos financieros de otro
    expect(await asUser(martin.id, (tx) => tx`select id from payouts where provider_id <> ${martinPid}`)).toHaveLength(0);
    // Ni el CUIT de otro proveedor
    expect(await asUser(martin.id, (tx) => tx`select tax_id from providers where id <> ${martinPid}`)).toHaveLength(0);
  });

  it("el técnico ve solo sus trabajos asignados y no ve cobros", async () => {
    const seen = await asUser(jorge.id, (tx) => tx<{ assigned_user_id: string }[]>`select assigned_user_id from jobs`);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((j) => j.assigned_user_id === jorge.id)).toBe(true);
    expect(await asUser(jorge.id, (tx) => tx`select id from charges`)).toHaveLength(0);
    expect(await asUser(jorge.id, (tx) => tx`select id from quotes`)).toHaveLength(0);
  });

  it("los documentos de proveedores son privados", async () => {
    expect(await asUser(ana.id, (tx) => tx`select id from provider_documents`)).toHaveLength(0);
    const files = await asUser(ana.id, (tx) => tx<{ purpose: string }[]>`select purpose from files where purpose = 'provider_document'`);
    expect(files).toHaveLength(0);
  });

  it("los permisos administrativos se validan en el servidor", async () => {
    await expect(providers.reviewProvider(ana, luciaPid, "suspend", "Intento indebido")).rejects.toThrow(/permiso/);
    await expect(requests.operatorInvite(ana, "00000000-0000-0000-0000-000000000000", luciaPid, "x x x")).rejects.toThrow(/permiso/);
    const [{ role }] = await sql()<{ role: string | null }[]>`select platform_role as role from users where id = ${ana.id}`;
    expect(role).toBeNull();
    // El rol de la app no puede escribir
    await expect(asUser(ana.id, (tx) => tx`update users set platform_role = 'admin' where id = ${ana.id}`)).rejects.toThrow();
  });

  it("no se puede crear una solicitud sobre una propiedad ajena", async () => {
    await expect(requests.createRequest(bruno, { propertyId: anaCasa, title: "Intrusión", description: "Intento de usar propiedad ajena", answers: {}, urgency: "normal", preferredWindows: [] })).rejects.toThrow(/permiso/);
  });
});
