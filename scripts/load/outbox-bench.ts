import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
(async () => {
  const { sql } = await import("@/server/db/client");
  const { processOutbox } = await import("@/server/notifications");
  const [u] = await sql()<{ id: string }[]>`select id from users where email_verified and not sandbox and not email_placeholder and is_demo limit 1`;
  await sql()`update outbox set status = 'sent' where channel = 'email' and status in ('pending','failed','processing')`;
  const N = 3000;
  await sql()`insert into outbox (channel, recipient_user_id, payload) select 'email', ${u.id}, jsonb_build_object('subject', 'carga', 'text', 'x', 'link', null) from generate_series(1, ${N})`;
  const noop = { name: "carga", async send() { await new Promise((r) => setTimeout(r, 15)); } };
  const t = Date.now();
  const worker = async () => { let n = 0; for (;;) { const r = await processOutbox(100, noop); n += r.sent; if (!r.sent && !r.failed) return n; } };
  const counts = await Promise.all([worker(), worker(), worker(), worker()]);
  const secs = (Date.now() - t) / 1000;
  const [dups] = await sql()<{ n: number }[]>`select count(*)::int as n from (select outbox_id from delivery_attempts where adapter = 'carga' and ok group by outbox_id having count(*) > 1) x`;
  console.log(JSON.stringify({ enviados: counts.reduce((a, b) => a + b, 0), segundos: secs, porSegundo: Math.round(N / secs), duplicados: dups.n }));
  await sql().end();
})().catch((e) => { console.error(e); process.exit(1); });
