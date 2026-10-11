import Link from "next/link";
import { requireActor } from "@/server/auth/session";
import { asUser } from "@/server/db/client";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty";
import { markAllReadAction } from "@/app/shared-actions";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Notificaciones" };

export default async function Notifications() {
  const actor = await requireActor();
  const items = await asUser(actor.id, (tx) => tx<{ id: string; title: string; body: string; link: string | null; read_at: Date | null; created_at: Date }[]>`
    select id, title, body, link, read_at, created_at from notifications order by created_at desc limit 100`);
  const unread = items.filter((i) => !i.read_at).length;
  return (
    <>
      <PageHeader title="Notificaciones" description={unread ? `${unread} sin leer` : "Estás al día."}
        action={unread ? <form action={markAllReadAction}><button className="rounded-full px-4 py-2 text-sm font-semibold text-fixy-800 hover:bg-fixy-50">Marcar todo como leído</button></form> : undefined} />
      {items.length === 0 ? <EmptyState title="Sin notificaciones" description="Te avisamos acá cada novedad de tus pedidos y trabajos." /> : (
        <ul className="space-y-2">
          {items.map((n) => {
            const inner = (
              <>
                <span className={cn("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-spark")} aria-hidden />
                <span className="min-w-0">
                  <span className={cn("block", !n.read_at && "font-semibold")}>{n.title}{!n.read_at && <span className="sr-only"> (sin leer)</span>}</span>
                  {n.body && <span className="block text-sm text-ink-2">{n.body}</span>}
                  <span className="block text-xs text-muted">{relativeTime(n.created_at)}</span>
                </span>
              </>
            );
            return <li key={n.id}>{n.link ? <Link href={n.link} className="flex gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line hover:ring-fixy-500">{inner}</Link> : <div className="flex gap-3 rounded-2xl bg-surface p-4 ring-1 ring-line">{inner}</div>}</li>;
          })}
        </ul>
      )}
    </>
  );
}
