import { describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import * as requests from "@/server/modules/requests";
import * as props from "@/server/modules/properties";
import { actor, catId, zoneId } from "./helpers";

describe("pedidos fuera de las zonas de cobertura", () => {
  it("se aceptan en 'Otra zona' y quedan para conseguir a mano; ningún profesional la elige", async () => {
    const ana = await actor("ana");
    const otra = await zoneId("otra-zona");
    expect(otra).toBeTruthy();
    const propId = await props.createProperty(ana, { kind: "home", label: "Casa Escobar", addressLine: "Ruta 25 1200, Escobar", zoneId: otra });
    const reqId = await requests.createRequest(ana, {
      propertyId: propId, categoryId: await catId("electricidad"), title: "Se corta la luz", description: "Se corta la luz cuando prendo el horno.",
      answers: { alcance: "Todo el lugar" }, urgency: "normal", preferredWindows: [],
    });
    const [r] = await sql()<{ status: string }[]>`select status from service_requests where id = ${reqId}`;
    expect(r.status).toBe("no_coverage");
    const [{ n }] = await sql()<{ n: number }[]>`select count(*)::int as n from notifications where link = ${`/admin/solicitudes/${reqId}`}`;
    expect(n).toBeGreaterThan(0);
  });
});
