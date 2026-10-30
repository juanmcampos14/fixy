/**
 * Captación por WhatsApp automático: plantillas de Meta desde el número comercial y Kommo como bandeja.
 * Meta y Kommo están simulados; se prueba qué se manda, a quién, cuántos por día, y qué hace Fixy con lo que el
 * equipo mueve en Kommo (respondió, interesado, baja). También que se frena si la calidad del número baja.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Antes del primer env() (se cachea por archivo de prueba).
process.env.SUPPLY_WHATSAPP_PHONE_NUMBER_ID = "111";
process.env.SUPPLY_WHATSAPP_WABA_ID = "222";
process.env.SUPPLY_WHATSAPP_TOKEN = "token-de-prueba";
process.env.KOMMO_TOKEN = "kommo-de-prueba";
process.env.KOMMO_SUBDOMINIO = "fixytest";

import { sql } from "@/server/db/client";
import * as supply from "@/server/modules/supply";
import * as camp from "@/server/modules/supply-campaigns";
import type { EmailAdapter } from "@/server/notifications";
import { actor, catId } from "./helpers";

const NOW = new Date("2026-11-03T15:00:00Z"); // martes 12 h en Argentina
const noEmail: EmailAdapter = { name: "test", async send() {} };
const phone = () => `11${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];
const state = { quality: "GREEN", nextLead: 9000, kommoLeads: [] as { id: number; status_id: number }[], noWhatsApp: new Set<string>() };
const STATUSES = ["Invitado", "Recordatorio", "Respondió", "Interesado", "Se registró", "No le interesa / Baja"].map((name, i) => ({ id: 100 + i, name }));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

beforeAll(() => {
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    if (url.includes("graph.facebook.com")) {
      if (url.includes("/222/message_templates")) return json({ data: [{ name: "fixy_invitacion_profesional_v1", language: "es_AR", status: "APPROVED" }, { name: "fixy_invitacion_recordatorio_v1", language: "es_AR", status: "APPROVED" }] });
      if (url.includes("/111?fields")) return json({ display_phone_number: "+54 9 11 6600-6676", verified_name: "Fixy", quality_rating: state.quality, messaging_limit_tier: "TIER_250" });
      if (url.includes("/111/messages")) {
        const to = (body as { to: string }).to;
        if (state.noWhatsApp.has(to)) return json({ error: { code: 131026, message: "Message undeliverable" } }, 400);
        return json({ messages: [{ id: `wamid.${to}` }] });
      }
    }
    if (url.includes("fixytest.kommo.com")) {
      if (url.endsWith("/leads/pipelines")) return json({ _embedded: { pipelines: [{ id: 50, name: "Captación Fixy", _embedded: { statuses: STATUSES } }] } });
      if (url.endsWith("/leads/complex")) return json([{ id: state.nextLead++ }]);
      if (url.includes("/notes") || method === "PATCH") return json({});
      if (url.includes("/leads?")) return json({ _embedded: { leads: state.kommoLeads } });
    }
    return json({ error: { message: `sin simular: ${method} ${url}` } }, 500);
  });
});
afterAll(() => vi.unstubAllGlobals());

const leadOf = (code: string) => sql()<{ id: string; stage: string; do_not_contact: boolean; kommo_lead_id: number | null }[]>`
  select id, stage, do_not_contact, kommo_lead_id from supply_leads where code = ${code}`.then((r) => r[0]);

describe("WhatsApp automático (Meta + Kommo)", () => {
  it("manda la plantilla con los datos del candidato, respeta el tope, registra en Kommo y aplica lo que el equipo mueve ahí", async () => {
    const admin = await actor("admin");
    await sql()`update supply_campaigns set status = 'closed' where status <> 'closed'`;
    const codes = Array.from({ length: 4 }, () => `FX-${String(100000 + Math.floor(Math.random() * 899999))}`);
    const phones = codes.map(() => phone());
    await supply.importLeads(supply.parseResearchRows([["ID", "Nombre comercial", "Oficio", "Localidad base", "Teléfono comercial"],
      ...codes.map((c, i) => [c, `Marmolería Test ${i}`, "marmolero", "Tigre", phones[i]])]).inputs, { sourceDetail: "test", trigger: "manual" });
    state.noWhatsApp.add(`549${phones[3]}`);

    await camp.setCompliance(admin, { commercialNumber: "+54 9 11 6600-6676", aaipRegistration: "", metaPolicyReviewed: true, emailPolicyReviewed: false });
    const { id, leads } = await camp.createCampaign(admin, { name: "Marmoleros automático", channel: "whatsapp_api", categoryIds: [await catId("marmoleria")], size: 4, firstMessage: "x".repeat(40), dailyCap: 3, followupDays: 4, maxAttempts: 2 });
    expect(leads).toBe(4);
    await camp.setCampaignStatus(admin, id, "active");

    // Domingo no sale nada.
    expect((await camp.runSupplyOutreach(10, noEmail, new Date("2026-11-01T15:00:00Z"))).sent).toBe(0);

    calls.length = 0;
    const r = await camp.runSupplyOutreach(10, noEmail, NOW);
    expect(r.sent + r.failed).toBe(3); // tope diario 3
    const sends = calls.filter((c) => c.url.includes("/111/messages"));
    expect(sends).toHaveLength(3);
    const first = sends[0].body as { to: string; template: { name: string; components: { type: string; parameters: { text: string }[] }[] } };
    expect(first.template.name).toBe("fixy_invitacion_profesional_v1");
    expect(first.template.components[0].parameters.map((p) => p.text)).toEqual([expect.stringMatching(/^Marmolería Test/), "marmolería y mesadas", "Tigre / Nordelta"]);
    expect(first.template.components[1].parameters[0].text).toMatch(/^fx-\d+$/);
    expect(calls.filter((c) => c.url.endsWith("/leads/complex"))).toHaveLength(r.sent);

    const sent = await sql()<{ code: string; status: string; kommo_lead_id: number | null; last_message_id: string | null }[]>`
      select l.code, cl.status, l.kommo_lead_id, cl.last_message_id from supply_campaign_leads cl join supply_leads l on l.id = cl.lead_id where cl.campaign_id = ${id} order by l.code`;
    expect(sent.filter((s) => s.status === "sent").every((s) => s.kommo_lead_id && s.last_message_id?.startsWith("wamid."))).toBe(true);

    // El que no tiene WhatsApp queda salteado (si cayó en esta tanda) y no se reintenta.
    const [noWa] = await sql()<{ status: string; skip_reason: string | null }[]>`
      select cl.status, cl.skip_reason from supply_campaign_leads cl join supply_leads l on l.id = cl.lead_id where l.code = ${codes[3]}`;
    if (noWa.status !== "queued") expect(noWa).toMatchObject({ status: "skipped", skip_reason: expect.stringMatching(/131026/) });

    // El equipo mueve en Kommo: uno a «Baja», otro a «Interesado».
    const withKommo = sent.filter((s) => s.kommo_lead_id);
    const [a, b] = withKommo;
    state.kommoLeads = [{ id: a.kommo_lead_id!, status_id: 105 }, { id: b.kommo_lead_id!, status_id: 103 }];
    await camp.runSupplyOutreach(10, noEmail, NOW);
    expect(await leadOf(a.code)).toMatchObject({ do_not_contact: true, stage: "discarded" });
    expect(await leadOf(b.code)).toMatchObject({ stage: "interested" });
    const after = await sql()<{ code: string; status: string }[]>`select l.code, cl.status from supply_campaign_leads cl join supply_leads l on l.id = cl.lead_id where cl.campaign_id = ${id}`;
    expect(after.find((x) => x.code === a.code)!.status).toBe("opted_out");
    expect(after.find((x) => x.code === b.code)!.status).toBe("replied");

    // Recordatorio a los 4 días solo a quien no respondió; nunca a quien pidió la baja.
    await sql()`update supply_campaign_leads set next_followup_at = now() - interval '1 minute' where campaign_id = ${id} and status = 'sent'`;
    await sql()`delete from supply_lead_events where kind = 'campaign' and detail->>'campaign' = ${id}`; // nuevo día para el tope
    calls.length = 0;
    await camp.runSupplyOutreach(10, noEmail, NOW);
    const reminders = calls.filter((c) => c.url.includes("/111/messages")).map((c) => c.body as { to: string; template: { name: string } });
    expect(reminders.some((m) => m.template.name === "fixy_invitacion_recordatorio_v1")).toBe(true);
    const aPhone = phones[codes.indexOf(a.code)], bPhone = phones[codes.indexOf(b.code)];
    expect(reminders.map((m) => m.to)).not.toContain(`549${aPhone}`);
    expect(reminders.map((m) => m.to)).not.toContain(`549${bPhone}`);
  });

  it("se frena si Meta marca el número en calidad baja", async () => {
    state.quality = "RED";
    calls.length = 0;
    const r = await camp.runSupplyOutreach(10, noEmail, NOW);
    expect(r.sent).toBe(0);
    expect(r.notes.join(" ")).toMatch(/calidad del número RED/);
    expect(calls.filter((c) => c.url.includes("/111/messages"))).toHaveLength(0);
    state.quality = "GREEN";
  });
});
