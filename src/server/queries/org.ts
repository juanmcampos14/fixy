/** Lecturas de organizaciones: aisladas por RLS (solo miembros). */
import "server-only";
import { asUser } from "@/server/db/client";

export type OrgFilters = { from?: string; to?: string; providerId?: string; categoryId?: string; status?: string; siteId?: string };

export async function getOrganization(userId: string, orgId: string) {
  return asUser(userId, async (tx) => {
    const [org] = await tx<{ id: string; name: string; tax_id: string | null; billing_email: string | null; billing_address: string | null; contact_phone: string | null; is_demo: boolean; role: string | null }[]>`
      select o.*, app.org_role(${userId}, o.id) as role from organizations o where o.id = ${orgId}`;
    if (!org || !org.role) return null;
    const members = await tx<{ user_id: string; role: string; full_name: string }[]>`
      select m.user_id, m.role, u.full_name from organization_members m join user_names u on u.id = m.user_id where m.organization_id = ${orgId} order by m.role, u.full_name`;
    const sites = await tx<{ id: string; label: string; kind: string; zone_name: string; address_line: string; jobs: number; spent_minor: number }[]>`
      select p.id, p.label, p.kind, z.name as zone_name, p.address_line,
        (select count(*)::int from jobs j where j.property_id = p.id) as jobs,
        (select coalesce(sum(c.amount_minor - c.refunded_minor), 0)::bigint from charges c join jobs j on j.id = c.job_id where j.property_id = p.id and c.status in ('approved','partially_refunded','refunded')) as spent_minor
      from properties p join zones z on z.id = p.zone_id where p.organization_id = ${orgId} and p.archived_at is null order by p.label`;
    return { org, members, sites };
  });
}

export type OrgJobRow = { id: string; code: string; date: Date; site: string; title: string; category: string | null; provider: string; status: string; responsible: string | null; contracted_minor: number; paid_minor: number; refunded_minor: number };

/** Historial y gastos de la organización con filtros. Los miembros comunes ven solo lo que crearon o tienen asignado (RLS). */
export async function orgJobs(userId: string, orgId: string, f: OrgFilters) {
  return asUser(userId, (tx) => tx<OrgJobRow[]>`
    select j.id, j.code, j.created_at as date, p.label as site, r.title, c.name as category, pp.display_name as provider, j.status,
      coalesce(ru.full_name, cu.full_name) as responsible,
      (j.total_minor + coalesce((select sum(e.total_minor) from job_extras e where e.job_id = j.id and e.status = 'accepted'), 0))::bigint as contracted_minor,
      coalesce((select sum(ch.amount_minor) from charges ch where ch.job_id = j.id and ch.status in ('approved','partially_refunded','refunded')), 0)::bigint as paid_minor,
      coalesce((select sum(ch.refunded_minor) from charges ch where ch.job_id = j.id), 0)::bigint as refunded_minor
    from jobs j join service_requests r on r.id = j.request_id join properties p on p.id = j.property_id
    join provider_public pp on pp.id = j.provider_id left join categories c on c.id = j.category_id
    left join user_names ru on ru.id = r.responsible_user_id left join user_names cu on cu.id = r.created_by
    where j.organization_id = ${orgId}
      ${f.from ? tx`and j.created_at >= ${f.from}::date` : tx``}
      ${f.to ? tx`and j.created_at < (${f.to}::date + 1)` : tx``}
      ${f.providerId ? tx`and j.provider_id = ${f.providerId}` : tx``}
      ${f.categoryId ? tx`and j.category_id = ${f.categoryId}` : tx``}
      ${f.status ? tx`and j.status = ${f.status}` : tx``}
      ${f.siteId ? tx`and j.property_id = ${f.siteId}` : tx``}
    order by j.created_at desc limit 1000`);
}

export async function orgFilterOptions(userId: string, orgId: string) {
  return asUser(userId, async (tx) => ({
    providers: await tx<{ id: string; name: string }[]>`select distinct pp.id, pp.display_name as name from jobs j join provider_public pp on pp.id = j.provider_id where j.organization_id = ${orgId} order by 2`,
    categories: await tx<{ id: string; name: string }[]>`select distinct c.id, c.name from jobs j join categories c on c.id = j.category_id where j.organization_id = ${orgId} order by 2`,
  }));
}
