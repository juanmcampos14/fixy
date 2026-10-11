import { describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import * as requests from "@/server/modules/requests";
import { createProperty } from "@/server/modules/properties";
import { actor, providerId } from "./helpers";

describe("volver a buscar profesionales", () => {
  it("un pedido sin cobertura se envía al profesional que se suma después a esa zona y rubro", async () => {
    const ana = await actor("ana");
    // Una zona y un rubro que hoy nadie cubre.
    const [pair] = await sql()<{ zone_id: string; category_id: string }[]>`
      select z.id as zone_id, c.id as category_id from zones z cross join categories c
      where z.active and c.active and not c.requires_review and z.code <> 'otra-zona'
        and not exists (select 1 from provider_zones pz join provider_categories pc on pc.provider_id = pz.provider_id
                        join providers p on p.id = pz.provider_id
                        where pz.zone_id = z.id and pc.category_id = c.id and not p.sandbox)
      limit 1`;
    expect(pair).toBeTruthy();
    const propertyId = await createProperty(ana, { kind: "home", label: `Casa rematch ${Date.now()}`, addressLine: "Calle Falsa 123", zoneId: pair.zone_id });
    const reqId = await requests.createRequest(ana, {
      propertyId, categoryId: pair.category_id, title: "Pedido sin cobertura", description: "Necesito a alguien para este trabajo en mi casa.",
      answers: {}, urgency: "normal", preferredWindows: [],
    });
    expect((await sql()<{ status: string }[]>`select status from service_requests where id = ${reqId}`)[0].status).toBe("no_coverage");

    // Sin nadie nuevo, no pasa nada.
    expect(await requests.rematchOpenRequests({ requestId: reqId })).toBe(0);

    // Se suma un profesional (sin verificar todavía) que cubre esa zona y rubro.
    const pid = await providerId("Servicios Integrales Norte");
    const addedZone = (await sql()`insert into provider_zones (provider_id, zone_id) values (${pid}, ${pair.zone_id}) on conflict do nothing returning 1`).length > 0;
    const addedCat = (await sql()`insert into provider_categories (provider_id, category_id) values (${pid}, ${pair.category_id}) on conflict do nothing returning 1`).length > 0;
    try {
      expect(await requests.rematchOpenRequests({ providerId: pid })).toBeGreaterThanOrEqual(1);
      const [r] = await sql()<{ status: string; invited: number }[]>`
        select status, (select count(*)::int from request_invitations i where i.request_id = r.id and i.provider_id = ${pid}) as invited from service_requests r where r.id = ${reqId}`;
      expect(r).toEqual({ status: "searching", invited: 1 });
      // No se lo vuelve a invitar.
      expect(await requests.rematchOpenRequests({ requestId: reqId })).toBe(0);
    } finally {
      if (addedZone) await sql()`delete from provider_zones where provider_id = ${pid} and zone_id = ${pair.zone_id}`;
      if (addedCat) await sql()`delete from provider_categories where provider_id = ${pid} and category_id = ${pair.category_id}`;
    }
  });
});
