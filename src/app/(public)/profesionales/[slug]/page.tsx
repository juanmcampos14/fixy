/* eslint-disable @next/next/no-img-element */
import { SOCIAL_NETWORKS } from "@/lib/social";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BadgeCheck, Building2, ExternalLink, FileText, MapPin, UserRound } from "lucide-react";
import { getPublicProfile } from "@/server/queries/provider";
import { formatMoney, formatMonth, formatDate } from "@/lib/format";
import { ButtonLink } from "@/components/ui/button";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/category-icon";
import { Stars } from "@/components/provider/stars";
import { ProviderAvatar } from "@/components/domain/provider-avatar";
import { REGION_LABEL, groupZones } from "@/components/provider/constants";

export const dynamic = "force-dynamic";

const load = cache((slug: string) => getPublicProfile(slug));

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) return { title: "Profesional no encontrado" };
  return { title: d.provider.display_name, description: d.provider.description.slice(0, 160) };
}

export default async function PublicProviderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) notFound();
  const { provider: p, categories, zones, credentials, reviews, portfolio, rating } = d;
  const data = d;
  const verifications = [
    ...(p.identity_status === "verified" ? ["Identidad verificada"] : []),
    ...credentials.map((c) => `${c.name} vigente (revisada por Fixy)${c.expires_on ? ` · vence ${formatDate(c.expires_on)}` : ""}`),
  ];
  const cta = `/solicitar?proveedor=${encodeURIComponent(p.slug)}`;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
      {p.is_demo && (
        <p className="mb-5 rounded-2xl bg-warn-bg px-4 py-3 text-[15px] text-warn" role="note">
          Este es un perfil ficticio de demostración. Los datos, fotos y reseñas no corresponden a una persona o empresa real.
        </p>
      )}
      <header className="grid gap-6 rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line sm:p-8 md:grid-cols-[1fr_auto] md:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral" icon={false}>
              {p.kind === "company" ? <><Building2 className="h-3.5 w-3.5" aria-hidden /> Empresa</> : <><UserRound className="h-3.5 w-3.5" aria-hidden /> Profesional independiente</>}
            </Badge>
            {p.is_demo && <DemoBadge />}
            {!(p.status === "approved" && p.identity_status === "verified") && <Badge tone="warn" icon={false}>Todavía sin verificar</Badge>}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <ProviderAvatar url={p.avatarUrl} name={p.display_name} className="h-20 w-20 text-2xl sm:h-24 sm:w-24" />
            <h1 className="text-3xl font-extrabold sm:text-4xl">{p.display_name}</h1>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-muted">
            {rating.average != null ? <Stars rating={rating.average} /> : <span>Todavía sin reseñas</span>}
            {rating.count > 0 && <span>{rating.count} {rating.count === 1 ? "reseña" : "reseñas"} de trabajos completados</span>}
            {p.years_experience != null && <span>· {p.years_experience} {p.years_experience === 1 ? "año" : "años"} de experiencia</span>}
          </p>
          <p className="mt-4 whitespace-pre-line text-[16px] leading-relaxed text-ink-2">{p.description}</p>
          {SOCIAL_NETWORKS.some((n) => p.social_links?.[n.key]) && (
            <ul aria-label="Redes y sitio web" className="mt-4 flex flex-wrap gap-2">
              {SOCIAL_NETWORKS.filter((n) => p.social_links?.[n.key]).map((n) => (
                <li key={n.key}>
                  <a href={p.social_links[n.key]} target="_blank" rel="nofollow ugc noopener noreferrer"
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-semibold text-fixy-800 ring-1 ring-line hover:ring-fixy-500">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />{n.label}<span className="sr-only"> de {p.display_name} (se abre en otra pestaña)</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="md:w-56">
          <div className="mb-3 rounded-2xl bg-white p-4 text-center ring-1 ring-line">
            <p className="text-xs text-muted">Visita</p>
            <p className="tabular font-display text-2xl font-extrabold">{data.visit.visit_fee_minor > 0 ? formatMoney(data.visit.visit_fee_minor) : "Sin cargo"}</p>
            {data.visit.visit_fee_minor > 0 && data.visit.visit_fee_credited && <p className="text-xs text-ok">Se descuenta si contratás el arreglo</p>}
          </div>
          <ButtonLink href={cta} size="lg" className="w-full">Pedir una visita</ButtonLink>
          <p className="mt-2 text-center text-sm text-muted">Ve el problema y te presupuesta en la app.</p>
        </div>
      </header>

      <div className="mt-6 grid gap-6 md:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-6">
          {data.priceRefs.length > 0 && (
            <section aria-labelledby="pr-t" className="rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line">
              <h2 id="pr-t" className="text-lg font-bold">Precios de referencia</h2>
              <p className="mt-0.5 text-sm text-muted">Orientativos: el precio final se confirma después de ver el trabajo y lo aprobás en la app.</p>
              <ul className="mt-3 divide-y divide-line">
                {data.priceRefs.map((r) => (
                  <li key={r.title} className="flex flex-wrap justify-between gap-3 py-2.5 text-[15px]">
                    <span><span className="font-semibold">{r.title}</span> <span className="text-sm text-muted">· {r.category}{r.note ? ` · ${r.note}` : ""}</span></span>
                    <span className="tabular whitespace-nowrap font-semibold">desde {formatMoney(r.from_minor)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {portfolio.length > 0 && (
            <section aria-labelledby="pf-t" className="rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line">
              <h2 id="pf-t" className="text-lg font-bold">Trabajos realizados</h2>
              <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {portfolio.map((x) => (
                  <li key={x.id}>
                    <figure>
                      {x.isPdf ? (
                        <a href={x.url} target="_blank" rel="noreferrer" className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl bg-white p-3 text-center text-sm text-ink-2 ring-1 ring-line hover:ring-fixy-500">
                          <FileText className="h-8 w-8 text-fixy-700" aria-hidden /><span className="line-clamp-2 break-all">{x.caption || "Ver PDF"}</span>
                        </a>
                      ) : (
                        <img src={x.url} alt={x.caption || `Trabajo de ${p.display_name}`} className="aspect-[4/3] w-full rounded-2xl object-cover ring-1 ring-line" loading="lazy" />
                      )}
                      {x.caption && <figcaption className="mt-1 text-sm text-muted">{x.caption}</figcaption>}
                    </figure>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="rv-t" className="rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line">
            <h2 id="rv-t" className="text-lg font-bold">Reseñas</h2>
            <p className="mt-0.5 text-sm text-muted">Solo de clientes con trabajos completados en Fixy.</p>
            {reviews.length === 0 ? (
              <p className="mt-4 text-muted">Todavía no hay reseñas.</p>
            ) : (
              <ul className="mt-4 divide-y divide-line">
                {reviews.map((r) => (
                  <li key={r.id} className="py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Stars rating={r.rating} />
                      <span className="flex items-center gap-2 text-sm text-muted">{r.is_demo && <DemoBadge />}{formatMonth(r.published_month)}</span>
                    </div>
                    {r.comment && <p className="mt-2 text-[15px]">{r.comment}</p>}
                    {r.provider_reply && (
                      <div className="mt-3 rounded-2xl bg-cream/70 p-3 text-[15px] ring-1 ring-line">
                        <p className="text-xs font-semibold text-fixy-800">Respuesta de {p.display_name}</p>
                        <p className="mt-0.5 whitespace-pre-line">{r.provider_reply}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section aria-labelledby="vf-t" className="rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line">
            <h2 id="vf-t" className="text-lg font-bold">Verificaciones</h2>
            {verifications.length === 0 ? (
              <p className="mt-2 text-[15px] text-muted">Sin verificaciones específicas para mostrar.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-[15px]">
                {verifications.map((v) => (
                  <li key={v} className="flex gap-2"><BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />{v}</li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">Mostramos solo lo que el equipo de Fixy revisó. No incluye antecedentes ni seguros.</p>
          </section>

          <section aria-labelledby="sp-t" className="rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line">
            <h2 id="sp-t" className="text-lg font-bold">Especialidades</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {categories.map((c) => (
                <li key={c.id} className="inline-flex items-center gap-1.5 rounded-full bg-fixy-50 px-3 py-1.5 text-sm font-semibold text-fixy-800">
                  <CategoryIcon icon={c.icon} className="h-4 w-4" />{c.name}
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="zn-t" className="rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line">
            <h2 id="zn-t" className="flex items-center gap-2 text-lg font-bold"><MapPin className="h-5 w-5 text-fixy-700" aria-hidden /> Zonas de cobertura</h2>
            {zones.length === 0 ? <p className="mt-2 text-muted">Sin zonas informadas.</p> : (
              <dl className="mt-3 space-y-3 text-[15px]">
                {groupZones(zones).map(([region, zs]) => (
                  <div key={region}>
                    <dt className="text-sm font-semibold text-muted">{REGION_LABEL[region] ?? region}</dt>
                    <dd>{zs.map((z) => z.name).join(", ")}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
