import { describe, expect, it } from "vitest";
import { asUser, sql } from "@/server/db/client";
import * as requests from "@/server/modules/requests";
import * as quotes from "@/server/modules/quotes";
import * as jobs from "@/server/modules/jobs";
import * as providers from "@/server/modules/providers";
import { sendMessage } from "@/server/modules/messaging";
import * as props from "@/server/modules/properties";
import { listBookableProviders } from "@/server/modules/booking";
import { actor, catId, invitationFor, payPending, propertyOf, providerId, totalOf, visitCode, zoneId } from "./helpers";

async function directRequest(targetPid: string, title = "Reserva directa", propertyId?: string) {
  const ana = await actor("ana");
  return requests.createRequest(ana, {
    propertyId: propertyId ?? (await propertyOf("ana", "Casa")), categoryId: await catId("plomeria"), title, description: "Gotea la canilla del lavadero.",
    answers: {}, urgency: "normal", preferredWindows: [], targetProviderId: targetPid,
  });
}

describe("reserva directa: elegí a tu profesional", () => {
  it("el cliente ve profesionales con visita y precios de referencia", async () => {
    const lucia = await actor("lucia");
    const pid = await providerId("Plomería Sosa");
    await providers.updateVisitSettings(lucia, pid, { visitFeeMinor: 1_500_000, visitFeeCredited: true });
    await providers.addPriceRef(lucia, pid, { categoryId: await catId("plomeria"), title: "Cambio de cartucho de monocomando", fromMinor: 2_500_000 });
    await expect(providers.addPriceRef(lucia, pid, { categoryId: await catId("gas"), title: "Calefón", fromMinor: 1000 })).rejects.toThrow(/rubros que ofrecés/);
    const list = await listBookableProviders(sql(), { categoryId: await catId("plomeria"), zoneId: await zoneId("caba-palermo"), preferredWindows: [] });
    const l = list.find((p) => p.id === pid)!;
    expect(l.visitFeeMinor).toBe(1_500_000);
    expect(l.priceRefs[0]).toMatchObject({ title: "Cambio de cartucho de monocomando", fromMinor: 2_500_000 });
    expect(Object.keys(l)).not.toContain("taxId");
  });

  it("visita paga: acepta → cliente confirma y paga → confirmada → código → presupuesto en el lugar con descuento", async () => {
    const [ana, lucia] = await Promise.all([actor("ana"), actor("lucia")]);
    const pid = await providerId("Plomería Sosa");
    await providers.updateVisitSettings(lucia, pid, { visitFeeMinor: 1_500_000, visitFeeCredited: true });
    const propId = await props.createProperty(ana, { kind: "home", label: `PH ${Date.now()}`, addressLine: "Calle Nueva 456", zoneId: await zoneId("caba-palermo") });
    const reqId = await directRequest(pid, "Reserva directa", propId);
    const [r] = await sql()<{ request_mode: string; status: string }[]>`select request_mode, status from service_requests where id = ${reqId}`;
    expect(r).toEqual({ request_mode: "direct", status: "searching" });
    const invs = await sql()<{ provider_id: string; respond_by: Date | null }[]>`select provider_id, respond_by from request_invitations where request_id = ${reqId}`;
    expect(invs).toHaveLength(1); // solo el elegido, sin difundir a otros
    expect(invs[0].respond_by).not.toBeNull();

    // Antes de aceptar, el profesional no ve la dirección
    expect(await asUser(lucia.id, (tx) => tx`select id from properties where id = ${propId}`)).toHaveLength(0);

    const inv = await invitationFor(reqId, pid);
    const q = await quotes.acceptBooking(lucia, inv, { proposedDate: "2026-12-10", proposedWindow: "Mañana", note: "" });
    expect(await totalOf(q)).toBe(1_575_000); // visita + cargo de servicio
    const res = await quotes.acceptQuote(ana, q, { totalMinor: await totalOf(q), acceptedTerms: true });
    await payPending(res.jobId);
    const [job] = await sql()<{ status: string; visit_code: string }[]>`select status, visit_code from jobs where id = ${res.jobId}`;
    expect(job.status).toBe("confirmed"); // confirmación automática: el profesional ya había aceptado
    expect(job.visit_code).toMatch(/^\d{4}$/);
    expect(await asUser(lucia.id, (tx) => tx`select id from properties where id = ${propId}`)).toHaveLength(1);

    await expect(jobs.startJob(lucia, res.jobId, "0000" === job.visit_code ? "1111" : "0000")).rejects.toThrow(/código/);
    await jobs.startJob(lucia, res.jobId, await visitCode(res.jobId));

    // Presupuesto del arreglo en el lugar: descuenta la visita una sola vez
    const extraId = await jobs.proposeExtra(lucia, res.jobId, { description: "Cambio de cartucho y flexibles", reason: "Cartucho dañado", laborMinor: 3_000_000, materialsMinor: 1_000_000, isMainQuote: true });
    const [e] = await sql()<{ discount_minor: number; subtotal_minor: number; is_main_quote: boolean }[]>`select discount_minor, subtotal_minor, is_main_quote from job_extras where id = ${extraId}`;
    expect(e).toEqual({ discount_minor: 1_500_000, subtotal_minor: 2_500_000, is_main_quote: true });
    const second = await jobs.proposeExtra(lucia, res.jobId, { description: "Otro arreglo más", reason: "Pedido del cliente", laborMinor: 500_000, materialsMinor: 0, isMainQuote: true });
    const [e2] = await sql()<{ discount_minor: number }[]>`select discount_minor from job_extras where id = ${second}`;
    expect(e2.discount_minor).toBe(0);
  });

  it("visita sin cargo: sin cobro, confirmada al aceptar el cliente", async () => {
    const [ana, roberto] = await Promise.all([actor("ana"), actor("roberto")]);
    const pid = await providerId("Servicios Integrales Norte");
    await providers.updateVisitSettings(roberto, pid, { visitFeeMinor: 0, visitFeeCredited: false });
    const reqId = await directRequest(pid, "Visita gratis");
    const q = await quotes.acceptBooking(roberto, await invitationFor(reqId, pid), { proposedDate: "2026-12-11", proposedWindow: "Tarde", note: "" });
    expect(await totalOf(q)).toBe(0);
    const res = await quotes.acceptQuote(ana, q, { totalMinor: 0, acceptedTerms: true });
    expect(res.checkoutUrl).toBeNull();
    const [j] = await sql()<{ status: string }[]>`select status from jobs where id = ${res.jobId}`;
    expect(j.status).toBe("confirmed");
    expect(await sql()`select id from charges where job_id = ${res.jobId}`).toHaveLength(0);
  });

  it("si rechaza o no responde a tiempo, el cliente elige otro; también puede pasar a pedir varios presupuestos", async () => {
    const [ana, lucia] = await Promise.all([actor("ana"), actor("lucia")]);
    const lpid = await providerId("Plomería Sosa");
    const spid = await providerId("Servicios Integrales Norte");
    const reqId = await directRequest(lpid, "Rechazo");
    await expect(requests.chooseProvider(ana, reqId, spid)).rejects.toThrow(/Esperá su respuesta/);
    await requests.declineInvitation(lucia, await invitationFor(reqId, lpid), "Sin agenda");
    const [n] = await sql()<{ n: number }[]>`select count(*)::int as n from notifications where user_id = ${ana.id} and title like 'El profesional no puede tomar tu pedido%'`;
    expect(n.n).toBeGreaterThan(0);
    await requests.chooseProvider(ana, reqId, spid);
    // Vence el plazo del segundo
    await sql()`update request_invitations set respond_by = now() - interval '1 minute' where request_id = ${reqId} and provider_id = ${spid}`;
    expect(await requests.expireDirectBookings()).toBeGreaterThanOrEqual(1);
    const [inv] = await sql()<{ status: string }[]>`select status from request_invitations where request_id = ${reqId} and provider_id = ${spid}`;
    expect(inv.status).toBe("expired");
    // Opción secundaria: pedir presupuestos a varios
    await requests.switchToQuotes(ana, reqId);
    const [r] = await sql()<{ request_mode: string }[]>`select request_mode from service_requests where id = ${reqId}`;
    expect(r.request_mode).toBe("quotes");
  });

  it("el chat oculta datos de contacto y deja un aviso", async () => {
    const lucia = await actor("lucia");
    const lpid = await providerId("Plomería Sosa");
    const reqId = await directRequest(lpid, "Chat");
    const [c] = await sql()<{ id: string }[]>`select id from conversations where request_id = ${reqId} and provider_id = ${lpid}`;
    await sendMessage(lucia, c.id, "Hola! escribime al 11 5555-1234 y lo vemos por WhatsApp");
    const msgs = await sql()<{ body: string; sender_side: string }[]>`select body, sender_side from messages where conversation_id = ${c.id} order by created_at`;
    expect(msgs[0].body).not.toContain("5555");
    expect(msgs[1].sender_side).toBe("system");
  });
});
