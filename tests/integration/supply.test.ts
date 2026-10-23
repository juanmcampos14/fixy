/**
 * Captación de profesionales: importación idempotente de la planilla de research, sin duplicados, vínculo con las altas
 * (por código de invitación, teléfono o email), etapas que salen del perfil real y acciones del equipo comercial.
 */
import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { loadActor } from "@/server/auth/actor";
import { registerUser } from "@/server/modules/users";
import * as providers from "@/server/modules/providers";
import * as supply from "@/server/modules/supply";
import { listLeads, supplyByChannel, supplyByTrade, supplyFunnel } from "@/server/queries/supply";
import { actor, catId, zoneId } from "./helpers";

const n6 = () => String(100000 + Math.floor(Math.random() * 899999));
const phone = () => `11${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
const header = ["ID FIXY", "Nombre comercial", "Oficio", "Localidad base", "Teléfono comercial", "Email comercial", "Sitio / perfil"];
const lead = (code: string) => sql()<{ id: string; stage: string; provider_id: string | null; category_ids: string[]; base_zone_id: string | null; base_region: string | null; phone_key: string | null; whatsapp_e164: string | null; email: string | null; website: string | null; source: string; utm: Record<string, string> }[]>`
  select id, stage, provider_id, category_ids, base_zone_id, base_region, phone_key, whatsapp_e164, email, website, source, utm from supply_leads where code = ${code}`.then((r) => r[0]);

async function newPro(name: string, contactPhone: string, origin: providers.SignupOrigin = {}) {
  const uid = await registerUser({ fullName: name, email: `${name.toLowerCase().replace(/\W+/g, ".")}.${Date.now()}@test.local`, password: "password-123", acceptTerms: true });
  const a = (await systemTx((tx) => loadActor(tx, uid)))!;
  const pid = await providers.quickStartProvider(a, {
    kind: "individual", displayName: name, contactPhone,
    description: "Trabajo prolijo y con garantía escrita. Destapaciones, cambio de canillas y reparación de pérdidas en baños y cocinas.",
    categoryIds: [await catId("plomeria")], zoneIds: [await zoneId("caba-palermo")], baseZoneId: await zoneId("caba-palermo"),
    availability: [{ weekday: 1, startMinute: 480, endMinute: 1080 }], priceRefs: [], aiAssisted: false,
  }, origin);
  return { uid, pid };
}

describe("importación de la planilla de research", () => {
  it("normaliza oficio, localidad y teléfono; es idempotente y solo completa datos vacíos", async () => {
    const [a, b, c] = [`FX-${n6()}`, `FX-${n6()}`, `FX-${n6()}`];
    const pa = phone();
    const rows = [header,
      [a, "Plomería Test Uno", "Plomero / gasista", "Barrio Norte", `+54 9 ${pa.slice(0, 2)} ${pa.slice(2, 6)}-${pa.slice(6)}`, "", ""],
      [b, "Pinturas Test", "Pintor", "San Isidro, Buenos Aires", "", "pinturas.test@example.com", ""],
      [c.toLowerCase(), "Sin datos de contacto", "Electricista", "Zona Norte", "", "", ""],
      ["ABC", "Fila mala", "Pintor", "", "", "", ""],
      ["", "", "", "", "", "", ""],
    ];
    const parsed = supply.parseResearchRows(rows);
    expect(parsed.inputs.map((i) => i.code)).toEqual([a, b, c]);
    expect(parsed.issues).toEqual([expect.objectContaining({ code: "ABC" })]);

    const r1 = await supply.importLeads(parsed.inputs, { sourceDetail: "Planilla test", trigger: "initial", preIssues: parsed.issues });
    expect(r1).toMatchObject({ inserted: 3, updated: 0, skipped: 0 });
    const la = await lead(a);
    expect(la.category_ids.sort()).toEqual([await catId("plomeria"), await catId("gas")].sort());
    expect(la.base_zone_id).toBe(await zoneId("caba-recoleta")); // Barrio Norte = Recoleta
    expect(la).toMatchObject({ stage: "candidate", phone_key: pa, whatsapp_e164: `549${pa}`, base_region: "CABA" });
    expect((await lead(c)).base_region).toBe("GBA_NORTE");

    // Segunda corrida: nada nuevo. Si la planilla suma un sitio que faltaba, se completa; lo trabajado no se toca.
    const ana = await actor("admin");
    await supply.recordContact(ana, la.id, { channel: "whatsapp", note: "Le interesa" });
    const again = supply.parseResearchRows([header, ...rows.slice(1, 3).map((r, i) => (i === 0 ? [...r.slice(0, 6), "plomeriatest.com.ar"] : r))]);
    const r2 = await supply.importLeads(again.inputs, { sourceDetail: "Planilla test", trigger: "cron" });
    expect(r2).toMatchObject({ inserted: 0, updated: 1, unchanged: 1 });
    expect(await lead(a)).toMatchObject({ website: "https://plomeriatest.com.ar", stage: "contacted" });
  });

  it("no duplica: un ID nuevo con el teléfono de otro candidato se saltea y se informa", async () => {
    const p = phone();
    const [a, b] = [`FX-${n6()}`, `FX-${n6()}`];
    const r = await supply.importLeads(supply.parseResearchRows([header,
      [a, "Original", "Pintor", "Palermo", p, "", ""],
      [b, "Copia", "Pintor", "Palermo", `0${p.slice(0, 2)} 15 ${p.slice(2)}`, "", ""],
      [a, "Repetido", "Pintor", "Palermo", "", "", ""],
    ]).inputs, { sourceDetail: "Planilla test", trigger: "manual" });
    expect(r).toMatchObject({ inserted: 1, skipped: 2 });
    expect(r.issues.map((i) => i.problem).join(" | ")).toMatch(new RegExp(`Duplicado de ${a}.*ID repetido`));
    expect(await lead(b)).toBeUndefined();
  });
});

describe("vínculo con las altas", () => {
  it("por código de invitación (en minúsculas, como viene en el link) y las etapas siguen al perfil", async () => {
    const code = `FX-${n6()}`;
    await supply.importLeads(supply.parseResearchRows([header, [code, "Candidato Invitado", "Plomero", "Palermo", "", "", ""]]).inputs, { sourceDetail: "t", trigger: "manual" });
    const { pid } = await newPro("Invitado Por Codigo", phone(), { source: "research", referrerSlug: code.toLowerCase() });
    expect(await lead(code)).toMatchObject({ stage: "registered", provider_id: pid });

    await sql()`update providers set identity_status = 'verified' where id = ${pid}`;
    await supply.refreshLeadStages();
    expect((await lead(code)).stage).toBe("verified");
    await sql()`update providers set status = 'in_review' where id = ${pid}`;
    await sql()`update providers set status = 'approved', accepting_jobs = true where id = ${pid}`;
    await supply.refreshLeadStages();
    expect((await lead(code)).stage).toBe("active");
    const events = await sql()<{ kind: string }[]>`select kind from supply_lead_events e join supply_leads l on l.id = e.lead_id where l.code = ${code} order by e.id`;
    expect(events.map((e) => e.kind)).toEqual(["import", "link", "stage", "stage"]);
    // La etapa de un registrado no se cambia a mano.
    await expect(supply.setLeadStage(await actor("admin"), (await lead(code)).id, "contacted")).rejects.toThrow(/perfil/);
  });

  it("por teléfono aunque no traiga código; sin candidato previo crea uno con la campaña", async () => {
    const p = phone();
    const code = `FX-${n6()}`;
    await supply.importLeads(supply.parseResearchRows([header, [code, "Por Teléfono", "Pintor", "Palermo", `${p.slice(0, 2)} ${p.slice(2)}`, "", ""]]).inputs, { sourceDetail: "t", trigger: "manual" });
    const { pid } = await newPro("Llego Solo Por Telefono", `+54 9 ${p}`, { source: "sumate-general" });
    expect((await lead(code)).provider_id).toBe(pid);

    const { pid: fromAds } = await newPro("Llego Por Meta", phone(), { source: "meta", utm: { utm_source: "meta", utm_campaign: "plomeros-zn" } });
    const [created] = await sql()<{ code: string; source: string; utm: Record<string, string>; stage: string }[]>`select code, source, utm, stage from supply_leads where provider_id = ${fromAds}`;
    expect(created).toMatchObject({ source: "ads", stage: "registered", utm: { utm_source: "meta", utm_campaign: "plomeros-zn" } });
    expect(created.code).toMatch(/^AL-\d{4,}$/);
    const [p2] = await sql()<{ signup_utm: Record<string, string> }[]>`select signup_utm from providers where id = ${fromAds}`;
    expect(p2.signup_utm.utm_campaign).toBe("plomeros-zn");
    expect((await supplyByChannel()).find((c) => c.channel === "meta")).toMatchObject({ registered: expect.any(Number) });
  });
});

describe("acciones del equipo comercial", () => {
  it("contacto, interesado, nota, responsable y «no contactar»; solo quien tiene permiso", async () => {
    const admin = await actor("admin");
    const code = await supply.createManualLead(admin, { businessName: "Recomendado Ferretería", trades: "techista", locality: "Tigre", phone: phone() });
    const l = await lead(code);
    expect(l).toMatchObject({ source: "manual", stage: "candidate" });
    await expect(supply.recordContact(await actor("ana"), l.id, { channel: "whatsapp" })).rejects.toThrow();

    await supply.recordContact(admin, l.id, { channel: "call" });
    await supply.setLeadStage(admin, l.id, "interested");
    await supply.addLeadNote(admin, l.id, "Tiene camioneta y trabaja en zona norte");
    await supply.assignLeadOwner(admin, l.id, admin.id);
    await expect(supply.assignLeadOwner(admin, l.id, (await actor("ana")).id)).rejects.toThrow(/equipo/);
    expect((await lead(code)).stage).toBe("interested");

    await supply.setDoNotContact(admin, l.id, "Respondió que no le interesa y que no le escribamos");
    expect((await lead(code)).stage).toBe("discarded");
    await expect(supply.recordContact(admin, l.id, { channel: "whatsapp" })).rejects.toThrow(/no lo contactemos/);

    const text = supply.invitationText({ code, business_name: "Recomendado Ferretería", contact_name: null });
    expect(text).toContain(`/alta?ref=${code.toLowerCase()}`);
    expect(text).toMatch(/no te cobra comisión/);

    const list = await listLeads({ q: code });
    expect(list.rows.map((r) => r.code)).toEqual([code]);
    expect((await supplyFunnel()).total).toBeGreaterThan(0);
    expect((await supplyByTrade()).length).toBeGreaterThan(0);
  });
});
