import type { Metadata } from "next";
import { cookies } from "next/headers";
import { sql } from "@/server/db/client";
import { getActor } from "@/server/auth/session";
import { listCategories, listZones } from "@/server/modules/catalog";
import { claimDraft, DRAFT_COOKIE } from "@/server/modules/requests";
import { PublicHeader } from "@/components/layout/public-header";
import { ChatRequest } from "./chat-request";
import type { RequestPayload } from "./actions";

export const metadata: Metadata = { title: "Pedí un profesional" };

export default async function SolicitarPage({ searchParams }: { searchParams: Promise<{ q?: string; categoria?: string; proveedor?: string; borrador?: string; antecedente?: string }> }) {
  const sp = await searchParams;
  const db = sql();
  const actor = await getActor();
  const [categories, zones] = await Promise.all([listCategories(db), listZones(db)]);
  const questions = await db<{ category_id: string; key: string; label: string; kind: "text" | "select" | "boolean"; options: string[]; required: boolean }[]>`
    select category_id, key, label, kind, options, required from service_questions order by sort`;

  let draft: RequestPayload | null = null;
  const token = (await cookies()).get(DRAFT_COOKIE)?.value;
  if (actor && token) draft = (await claimDraft(token, actor.id)) as RequestPayload | null;

  const properties = actor
    ? await db<{ id: string; label: string; kind: string; zone_id: string; zone_name: string; organization_id: string | null; org_name: string | null }[]>`
        select p.id, p.label, p.kind, p.zone_id, z.name as zone_name, p.organization_id, o.name as org_name
        from properties p join zones z on z.id = p.zone_id left join organizations o on o.id = p.organization_id
        where p.archived_at is null and (p.owner_user_id = ${actor.id} or p.organization_id in (select organization_id from organization_members where user_id = ${actor.id}))
        order by p.organization_id nulls first, p.label`
    : [];
  const orgMembers = actor?.organizations.length
    ? await db<{ organization_id: string; user_id: string; full_name: string }[]>`
        select m.organization_id, m.user_id, u.full_name from organization_members m join users u on u.id = m.user_id
        where m.organization_id in (select organization_id from organization_members where user_id = ${actor.id}) order by u.full_name`
    : [];
  const target = sp.proveedor
    ? (await db<{ slug: string; display_name: string }[]>`select slug, display_name from providers where slug = ${sp.proveedor} and status = 'approved'`)[0] ?? null
    : null;
  let previous: { id: string; code: string; title: string; property_id: string; category_slug: string | null } | null = null;
  if (actor && sp.antecedente) {
    const [p] = await db<{ id: string; code: string; title: string; property_id: string; category_slug: string | null; ok: boolean }[]>`
      select j.id, j.code, r.title, j.property_id, c.slug as category_slug, app.is_job_client(${actor.id}, j.id) as ok
      from jobs j join service_requests r on r.id = j.request_id left join categories c on c.id = j.category_id where j.id = ${sp.antecedente}`;
    if (p?.ok) previous = p;
  }

  return (
    <>
      <PublicHeader />
      <main id="contenido" className="min-h-dvh bg-cream px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
        <ChatRequest
          loggedIn={!!actor}
          categories={categories}
          questions={questions.map((q) => ({ ...q, options: q.options ?? [] }))}
          zones={zones}
          properties={properties}
          orgMembers={orgMembers}
          initialText={sp.q ?? ""}
          initialCategory={sp.categoria ?? previous?.category_slug ?? null}
          draft={draft}
          target={target}
          previous={previous}
        />
      </main>
    </>
  );
}
