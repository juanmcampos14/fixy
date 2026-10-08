/**
 * Recorrido principal completo:
 * Profesional se registra → operador lo aprueba → cliente describe un problema → proveedor recibe la oportunidad y cotiza →
 * cliente acepta y paga en modo de prueba → proveedor ejecuta → cliente confirma → liquidación simulada → cliente califica.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { asUser, sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { registerUser } from "@/server/modules/users";
import * as providers from "@/server/modules/providers";
import * as props from "@/server/modules/properties";
import * as requests from "@/server/modules/requests";
import * as quotes from "@/server/modules/quotes";
import * as jobs from "@/server/modules/jobs";
import * as disputes from "@/server/modules/disputes";
import { executePayout } from "@/server/modules/payments";
import { actor, catId, invitationFor, payPending, zoneId, ledgerBalance, visitCode } from "./helpers";

const pdf = { data: readFileSync("db/seed-assets/documento-demo.pdf"), name: "dni.pdf" };
const jpg = { data: readFileSync("db/seed-assets/demo-1.jpg"), name: "foto.jpg" };

describe("recorrido principal de punta a punta", () => {
  it("completa el ciclo con persistencia, permisos y registros consistentes", async () => {
    // 1. Registro abierto del profesional
    const uid = await registerUser({ fullName: "Nora Test", email: `nora.${Date.now()}@test.local`, password: "password-123", acceptTerms: true });
    const nora = (await systemTx((tx) => loadActor(tx, uid)))!;
    expect(nora.platformRole).toBeNull();
    const pid = await providers.createProvider(nora, {
      kind: "individual", displayName: "Pinturas Nora", responsibleName: "Nora Test", contactEmail: "nora@test.local", contactPhone: "11 4444-4444",
      description: "Pintora con experiencia en interiores y exteriores, prolija y puntual.", yearsExperience: 5,
    });
    const me = (await systemTx((tx) => loadActor(tx, uid)))!;
    await providers.updateCoverage(me, pid, {
      categoryIds: [await catId("pintura")], zoneIds: [await zoneId("caba-urquiza")], baseZoneId: await zoneId("caba-urquiza"),
      acceptingJobs: true, maxActiveJobs: 3, availability: [{ weekday: 1, startMinute: 480, endMinute: 1080 }],
    });
    // No puede enviar a revisión con datos faltantes
    await expect(providers.submitForReview(me, pid)).rejects.toThrow(/documento de identidad/);
    await providers.uploadProviderDocument(me, pid, { kind: "identity" }, pdf);
    await providers.setupPayouts(me, pid);
    await providers.acceptProviderTerms(me);
    await providers.submitForReview(me, pid);

    // Antes de ser aprobado no recibe oportunidades
    const operador = await actor("operador");
    await expect(providers.reviewProvider(me, pid, "approve", "autoaprobación")).rejects.toThrow(/permiso/);
    await expect(providers.reviewProvider(operador, pid, "approve", "Sin verificar identidad")).rejects.toThrow(/identidad/);
    // 2. Operador revisa documento y aprueba
    const [doc] = await sql()<{ id: string }[]>`select id from provider_documents where provider_id = ${pid}`;
    await providers.reviewDocument(operador, doc.id, "approved", "Legible");
    await providers.reviewProvider(operador, pid, "approve", "Perfil completo");

    // 3. Cliente describe el problema
    const cliente = await actor("bruno");
    const propId = await props.createProperty(cliente, { kind: "home", label: `Depto ${Date.now()}`, addressLine: "Calle Prueba 123", zoneId: await zoneId("caba-urquiza"), accessNotes: "Código 1234" });
    const reqId = await requests.createRequest(cliente, {
      propertyId: propId, title: "Pintar el living", description: "Quiero pintar el living de unos 20 m², paredes y techo.",
      answers: { superficie: "20 m²" }, urgency: "normal", preferredWindows: ["morning"], accessInfo: "Código 1234",
    }, [jpg]);
    const [req] = await sql()<{ status: string; category_id: string }[]>`select status, category_id from service_requests where id = ${reqId}`;
    expect(req.category_id).toBe(await catId("pintura")); // categoría sugerida por el asistente
    expect(req.status).toBe("searching");

    // 4. El proveedor recibe la oportunidad (sin ver la dirección exacta ni el acceso)
    const invId = await invitationFor(reqId, pid);
    expect(invId).toBeTruthy();
    const visibleToProvider = await asUser(uid, (tx) => tx`select id from service_requests where id = ${reqId}`);
    expect(visibleToProvider).toHaveLength(1);
    const props2 = await asUser(uid, (tx) => tx`select id from properties where id = ${propId}`);
    expect(props2).toHaveLength(0); // la propiedad (dirección) no es visible antes de contratar

    const quoteId = await quotes.createQuote(me, {
      invitationId: invId, mode: "quote", scope: "Pintura de paredes y techo del living con látex interior, dos manos.", exclusions: "No incluye reparación de grietas.",
      materialsIncluded: true, proposedDate: "2026-12-01", proposedWindow: "Mañana", validDays: 7,
      items: [
        { kind: "labor", description: "Mano de obra", quantity: 1, unitPriceMinor: 12_000_000 },
        { kind: "materials", description: "Látex 20 L", quantity: 1, unitPriceMinor: 6_000_000 },
      ],
    });
    const [q] = await sql()<{ total_minor: number; provider_net_minor: number; client_fee_minor: number; provider_fee_minor: number }[]>`select * from quotes where id = ${quoteId}`;
    expect(q.client_fee_minor).toBe(900_000); // 5 % cliente
    expect(q.provider_fee_minor).toBe(1_800_000); // 10 % proveedor
    expect(q.total_minor).toBe(18_900_000);
    expect(q.provider_net_minor).toBe(16_200_000);

    // 5. Cliente acepta y paga en modo de prueba
    const accepted = await quotes.acceptQuote(cliente, quoteId, { totalMinor: q.total_minor, acceptedTerms: true });
    expect(accepted.checkoutUrl).toMatch(/^\/pagos\/prueba\//);
    await expect(jobs.confirmJob(me, accepted.jobId)).rejects.toThrow(/pago/); // sin pago no se confirma
    const pay = await payPending(accepted.jobId);
    expect(pay.result).toBe("applied");
    const [charge] = await sql()<{ status: string; is_test: boolean }[]>`select status, is_test from charges where job_id = ${accepted.jobId}`;
    expect(charge).toMatchObject({ status: "approved", is_test: true });
    // Ahora el proveedor ve la dirección
    expect(await asUser(uid, (tx) => tx`select id from properties where id = ${propId}`)).toHaveLength(1);

    // 6. Ejecución
    await jobs.confirmJob(me, accepted.jobId);
    await jobs.markOnTheWay(me, accepted.jobId);
    await jobs.startJob(me, accepted.jobId, await visitCode(accepted.jobId));
    await jobs.addEvidence(me, accepted.jobId, { kind: "after", note: "Living terminado" }, jpg);
    // Cobro aprobado no implica trabajo completado
    const [j1] = await sql()<{ status: string }[]>`select status from jobs where id = ${accepted.jobId}`;
    expect(j1.status).toBe("in_progress");
    await expect(jobs.approveJob(cliente, accepted.jobId)).rejects.toThrow();
    await jobs.finishJob(me, accepted.jobId, "Listo");

    // 7. Cliente confirma
    await expect(jobs.approveJob(me, accepted.jobId)).rejects.toThrow(/permiso/);
    await jobs.approveJob(cliente, accepted.jobId);
    const [payout] = await sql()<{ id: string; status: string; amount_minor: number }[]>`select id, status, amount_minor from payouts where job_id = ${accepted.jobId}`;
    expect(payout.status).toBe("pending"); // completado no implica liquidado
    expect(payout.amount_minor).toBe(16_200_000);

    // 8. Sin reseña no se libera la liquidación
    await expect(executePayout(operador, payout.id, "Liquidación de prueba")).rejects.toThrow(/reseña/);

    // 9. Cliente califica (una sola vez): se publica después, de forma anónima
    await disputes.createReview(cliente, accepted.jobId, { rating: 5, comment: "Excelente" });
    await expect(disputes.createReview(cliente, accepted.jobId, { rating: 4, comment: "otra" })).rejects.toThrow(/Ya calificaste/);
    expect(await asUser(uid, (tx) => tx`select id from reviews_published where provider_id = ${pid}`)).toHaveLength(0);

    // 10. Liquidación simulada (solo operación)
    await expect(executePayout(cliente, payout.id, "x")).rejects.toThrow(/permiso/);
    await executePayout(operador, payout.id, "Liquidación de prueba");
    const [p2] = await sql()<{ status: string }[]>`select status from payouts where id = ${payout.id}`;
    expect(p2.status).toBe("paid");

    // Historial de la propiedad e invariantes financieras
    const history = await asUser(cliente.id, (tx) => tx`select id from jobs where property_id = ${propId}`);
    expect(history).toHaveLength(1);
    const events = await sql()<{ action: string }[]>`select action from entity_events where entity_type = 'job' and entity_id = ${accepted.jobId}`;
    expect(events.length).toBeGreaterThanOrEqual(7);
    expect(await ledgerBalance()).toBe(0);
  });
});
