import { describe, expect, it } from "vitest";
import { sql } from "@/server/db/client";
import { handleInbound, type Inbound } from "@/server/whatsapp/bot";
import { createAlertsCode, alertsState } from "@/server/modules/whatsapp-alerts";
import * as requests from "@/server/modules/requests";
import { actor, catId, propertyOf, providerId } from "./helpers";

let seq = 0;
const msg = (from: string, text: string): Inbound => ({ id: `wamid.alerts.${Date.now()}.${seq++}`, from, type: "text", text });
const waOutboxFor = async (userId: string, since: Date) =>
  sql()<{ template: string; requestId: string }[]>`
    select payload->>'template' as template, payload->>'requestId' as "requestId" from outbox
    where channel = 'whatsapp' and recipient_user_id = ${userId} and created_at >= ${since} order by created_at`;

describe("avisos de oportunidades por WhatsApp para profesionales", () => {
  it("se activan con un código enviado desde su WhatsApp, avisan pedidos nuevos y se dan de baja con BAJA", async () => {
    const [ana, roberto] = await Promise.all([actor("ana"), actor("roberto")]);
    const pid = await providerId("Servicios Integrales Norte");
    const phone = `54911${String(Date.now()).slice(-8)}`;
    const before = await sql()<{ whatsapp_phone: string | null; wa_provider_alerts: boolean }[]>`select whatsapp_phone, wa_provider_alerts from users where id = ${roberto.id}`;
    try {
      await sql()`update users set whatsapp_phone = null, wa_provider_alerts = false where id = ${roberto.id}`;
      // Sin activar: no hay aviso por WhatsApp
      const t0 = new Date();
      const newReq = async (title: string) => requests.createRequest(ana, {
        propertyId: await propertyOf("ana", "Casa"), categoryId: await catId("plomeria"), title, description: "Gotea la canilla y pierde agua abajo de la mesada.",
        answers: {}, urgency: "normal", preferredWindows: [],
      });
      await newReq("Pedido sin avisos");
      expect(await waOutboxFor(roberto.id, t0)).toHaveLength(0);

      // Código inválido: no vincula
      await handleInbound(msg(phone, "Mi código: 000000"));
      expect((await alertsState(roberto.id)).on).toBe(false);

      // Código válido desde su teléfono: vincula y activa
      const code = await createAlertsCode(roberto);
      await handleInbound(msg(phone, `Quiero recibir los pedidos de Fixy por WhatsApp. Mi código: ${code}`));
      expect(await alertsState(roberto.id)).toEqual({ linked: true, phoneTail: phone.slice(-4), on: true });
      // El código es de un solo uso
      const other = `54911${String(Date.now() + 3).slice(-8)}`;
      await handleInbound(msg(other, `Mi código: ${code}`));
      expect((await alertsState(roberto.id)).phoneTail).toBe(phone.slice(-4));

      // El emparejamiento invita a los mejor ubicados y rota: con otras pruebas corriendo a la vez, puede no tocarle en el primer pedido.
      let t1 = new Date();
      let reqId = await newReq("Pedido con avisos");
      for (let i = 0; i < 6 && !(await sql()`select 1 from request_invitations where request_id = ${reqId} and provider_id = ${pid}`).length; i++) {
        t1 = new Date();
        reqId = await newReq("Pedido con avisos");
      }
      const sent = await waOutboxFor(roberto.id, t1);
      expect(sent).toHaveLength(1);
      expect(sent[0].template).toBe("newOpportunity");
      const [inv] = await sql()<{ id: string }[]>`select id from request_invitations where request_id = ${reqId} and provider_id = ${pid}`;
      expect(sent[0].requestId).toBe(inv.id);

      // Baja
      await handleInbound(msg(phone, "BAJA"));
      expect((await alertsState(roberto.id)).on).toBe(false);
      const t2 = new Date();
      await newReq("Pedido después de la baja");
      expect(await waOutboxFor(roberto.id, t2)).toHaveLength(0);
    } finally {
      await sql()`update users set whatsapp_phone = ${before[0].whatsapp_phone}, wa_provider_alerts = ${before[0].wa_provider_alerts} where id = ${roberto.id}`;
    }
  });
});
