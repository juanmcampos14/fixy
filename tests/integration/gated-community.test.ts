import { describe, expect, it } from "vitest";
import { asUser, sql } from "@/server/db/client";
import * as requests from "@/server/modules/requests";
import * as quotes from "@/server/modules/quotes";
import * as providers from "@/server/modules/providers";
import * as props from "@/server/modules/properties";
import { sanitizeRequirements } from "@/server/assistant/access-rules";
import { actor, catId, invitationFor, providerId, zoneId } from "./helpers";

const REQS = sanitizeRequirements({
  summary: "Seguro de accidentes personales con cláusula de no repetición a favor del barrio. Consultas al 11 5555-1234.",
  requirements: [
    { kind: "no_repetition_clause", title: "Cláusula de no repetición a favor del barrio", detail: "Mandar a admin@barrio.com.ar", appliesTo: "person", mandatory: true },
    { kind: "vehicle_insurance", title: "Seguro del auto vigente", detail: "", appliesTo: "vehicle", mandatory: true },
  ],
  allowedHours: "Lunes a viernes de 8 a 17", howToRegister: "Alta previa por la app del barrio: https://barrio.example/alta", missingInfo: [], confidence: "high",
});

describe("barrio cerrado: requisitos de ingreso", () => {
  it("los requisitos guardados no tienen contactos ni links", () => {
    expect(REQS.summary).not.toMatch(/5555/);
    expect(REQS.requirements[0].detail).not.toMatch(/@/);
    expect(REQS.howToRegister).not.toMatch(/https?:/);
  });

  it("el profesional invitado ve los requisitos, pero no el barrio ni la dirección; debe confirmarlos al aceptar", async () => {
    const [ana, lucia] = await Promise.all([actor("ana"), actor("lucia")]);
    const pid = await providerId("Plomería Sosa");
    await providers.updateVisitSettings(lucia, pid, { visitFeeMinor: 0, visitFeeCredited: false });
    const propId = await props.createProperty(ana, { kind: "home", label: `Casa country ${Date.now()}`, addressLine: "Lote 123 Barrio Los Ceibos", zoneId: await zoneId("caba-palermo"), gatedCommunity: true, gatedName: "Los Ceibos" });
    await expect(props.saveGatedRules(await actor("roberto"), propId, { text: "Seguro con cláusula de no repetición" })).rejects.toThrow();
    // Sin clave de IA en tests: se guarda el texto y queda sin interpretar.
    const res = await props.saveGatedRules(ana, propId, { text: "Seguro con cláusula de no repetición", notes: "Avisame 24 h antes" });
    expect(res.interpreted).toBe(false);
    await sql()`update properties set gated_requirements = ${sql().json(REQS)}, gated_requirements_status = 'ready' where id = ${propId}`;

    const reqId = await requests.createRequest(ana, {
      propertyId: propId, categoryId: await catId("plomeria"), title: "Pérdida en baño", description: "Pierde el inodoro.",
      answers: {}, urgency: "normal", preferredWindows: [], targetProviderId: pid,
    });
    const seen = await asUser(lucia.id, async (tx) => ({
      access: await tx<{ gated_requirements: typeof REQS; gated_client_notes: string }[]>`select * from request_access_requirements where request_id = ${reqId}`,
      prop: await tx`select id from properties where id = ${propId}`,
    }));
    expect(seen.prop).toHaveLength(0);
    expect(seen.access).toHaveLength(1);
    expect(Object.keys(seen.access[0])).not.toContain("gated_name");
    expect(JSON.stringify(seen.access[0])).not.toMatch(/Ceibos|Lote 123/);
    expect(seen.access[0].gated_requirements.requirements).toHaveLength(2);
    expect(seen.access[0].gated_client_notes).toBe("Avisame 24 h antes");

    // Otro profesional no invitado no ve nada
    const roberto = await actor("roberto");
    expect(await asUser(roberto.id, (tx) => tx`select 1 from request_access_requirements where request_id = ${reqId}`)).toHaveLength(0);

    const inv = await invitationFor(reqId, pid);
    await expect(quotes.acceptBooking(lucia, inv, { proposedDate: "2026-12-10", proposedWindow: "Mañana", note: "" })).rejects.toThrow(/barrio cerrado/);
    const q = await quotes.acceptBooking(lucia, inv, { proposedDate: "2026-12-10", proposedWindow: "Mañana", note: "", accessAcknowledged: true });
    await quotes.acceptQuote(ana, q, { totalMinor: 0, acceptedTerms: true });
    // Visita confirmada: ahora sí ve la propiedad con el nombre del barrio
    const [p] = await asUser(lucia.id, (tx) => tx<{ gated_name: string }[]>`select gated_name from properties where id = ${propId}`);
    expect(p.gated_name).toBe("Los Ceibos");
  });
});
