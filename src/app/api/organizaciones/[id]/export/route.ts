import { getActor } from "@/server/auth/session";
import { getOrganization, orgJobs, type OrgFilters } from "@/server/queries/org";
import { jobStatusLabel } from "@/server/domain/labels";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Evita inyección de fórmulas en planillas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const pesos = (minor: number) => (minor / 100).toFixed(2).replace(".", ",");

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new Response("No autorizado", { status: 401 });
  const { id } = await ctx.params;
  const org = await getOrganization(actor.id, id);
  if (!org) return new Response("No encontrado", { status: 404 });
  const sp = new URL(req.url).searchParams;
  const f: OrgFilters = {};
  for (const k of ["from", "to", "providerId", "categoryId", "status", "siteId"] as const) {
    const v = sp.get(k);
    if (v) f[k] = v;
  }
  const rows = await orgJobs(actor.id, id, f);
  const header = ["Fecha", "Código", "Sede", "Trabajo", "Categoría", "Proveedor", "Responsable", "Estado", "Contratado ARS", "Pagado ARS", "Reembolsado ARS"];
  const lines = rows.map((r) => [new Date(r.date).toISOString().slice(0, 10), r.code, r.site, r.title, r.category ?? "", r.provider, r.responsible ?? "", jobStatusLabel[r.status], pesos(r.contracted_minor), pesos(r.paid_minor), pesos(r.refunded_minor)].map(esc).join(";"));
  const csv = "﻿" + [header.join(";"), ...lines].join("\r\n");
  return new Response(csv, {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fixy-${org.org.name.replace(/[^\w]+/g, "-").toLowerCase()}-trabajos.csv"`, "cache-control": "no-store" },
  });
}
