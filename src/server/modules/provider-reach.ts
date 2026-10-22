/**
 * "¿Por qué te llegan (o no) pedidos?": explica al profesional, en palabras simples, qué lo deja afuera del
 * emparejamiento y qué lo sube en la lista (ver findCandidatesFor en requests.ts). Solo lee: no cambia nada.
 */
import type { Db } from "@/server/db/client";
import { profileStrength } from "@/lib/profile-strength";
import { profileFacts } from "./providers";

export type ReachTip = { key: string; kind: "blocker" | "boost"; title: string; detail: string; href: string; action: string };

export type ProviderReach = {
  tips: ReachTip[];
  stats: { demand30d: number; invitations30d: number; answered30d: number };
  categories: { id: string; name: string; primary: boolean; rating: number | null; reviews: number; demand30d: number; invitations30d: number }[];
  missedZones: { name: string; requests: number }[];
};

export async function providerReach(db: Db, providerId: string): Promise<ProviderReach> {
  const [p] = await db<{ status: string; accepting_jobs: boolean; identity_status: string; max_active_jobs: number; active_jobs: number; slots: number; zones: number; base: boolean }[]>`
    select p.status, p.accepting_jobs, p.identity_status, p.max_active_jobs,
      (select count(*)::int from jobs j where j.provider_id = p.id and j.status in ('pending_confirmation','confirmed','on_the_way','in_progress','pending_approval')) as active_jobs,
      (select count(*)::int from provider_availability a where a.provider_id = p.id) as slots,
      (select count(*)::int from provider_zones z where z.provider_id = p.id) as zones,
      p.base_zone_id is not null as base
    from providers p where p.id = ${providerId}`;

  // Rubros con su demanda en las zonas que cubre, invitaciones recibidas y estrellas propias (últimos 30 días).
  const categories = await db<{ id: string; name: string; primary: boolean; rating: number | null; reviews: number; demand30d: number; invitations30d: number }[]>`
    select c.id, c.name, pc.is_primary as primary,
      (select round(avg(v.rating)::numeric, 1)::float from reviews_published v where v.provider_id = ${providerId} and v.category_id = c.id) as rating,
      (select count(*)::int from reviews_published v where v.provider_id = ${providerId} and v.category_id = c.id) as reviews,
      (select count(*)::int from service_requests r join properties pr on pr.id = r.property_id
         where r.category_id = c.id and r.status <> 'draft' and r.created_at > now() - interval '30 days'
           and pr.zone_id in (select zone_id from provider_zones where provider_id = ${providerId})) as "demand30d",
      (select count(*)::int from request_invitations i join service_requests r on r.id = i.request_id
         where i.provider_id = ${providerId} and r.category_id = c.id and i.created_at > now() - interval '30 days') as "invitations30d"
    from provider_categories pc join categories c on c.id = pc.category_id
    where pc.provider_id = ${providerId} order by pc.is_primary desc, c.sort, c.name`;

  const [stats] = await db<{ invitations30d: number; answered30d: number }[]>`
    select count(*)::int as "invitations30d",
      count(*) filter (where status = 'quoted' or exists (select 1 from quotes q where q.request_id = i.request_id and q.provider_id = i.provider_id and q.status <> 'draft'))::int as "answered30d"
    from request_invitations i where provider_id = ${providerId} and created_at > now() - interval '30 days'`;

  // Pedidos de su rubro principal en zonas que no cubre (para que decida si le conviene sumarlas).
  const primary = categories.find((c) => c.primary) ?? categories[0];
  const missedZones = primary
    ? await db<{ name: string; requests: number }[]>`
        select z.name, count(*)::int as requests from service_requests r join properties pr on pr.id = r.property_id join zones z on z.id = pr.zone_id
        where r.category_id = ${primary.id} and r.status <> 'draft' and r.created_at > now() - interval '30 days'
          and pr.zone_id not in (select zone_id from provider_zones where provider_id = ${providerId})
        group by z.name order by requests desc limit 3`
    : [];

  // Credenciales que exige algún rubro y no tiene vigentes (sin ellas no cuenta como verificado en ese rubro).
  const missingCreds = await db<{ category: string; credential: string }[]>`
    select c.name as category, ct.name as credential
    from provider_categories pc join categories c on c.id = pc.category_id
    join category_required_credentials rc on rc.category_id = pc.category_id join credential_types ct on ct.id = rc.credential_type_id
    where pc.provider_id = ${providerId} and not exists (
      select 1 from provider_documents d where d.provider_id = ${providerId} and d.credential_type_id = rc.credential_type_id
        and d.status = 'approved' and (d.expires_on is null or d.expires_on >= current_date))
    order by c.name`;

  const facts = (await profileFacts(db, [providerId])).get(providerId);
  const strength = facts ? profileStrength(facts) : null;

  const tips: ReachTip[] = [];
  const services = "/proveedor/alta#servicios";
  if (p.status === "rejected" || p.status === "suspended") {
    tips.push({ key: "status", kind: "blocker", title: "Tu perfil no está activo", detail: "Mientras esté así no te llegan pedidos. Escribinos para revisarlo.", href: "/ayuda", action: "Contactar a Fixy" });
  }
  if (!p.accepting_jobs) tips.push({ key: "paused", kind: "blocker", title: "Pausaste los pedidos", detail: "Activá «Acepto trabajos nuevos» para volver a recibirlos.", href: services, action: "Reactivar" });
  if (!categories.length) tips.push({ key: "cats", kind: "blocker", title: "No elegiste rubros", detail: "Sin rubros no aparecés en ningún pedido.", href: services, action: "Elegir rubros" });
  if (!p.zones) tips.push({ key: "zones", kind: "blocker", title: "No elegiste zonas", detail: "Solo te llegan pedidos de las zonas que marcás.", href: services, action: "Elegir zonas" });
  if (p.active_jobs >= p.max_active_jobs) {
    tips.push({ key: "max", kind: "blocker", title: `Tenés ${p.active_jobs} trabajos en curso: tu máximo`, detail: "Mientras estés al tope te mostramos últimos. Si podés con más, subí el máximo.", href: services, action: "Cambiar el máximo" });
  }
  if (p.identity_status !== "verified") {
    tips.push(p.identity_status === "pending"
      ? { key: "identity", kind: "boost", title: "Estamos revisando tu DNI", detail: "Cuando lo aprobemos vas a aparecer antes que los no verificados.", href: "/proveedor/alta#documentacion", action: "Ver estado" }
      : { key: "identity", kind: "boost", title: "Verificá tu identidad", detail: "Los profesionales verificados aparecen primero. Subí una foto de tu DNI.", href: "/proveedor/alta#documentacion", action: "Subir DNI" });
  }
  for (const m of missingCreds) {
    tips.push({ key: `cred-${m.category}`, kind: "boost", title: `Para ${m.category} te falta: ${m.credential}`, detail: "Sin esa credencial vigente no figurás como verificado en ese rubro.", href: "/proveedor/alta#documentacion", action: "Subirla" });
  }
  if (!p.slots) tips.push({ key: "slots", kind: "boost", title: "Cargá tus días y horarios", detail: "Cuando coinciden con los del cliente, subís en la lista.", href: services, action: "Cargar horarios" });
  if (!p.base) tips.push({ key: "base", kind: "boost", title: "Elegí tu zona base", detail: "Te priorizamos en los pedidos cerca de donde estás.", href: services, action: "Elegir zona base" });
  if (strength && strength.score < 80) {
    const next = strength.items.find((i) => i.earned < i.points);
    tips.push({ key: "strength", kind: "boost", title: `Tu perfil está completo al ${strength.score} %`, detail: next ? `Siguiente paso: ${next.label.toLowerCase()}. ${next.hint}` : "Completalo para subir en la lista.", href: next?.href ?? "/proveedor/perfil", action: "Completar" });
  }
  if (categories.length && categories.some((c) => c.reviews === 0) && categories.some((c) => c.reviews > 0)) {
    const fresh = categories.filter((c) => c.reviews === 0).map((c) => c.name).slice(0, 3).join(", ");
    tips.push({ key: "reviews", kind: "boost", title: "Pedí reseñas en tus otros rubros", detail: `Las estrellas son por rubro. Todavía no tenés reseñas en: ${fresh}.`, href: "/proveedor/resenas", action: "Ver reseñas" });
  }

  return {
    tips,
    stats: { demand30d: categories.reduce((s, c) => s + c.demand30d, 0), invitations30d: stats.invitations30d, answered30d: stats.answered30d },
    categories,
    missedZones,
  };
}
