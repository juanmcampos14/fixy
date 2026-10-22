/** Cola de avisos con lease (auditoría M-07): sin locks durante la red, recuperable y sin duplicados. */
import { describe, expect, it } from "vitest";
import { sql, systemTx } from "@/server/db/client";
import { notify, processOutbox, type EmailAdapter } from "@/server/notifications";
import { claimOutbox, replayOutbox } from "@/server/outbox/lease";
import { actor } from "./helpers";

const counting = (fail = false) => {
  const sent: string[] = [];
  const adapter: EmailAdapter = {
    name: "test",
    async send(msg) {
      await new Promise((r) => setTimeout(r, 20)); // simula la red
      if (fail) throw new Error("proveedor caído");
      sent.push(msg.subject);
    },
  };
  return { adapter, sent };
};

async function queue(subject: string) {
  const ana = await actor("ana");
  await systemTx((tx) => notify(tx, [ana.id], { type: "message", title: subject, body: "x" }));
  const [o] = await sql()<{ id: string }[]>`select id from outbox where channel = 'email' and payload->>'subject' like ${`%${subject}%`} order by created_at desc limit 1`;
  return o.id;
}
const statusOf = async (id: string) => (await sql()<{ status: string; attempts: number }[]>`select status, attempts from outbox where id = ${id}`)[0];

describe("cola de avisos con lease", () => {
  it("dos procesadores a la vez envían cada aviso una sola vez", async () => {
    await sql()`update outbox set status = 'sent' where channel = 'email' and status in ('pending','failed','processing')`;
    const ids = await Promise.all(["Lease A", "Lease B", "Lease C"].map(queue));
    const c = counting();
    await Promise.all([processOutbox(10, c.adapter), processOutbox(10, c.adapter)]);
    expect(c.sent.filter((s) => s.includes("Lease")).length).toBe(3);
    for (const id of ids) expect((await statusOf(id)).status).toBe("sent");
  });

  it("si el proveedor falla, reintenta con espera; al agotar intentos queda sin enviar y se puede reintentar a mano", async () => {
    const id = await queue("Lease falla");
    await sql()`update outbox set status = 'sent' where channel = 'email' and status in ('pending','failed') and id <> ${id}`;
    const c = counting(true);
    await processOutbox(10, c.adapter);
    const s1 = await sql()<{ status: string; attempts: number; later: boolean }[]>`select status, attempts, next_attempt_at > now() as later from outbox where id = ${id}`;
    expect(s1[0]).toEqual({ status: "failed", attempts: 1, later: true });
    await sql()`update outbox set attempts = 6, next_attempt_at = now() where id = ${id}`;
    await processOutbox(10, c.adapter);
    expect((await statusOf(id)).status).toBe("dead");
    expect(await replayOutbox(id)).toBe(true);
    await processOutbox(10, counting().adapter);
    expect((await statusOf(id)).status).toBe("sent");
  });

  it("un procesador que se cae deja el aviso reservado hasta que vence el lease; después lo retoma otro", async () => {
    const id = await queue("Lease caído");
    await sql()`update outbox set status = 'sent' where channel = 'email' and status in ('pending','failed') and id <> ${id}`;
    const claimed = await claimOutbox("email", 10);
    expect(claimed.map((r) => r.id)).toContain(id); // reservado... y el proceso "muere" acá
    const c = counting();
    await processOutbox(10, c.adapter);
    expect((await statusOf(id)).status).toBe("processing"); // nadie lo toca mientras el lease está vigente
    await sql()`update outbox set lease_until = now() - interval '1 second' where id = ${id}`;
    await processOutbox(10, c.adapter);
    expect((await statusOf(id)).status).toBe("sent");
    expect(c.sent.filter((s) => s.includes("Lease caído"))).toHaveLength(1);
  });
});
