/**
 * Campañas de captación: requisitos antes de activar, cola de WhatsApp asistida con tope diario, seguimientos,
 * respuestas y bajas, clics en la invitación, emails con link de baja y API de solo lectura.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import * as supply from "@/server/modules/supply";
import * as camp from "@/server/modules/supply-campaigns";
import { authenticateApiKey, createApiKey, revokeApiKey } from "@/server/modules/api-keys";
import { GET as apiGet, POST as apiPost } from "@/app/api/v1/captacion/[recurso]/route";
import type { EmailAdapter } from "@/server/notifications";
import { actor, catId } from "./helpers";

const n6 = () => String(100000 + Math.floor(Math.random() * 899999));
const phone = () => `11${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const header = ["ID", "Nombre comercial", "Oficio", "Localidad base", "Teléfono comercial", "Email comercial", "Sitio / perfil", "Fuente"];
const leadOf = (code: string) => sql()<{ id: string; stage: string; do_not_contact: boolean; source_url: string | null }[]>`select id, stage, do_not_contact, source_url from supply_leads where code = ${code}`.then((r) => r[0]);

async function seedLeads(trade: string, n: number, withEmail = false) {
  const codes = Array.from({ length: n }, () => `FX-${n6()}`);
  await supply.importLeads(supply.parseResearchRows([header, ...codes.map((c, i) => [c, `${trade} Test ${i}`, trade, "Tigre", phone(), withEmail ? `${c.toLowerCase()}@example.com` : "", "", "https://www.argentino.com.ar/x"])]).inputs,
    { sourceDetail: "test", trigger: "manual" });
  return codes;
}

const WA = { first: camp.DEFAULT_WHATSAPP_FIRST, followup: camp.DEFAULT_WHATSAPP_FOLLOWUP };

beforeAll(async () => {
  // Que ninguna campaña vieja de otra corrida tome estos candidatos.
  await sql()`update supply_campaigns set status = 'closed' where status <> 'closed'`;
});

describe("campañas por WhatsApp (envío asistido)", () => {
  it("se arma en borrador, no se activa sin requisitos y respeta el tope diario", async () => {
    const admin = await actor("admin");
    const codes = await seedLeads("piletero", 3);
    expect((await leadOf(codes[0])).source_url).toBe("https://www.argentino.com.ar/x"); // columna Fuente
    const piletas = await catId("piletas");

    await expect(camp.createCampaign(admin, { name: "Sin baja", channel: "whatsapp", categoryIds: [piletas], size: 3, firstMessage: "Hola {nombre}, sumate a Fixy desde este link: {link} ya mismo", maxAttempts: 1 }))
      .rejects.toThrow(/\{baja\}/);
    const { id, leads } = await camp.createCampaign(admin, { name: "Piloto piletas", channel: "whatsapp", categoryIds: [piletas], size: 3, firstMessage: WA.first, followupMessage: WA.followup, dailyCap: 2, followupDays: 3 });
    expect(leads).toBe(3);

    await sql()`delete from platform_settings where key = 'supply.compliance'`;
    await expect(camp.setCampaignStatus(admin, id, "active")).rejects.toThrow(/WhatsApp comercial/);
    await camp.setCompliance(admin, { commercialNumber: "+54 9 11 5555-0000", aaipRegistration: "RNBD 123", metaPolicyReviewed: true, emailPolicyReviewed: true });
    await camp.setCampaignStatus(admin, id, "active");

    const q1 = await camp.nextInQueue(id);
    expect(q1.item!.message).toContain(`/alta?ref=${q1.item!.code.toLowerCase()}`);
    expect(q1.item!.message).toMatch(/respondé BAJA/);
    expect(q1.item!.waUrl).toMatch(/^https:\/\/wa\.me\/549\d{10}\?text=/);
    await camp.resolveQueueItem(admin, q1.item!.campaignLeadId, "sent");
    expect((await leadOf(q1.item!.code)).stage).toBe("contacted");

    const q2 = await camp.nextInQueue(id);
    expect(q2.item!.code).not.toBe(q1.item!.code);
    await camp.resolveQueueItem(admin, q2.item!.campaignLeadId, "sent");
    const q3 = await camp.nextInQueue(id);
    expect(q3).toMatchObject({ item: null, capReached: true, sentToday: 2 });
    const [third] = await sql()<{ id: string }[]>`select id from supply_campaign_leads where campaign_id = ${id} and status = 'queued'`;
    await expect(camp.resolveQueueItem(admin, third.id, "sent")).rejects.toThrow(/del día/);

    // Seguimiento vencido: aparece primero, con el texto de seguimiento.
    await sql()`update supply_campaigns set daily_cap = 10 where id = ${id}`;
    await sql()`update supply_campaign_leads set next_followup_at = now() - interval '1 hour' where id = ${q1.item!.campaignLeadId}`;
    const f = await camp.nextInQueue(id);
    expect(f.item).toMatchObject({ campaignLeadId: q1.item!.campaignLeadId, followup: true, attempt: 2 });
    expect(f.item!.message).toMatch(/te escribí hace unos días/);

    // Clic en la invitación, respuesta y baja.
    await camp.recordInviteClick(q1.item!.code.toLowerCase(), "whatsapp");
    const [cl] = await sql()<{ clicked_at: Date | null }[]>`select clicked_at from supply_campaign_leads where id = ${q1.item!.campaignLeadId}`;
    expect(cl.clicked_at).not.toBeNull();
    await camp.resolveQueueItem(admin, q1.item!.campaignLeadId, "interested");
    expect((await leadOf(q1.item!.code)).stage).toBe("interested");
    await camp.resolveQueueItem(admin, q2.item!.campaignLeadId, "opt_out");
    expect(await leadOf(q2.item!.code)).toMatchObject({ do_not_contact: true, stage: "discarded" });
    expect((await camp.nextInQueue(id)).item?.campaignLeadId).toBe(third.id);

    // Una campaña nueva no vuelve a tomar a nadie de esta (sigue abierta) ni a quien pidió la baja.
    await expect(camp.createCampaign(admin, { name: "Repetida", channel: "whatsapp", categoryIds: [piletas], size: 5, firstMessage: WA.first, followupMessage: WA.followup }))
      .rejects.toThrow(/No hay candidatos/);
  });

  it("los seguimientos agotados pasan a «sin respuesta»", async () => {
    const admin = await actor("admin");
    await seedLeads("vidriero", 1);
    const { id } = await camp.createCampaign(admin, { name: "Vidrios", channel: "whatsapp", categoryIds: [await catId("vidrieria")], size: 1, firstMessage: WA.first, maxAttempts: 1 });
    await camp.setCampaignStatus(admin, id, "active");
    const q = await camp.nextInQueue(id);
    await camp.resolveQueueItem(admin, q.item!.campaignLeadId, "sent");
    await sql()`update supply_campaign_leads set next_followup_at = now() - interval '1 minute' where id = ${q.item!.campaignLeadId}`;
    await camp.runSupplyOutreach(10);
    const [r] = await sql()<{ status: string }[]>`select status from supply_campaign_leads where id = ${q.item!.campaignLeadId}`;
    expect(r.status).toBe("no_response");
  });
});

describe("base con consentimiento", () => {
  it("se carga sin IDs, no duplica, registra el consentimiento y la campaña puede tomar solo a esos contactos", async () => {
    const admin = await actor("admin");
    await sql()`update supply_campaigns set status = 'closed' where status <> 'closed'`;
    const [p1, p2] = [phone(), phone()];
    const rows = [["Nombre", "Oficio", "Localidad", "Teléfono"], ["Ana Herrera", "herrero", "Tigre", p1], ["Taller Ruiz", "herrería", "Tigre", p2]];
    const parsed = supply.parseResearchRows(rows);
    const r1 = await supply.importLeads(parsed.inputs, { sourceDetail: "Base oficial", trigger: "upload", actor: admin, consent: { source: "Padrón de prueba, autorizaron comunicaciones" } });
    expect(r1.inserted).toBe(2);
    const leads = await sql()<{ code: string; wa_consent_source: string | null }[]>`select code, wa_consent_source from supply_leads where phone_key in (${p1}, ${p2}) order by code`;
    expect(leads.map((l) => l.code)).toEqual([expect.stringMatching(/^AL-\d{4,}$/), expect.stringMatching(/^AL-\d{4,}$/)]);
    expect(leads[0].wa_consent_source).toMatch(/Padrón/);
    // Volver a subir el mismo archivo no duplica.
    const r2 = await supply.importLeads(supply.parseResearchRows(rows).inputs, { sourceDetail: "Base oficial", trigger: "upload", actor: admin });
    expect(r2).toMatchObject({ inserted: 0, skipped: 2 });

    // Uno de la planilla de research (sin consentimiento) del mismo oficio no entra en la campaña «solo con consentimiento».
    await seedLeads("herrero", 1);
    const herreria = await catId("herreria");
    const { leads: n } = await camp.createCampaign(admin, { name: "Herreros con consentimiento", channel: "whatsapp", categoryIds: [herreria], size: 10, firstMessage: WA.first, followupMessage: WA.followup, onlyConsented: true });
    expect(n).toBe(2);
  });
});

describe("campañas por email", () => {
  it("salen solas en horario comercial, con remitente, origen del dato y link de baja que funciona", async () => {
    const admin = await actor("admin");
    await sql()`update supply_campaigns set status = 'closed' where status <> 'closed'`;
    await seedLeads("techista", 2, true);
    const { id } = await camp.createCampaign(admin, {
      name: "Techos por email", channel: "email", categoryIds: [await catId("techos")], size: 2, emailSubject: camp.DEFAULT_EMAIL_SUBJECT,
      firstMessage: camp.DEFAULT_EMAIL_FIRST, followupMessage: camp.DEFAULT_EMAIL_FOLLOWUP, dailyCap: 1,
    });
    // En pruebas no hay Resend: no se puede activar (en producción sí); se activa a mano para probar el envío.
    await expect(camp.setCampaignStatus(admin, id, "active")).rejects.toThrow(/Resend/);
    await sql()`update supply_campaigns set status = 'active' where id = ${id}`;
    const sent: { to: string; subject: string; text: string; headers?: Record<string, string> }[] = [];
    const adapter: EmailAdapter = { name: "test", async send(m) { sent.push(m); } };

    const sunday = new Date("2026-10-25T15:00:00Z");
    expect((await camp.runSupplyOutreach(10, adapter, sunday)).sent).toBe(0);
    const tuesday = new Date("2026-10-27T15:00:00Z"); // 12 h en Argentina
    expect((await camp.runSupplyOutreach(10, adapter, tuesday)).sent).toBe(1); // tope diario 1
    expect((await camp.runSupplyOutreach(10, adapter, tuesday)).sent).toBe(0);
    expect(sent[0].subject).toMatch(/^Pedidos de techos/i);
    expect(sent[0].text).toMatch(/FLIPS S\.R\.L\..*figura públicamente/s);
    expect(sent[0].headers!["List-Unsubscribe"]).toMatch(/\/captacion\/baja\?t=/);

    const token = sent[0].text.match(/baja\?t=([^\s]+)/)![1];
    expect(camp.verifyOptOutToken(`${token.slice(0, -2)}xx`)).toBeNull();
    expect(await camp.optOutByToken(token)).toBe(true);
    const leadId = token.split(".")[0];
    const [l] = await sql()<{ do_not_contact: boolean }[]>`select do_not_contact from supply_leads where id = ${leadId}`;
    expect(l.do_not_contact).toBe(true);
  });
});

describe("API de solo lectura", () => {
  it("pide clave, no entrega teléfonos ni emails, verifica duplicados y deja de andar al revocarla", async () => {
    const admin = await actor("admin");
    await expect(createApiKey(await actor("ana"), { name: "No" })).rejects.toThrow();
    const { id, key } = await createApiKey(admin, { name: "GPT de prueba", expiresDays: 30 });
    expect(key).toMatch(/^fixy_ro_[a-z0-9]{20,40}$/);
    const [stored] = await sql()<{ key_hash: string }[]>`select key_hash from api_keys where id = ${id}`;
    expect(stored.key_hash).not.toContain(key);

    const req = (path: string, init: RequestInit = {}, k = key) => new Request(`http://localhost${path}`, { ...init, headers: { authorization: `Bearer ${k}`, "content-type": "application/json" } });
    const params = (recurso: string) => ({ params: Promise.resolve({ recurso }) });

    expect((await apiGet(req("/api/v1/captacion/resumen", {}, "fixy_ro_malamalamalamalamalamala"), params("resumen"))).status).toBe(401);
    const res = await apiGet(req("/api/v1/captacion/resumen"), params("resumen"));
    expect(res.status).toBe(200);
    expect((await res.json()).total).toBeGreaterThan(0);
    const list = await (await apiGet(req("/api/v1/captacion/candidatos?region=GBA_NORTE"), params("candidatos"))).json();
    expect(list.candidatos.length).toBeGreaterThan(0);
    const raw = JSON.stringify(list);
    expect(raw).not.toMatch(/"(telefono|phone_raw|email|whatsapp_e164)"/);
    expect(raw).not.toMatch(/@example\.com/);

    const codes = await seedLeads("cerrajero", 1);
    const [{ phone_raw }] = await sql()<{ phone_raw: string }[]>`select phone_raw from supply_leads where code = ${codes[0]}`;
    const v = await (await apiPost(req("/api/v1/captacion/verificar", { method: "POST", body: JSON.stringify({ items: [{ telefono: phone_raw }, { telefono: "11 0000 0000" }] }) }), params("verificar"))).json();
    expect(v.resultados[0]).toMatchObject({ existe: true, coincidencias: [expect.objectContaining({ code: codes[0], by: "telefono" })] });
    expect(v.resultados[1].existe).toBe(false);

    const [log] = await sql()<{ n: number }[]>`select count(*)::int as n from api_key_requests where key_id = ${id}`;
    expect(log.n).toBe(3); // la consulta con clave inválida no se asocia a ninguna clave
    await revokeApiKey(admin, id);
    expect(await authenticateApiKey(req("/x"), "captacion:read")).toMatchObject({ ok: false, status: 401 });
  });
});
