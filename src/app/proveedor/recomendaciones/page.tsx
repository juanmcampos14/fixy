import type { Metadata } from "next";
import { Share2 } from "lucide-react";
import { requireProviderContext } from "@/server/queries/provider";
import { sql } from "@/server/db/client";
import { env } from "@/server/env";
import { getSetting } from "@/server/modules/catalog";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Recomendaciones" };

const STATUS: Record<string, { label: string; tone: "info" | "ok" | "neutral" }> = {
  proposed: { label: "Esperando al cliente", tone: "info" },
  accepted: { label: "El cliente aceptó", tone: "ok" },
  declined: { label: "El cliente eligió otro", tone: "neutral" },
};
const PAYOUT: Record<string, string> = { pending: "En camino a tu saldo", scheduled: "En un retiro", processing: "En un retiro", paid: "Cobrado", failed: "En revisión", reversed: "Revertido" };

export default async function ReferralsPage() {
  const { provider } = await requireProviderContext({ adminOnly: true });
  const db = sql();
  const [made, received, [{ slug }], fee] = await Promise.all([
    db<{ id: string; code: string; title: string; to_name: string; status: string; created_at: Date; job_status: string | null; earned: number | null; payout_status: string | null }[]>`
      select pr.id, r.code, r.title, t.display_name as to_name, pr.status, pr.created_at,
        (select j.status from jobs j where j.request_id = pr.request_id and j.provider_id = pr.to_provider_id and j.status <> 'cancelled' limit 1) as job_status,
        (select po.amount_minor from payouts po join jobs j on j.id = po.job_id where po.kind = 'referral' and po.provider_id = ${provider.id} and j.request_id = pr.request_id limit 1) as earned,
        (select po.status from payouts po join jobs j on j.id = po.job_id where po.kind = 'referral' and po.provider_id = ${provider.id} and j.request_id = pr.request_id limit 1) as payout_status
      from provider_referrals pr join service_requests r on r.id = pr.request_id join providers t on t.id = pr.to_provider_id
      where pr.from_provider_id = ${provider.id} order by pr.created_at desc limit 100`,
    db<{ id: string; code: string; from_name: string; status: string; created_at: Date }[]>`
      select pr.id, r.code, f.display_name as from_name, pr.status, pr.created_at
      from provider_referrals pr join service_requests r on r.id = pr.request_id join providers f on f.id = pr.from_provider_id
      where pr.to_provider_id = ${provider.id} order by pr.created_at desc limit 100`,
    db<{ slug: string }[]>`select slug from providers where id = ${provider.id}`,
    getSetting<number>(db, "referrals.fee_bps", 1000),
  ]);
  const pct = Number(fee) / 100;
  const earned = made.reduce((s, m) => s + (m.payout_status === "paid" ? m.earned ?? 0 : 0), 0);
  const pending = made.reduce((s, m) => s + (m.payout_status && m.payout_status !== "paid" ? m.earned ?? 0 : 0), 0);
  const inviteUrl = `${env().APP_URL.replace(/\/$/, "")}/sumate?ref=${slug}`;
  const shareText = `Te paso Fixy: recibís pedidos de tu oficio en tu zona y Fixy no te cobra comisión. Sumate desde acá: ${inviteUrl}`;

  return (
    <>
      <PageHeader title="Recomendaciones" description={`Cuando no podés tomar un pedido, recomendá a un colega. Si el cliente acepta y tu colega hace el trabajo, ganás el ${pct} % de lo que él cobre.`} />
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Recomendaciones hechas" value={made.length} hint={`${made.filter((m) => m.status === "accepted").length} aceptadas por el cliente`} />
          <Stat label="Ganado y cobrado" value={formatMoney(earned)} tone="ok" />
          <Stat label="En camino" value={formatMoney(pending)} hint="Se suma a tu saldo con la reseña del cliente" />
        </div>

        <Card>
          <CardHeader title="Sumá a tus colegas a Fixy" description="Así los podés recomendar cuando no llegás con un trabajo. A ellos tampoco les cobramos comisión." />
          <code className="block break-all rounded-xl bg-cream px-3 py-2 text-sm">{inviteUrl}</code>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-2 rounded-full bg-fixy-700 px-4 py-2 font-semibold text-white">
            <Share2 className="h-4 w-4" aria-hidden />Compartir por WhatsApp
          </a>
        </Card>

        <Card>
          <CardHeader title="Las que hiciste" />
          {made.length ? (
            <ul className="divide-y divide-line">
              {made.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="font-semibold">{m.to_name} <span className="font-normal text-muted">· pedido {m.code}</span></p>
                    <p className="text-sm text-muted">{formatDate(m.created_at)}{m.job_status === "completed" ? " · trabajo terminado" : m.job_status ? " · trabajo en curso" : ""}</p>
                  </div>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={STATUS[m.status]?.tone ?? "neutral"} icon={false}>{STATUS[m.status]?.label ?? m.status}</Badge>
                    {m.earned != null && <Badge tone="ok" icon={false}>{formatMoney(m.earned)} · {PAYOUT[m.payout_status ?? ""] ?? ""}</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="Todavía no recomendaste a nadie" description="Cuando no puedas tomar un pedido, elegí “No puedo tomarlo” y recomendá a un colega." />}
        </Card>

        {received.length > 0 && (
          <Card>
            <CardHeader title="Te recomendaron" description={`Si hacés el trabajo, quien te recomendó recibe el ${pct} % de lo que cobres por ese trabajo.`} />
            <ul className="divide-y divide-line">
              {received.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <p><span className="font-semibold">{r.from_name}</span> <span className="text-muted">· pedido {r.code} · {formatDate(r.created_at)}</span></p>
                  <Badge tone={STATUS[r.status]?.tone ?? "neutral"} icon={false}>{STATUS[r.status]?.label ?? r.status}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
