import { REGION_LABEL } from "@/lib/regions";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Banknote, CalendarCheck, CircleCheck, EyeOff, FileCheck2, MapPin, MessageCircle, Search, Send, ShieldCheck, Star, Users } from "lucide-react";
import { sql } from "@/server/db/client";
import { getActor } from "@/server/auth/session";
import { Mascot } from "@/components/brand/mascot";
import { ButtonLink } from "@/components/ui/button";
import { CategoryIcon } from "@/components/category-icon";
import { CopyLink } from "./copy-link";
import { OFICIOS, type Oficio } from "@/lib/oficios";
import { formatMoney } from "@/lib/format";

const REGION = REGION_LABEL;

export async function SumateLanding({ oficio, refParam }: { oficio: Oficio | null; refParam?: string }) {
  const db = sql();
  const actor = await getActor();
  const ownApproved = actor?.providers.find((p) => p.role === "admin" && p.status === "approved");
  const ref = ownApproved?.slug ?? (refParam && /^[a-z0-9-]{3,60}$/.test(refParam) ? refParam : "");

  const [cat] = oficio?.category
    ? await db<{ id: string; name: string; icon: string }[]>`select id, name, icon from categories where slug = ${oficio.category} and active`
    : [];
  const credentials = cat
    ? await db<{ name: string }[]>`select ct.name from category_required_credentials rc join credential_types ct on ct.id = rc.credential_type_id where rc.category_id = ${cat.id}`
    : [];
  const [demand] = cat
    ? await db<{ n: number }[]>`select count(*)::int as n from service_requests where category_id = ${cat.id} and submitted_at > now() - interval '30 days'`
    : [{ n: 0 }];
  const zones = await db<{ name: string; region: string }[]>`select name, region from zones where active order by sort`;
  const categories = await db<{ slug: string; name: string; icon: string }[]>`select slug, name, icon from categories where active and not requires_review order by sort`;

  const origen = `sumate-${oficio?.slug ?? "general"}`;
  const signupHref = `/sumate/registrarme?origen=${origen}${ref ? `&ref=${ref}` : ""}`;
  const appUrl = (process.env.APP_URL ?? "https://www.fixy.solutions").replace(/\/$/, "");
  const shareUrl = `${appUrl}/sumate${oficio ? `/${oficio.slug}` : ""}${ref ? `?ref=${ref}` : ""}`;
  const shareText = oficio
    ? `Te paso Fixy: recibís pedidos de ${oficio.ejemplos} en tu zona y cobrás dentro de la plataforma. Para ${oficio.plural}: ${shareUrl}`
    : `Te paso Fixy: una plataforma para recibir pedidos de trabajos en tu zona y cobrar dentro de la plataforma: ${shareUrl}`;
  const exampleGross = 10_000_000;

  const steps = [
    { icon: Search, title: "Te eligen por tu perfil", text: "Los clientes de tu zona ven tus reseñas, verificaciones, el precio de tu visita y tus precios de referencia, y te eligen. Sin subastas con 50 personas." },
    { icon: CalendarCheck, title: "Aceptás y coordinás la visita", text: "Tenés unas horas para aceptar y proponer día y horario por el chat. La dirección se te comparte cuando el cliente confirma." },
    { icon: Banknote, title: "Presupuestás en el lugar", text: "Ves el problema y armás el presupuesto del arreglo desde la app, con tu precio. Fixy no te cobra comisión: cobrás el neto de tu presupuesto." },
    { icon: Star, title: "El cliente aprueba, paga y califica", text: "Todo pasa por Fixy: aprobación, pago, extras y conformidad. Con la reseña del cliente, el monto pasa a tu saldo y lo retirás una vez por mes." },
  ];
  const faqs: [string, string][] = [
    ["¿Cuánto cuesta sumarme?", "Nada. Ni alta, ni abono, ni comisión de Fixy. Cobrás el neto de tu presupuesto: solo se descuentan los costos de cobro de Mercado Pago y los impuestos del pago. Fixy se sostiene con un cargo de servicio que paga el cliente."],
    ["¿Qué necesito para empezar?", `Tu DNI, una descripción de tu trabajo, las zonas y horarios en los que trabajás, fotos de trabajos anteriores (recomendado) y, cuando quieras retirar, tus datos bancarios.${credentials.length ? ` Para este oficio también: ${credentials.map((c) => c.name.toLowerCase()).join(", ")} vigente.` : ""} Nuestro equipo revisa la documentación antes de habilitarte.`],
    ["¿Cobro la visita?", "Vos decidís: podés cobrarla, ofrecerla sin cargo, y descontarla del arreglo si el cliente te contrata. También publicás precios de referencia (\"desde\") para que el cliente sepa qué esperar."],
    ["¿Por qué no comparto mi teléfono?", "Para cuidarte: si todo queda en Fixy (chat, dirección, aprobaciones y pagos), podemos ayudarte ante un problema y tu reputación crece con cada trabajo."],
    ["¿Cómo funcionan las reseñas?", "Solo pueden calificarte clientes con trabajos completados. Las reseñas se publican de forma anónima y días después (el plazo varía), así el cliente opina con libertad y tu reputación refleja opiniones sinceras."],
    ["¿Cuándo cobro?", "Cuando el cliente da conformidad y deja su reseña, el monto pasa a tu saldo. Una vez por mes pedís retirar todo lo acumulado y te lo transferimos a tu cuenta a los 20 días. Si hay un reclamo, ese trabajo queda en pausa hasta que se resuelva."],
    ["¿Y si el cliente pide algo más en el lugar?", "Lo proponés como adicional desde la plataforma. El cliente lo acepta (o no) y se cobra aparte. Nunca se cambia el precio acordado sin su aprobación."],
    ["¿Trabajo solo o con mi empresa?", "Las dos cosas. Si tenés una empresa, podés sumar a tus técnicos: cada uno ve solo los trabajos que le asignás y no ve importes."],
  ];
  const byRegion = Object.entries(REGION).map(([r, label]) => ({ label, names: zones.filter((z) => z.region === r).map((z) => z.name) })).filter((g) => g.names.length);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-graphite text-white">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-fixy-500/20 blur-3xl" aria-hidden />
        <div className="absolute -bottom-32 left-10 h-80 w-80 rounded-full bg-spark/15 blur-3xl" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-8 px-4 py-14 sm:px-6 md:grid-cols-[1.3fr_1fr] md:py-20">
          <div className="motion-safe:animate-fade-up">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-fixy-800 ring-1 ring-white/15">
              {cat ? <CategoryIcon icon={cat.icon} className="h-4 w-4" /> : <Users className="h-4 w-4" aria-hidden />}
              {oficio ? `Para ${oficio.plural}` : "Para profesionales y empresas de servicios"}
            </p>
            <h1 className="text-[2.5rem] font-extrabold leading-[1.05] text-white sm:text-6xl">
              {oficio ? <>¿Sos {oficio.singular}?<br />Sumate a Fixy.</> : <>Tu oficio,<br />más oportunidades.</>}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-white/80">
              Recibí pedidos de {oficio ? oficio.ejemplos : "hogares, oficinas y comercios"} en tu zona, en toda la Argentina. Los clientes te eligen por tu perfil, presupuestás en el lugar con tu precio y Fixy se ocupa de la coordinación y el cobro.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <ButtonLink href={signupHref} size="lg" variant="secondary">Quiero sumarme <ArrowRight className="h-5 w-5" aria-hidden /></ButtonLink>
              <ButtonLink href="#como-funciona" size="lg" variant="ghost" className="text-white ring-1 ring-inset ring-white/30 hover:bg-white/10">Cómo funciona</ButtonLink>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[15px] text-white/85">
              {["Alta sin costo", "0 % de comisión de Fixy", "Retirás tu saldo una vez por mes"].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><CircleCheck className="h-4 w-4 text-fixy-800" aria-hidden />{t}</li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-xs">
            <Mascot pose="wave" priority className="relative mx-auto h-72 w-auto sm:h-80" />
          </div>
        </div>
      </section>

      {demand.n >= 10 && cat && (
        <section className="mx-auto -mt-6 max-w-6xl px-4 sm:px-6">
          <div className="relative rounded-2xl bg-surface p-4 text-center shadow-[var(--shadow-card)] ring-1 ring-line">
            <p className="font-semibold">{demand.n} pedidos de {cat.name.toLowerCase()} en los últimos 30 días.</p>
          </div>
        </section>
      )}

      {/* Cómo funciona */}
      <section id="como-funciona" aria-labelledby="cf-t" className="mx-auto mt-16 max-w-6xl scroll-mt-20 px-4 sm:px-6">
        <h2 id="cf-t" className="text-2xl font-extrabold sm:text-3xl">Así trabajás con Fixy</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <li key={s.title} className="rounded-[var(--radius-card)] bg-surface p-5 ring-1 ring-line">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-graphite font-display font-bold text-white">{i + 1}</span>
                <s.icon className="h-5 w-5 text-fixy-800" aria-hidden />
              </div>
              <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
              <p className="mt-1 text-[15px] text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Reseñas */}
      <section aria-labelledby="rs-t" className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-6 rounded-[32px] bg-gradient-to-br from-fixy-50 via-surface to-cream-2 p-6 ring-1 ring-line sm:p-10 md:grid-cols-[1fr_auto]">
          <div>
            <h2 id="rs-t" className="text-2xl font-extrabold sm:text-3xl">Una reputación que vale</h2>
            <ul className="mt-5 space-y-3 text-[15px] text-ink-2">
              <li className="flex gap-3"><BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-800" aria-hidden /><span><strong className="text-ink">Solo clientes reales:</strong> únicamente califica quien contrató y completó un trabajo con vos en Fixy.</span></li>
              <li className="flex gap-3"><EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-fixy-800" aria-hidden /><span><strong className="text-ink">Anónimas y diferidas:</strong> se publican días después y sin datos del cliente. Así cada opinión es sincera, y tu reputación también.</span></li>
              <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-800" aria-hidden /><span><strong className="text-ink">Podés responder:</strong> una respuesta pública por reseña, para contar tu versión con respeto.</span></li>
            </ul>
          </div>
          <Mascot pose="celebrate" className="mx-auto hidden h-48 w-auto md:block" />
        </div>
      </section>

      {/* Sin comisión + requisitos */}
      <section className="mx-auto mt-16 grid max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-2">
        <article aria-labelledby="com-t" className="rounded-[var(--radius-card)] bg-surface p-6 ring-1 ring-line sm:p-8">
          <h2 id="com-t" className="text-2xl font-extrabold">0 % de comisión de Fixy</h2>
          <p className="mt-2 text-ink-2">Sin costo de alta, sin abono y <strong>sin comisión de Fixy</strong>. Cobrás el neto de tu presupuesto: solo se descuentan los costos de cobro de Mercado Pago y los impuestos del pago.</p>
          <figure className="mt-5 rounded-2xl bg-cream/60 p-4 ring-1 ring-line">
            <figcaption className="mb-2 text-sm font-semibold text-muted">Ejemplo</figcaption>
            <dl className="tabular divide-y divide-line text-[15px]">
              <div className="flex justify-between py-2"><dt>Tu presupuesto</dt><dd>{formatMoney(exampleGross)}</dd></div>
              <div className="flex justify-between py-2"><dt>Comisión Fixy</dt><dd className="font-semibold text-ok">$ 0</dd></div>
              <div className="flex justify-between py-2"><dt>Costos de Mercado Pago e impuestos del cobro</dt><dd className="text-muted">según medio de pago</dd></div>
              <div className="flex justify-between py-2.5 text-lg font-bold"><dt>Te queda</dt><dd>el neto</dd></div>
            </dl>
          </figure>
          <p className="mt-3 text-xs text-muted">Fixy se sostiene con un cargo de servicio que paga el cliente, aparte de tu presupuesto. Los costos de Mercado Pago dependen del medio de pago y del plazo de acreditación; los ves en cada cobro.</p>
        </article>
        <article aria-labelledby="req-t" className="rounded-[var(--radius-card)] bg-surface p-6 ring-1 ring-line sm:p-8">
          <h2 id="req-t" className="text-2xl font-extrabold">Qué necesitás</h2>
          <ul className="mt-4 space-y-3 text-[15px]">
            <li className="flex gap-3"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-fixy-800" aria-hidden />DNI (lo revisa nuestro equipo; no se publica).</li>
            {credentials.map((c) => <li key={c.name} className="flex gap-3"><BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-800" aria-hidden />{c.name} vigente (obligatoria para este oficio).</li>)}
            <li className="flex gap-3"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-fixy-800" aria-hidden />Las zonas y horarios en los que trabajás.</li>
            <li className="flex gap-3"><Banknote className="mt-0.5 h-5 w-5 shrink-0 text-fixy-800" aria-hidden />Tus datos bancarios (recién cuando retirás tu saldo).</li>
            <li className="flex gap-3"><Star className="mt-0.5 h-5 w-5 shrink-0 text-fixy-800" aria-hidden />Fotos de trabajos anteriores (recomendado).</li>
          </ul>
          <p className="mt-4 text-sm text-muted">El alta toma unos 15 minutos. Podés completarla de a partes y te avisamos cuando estés habilitado.</p>
        </article>
      </section>

      {/* Cobertura */}
      <section aria-labelledby="zon-t" className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
        <h2 id="zon-t" className="text-2xl font-extrabold sm:text-3xl">Dónde trabajamos</h2>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {byRegion.map((g) => (
            <div key={g.label} className="rounded-2xl bg-surface p-4 ring-1 ring-line">
              <p className="font-bold">{g.label}</p>
              <p className="mt-1 text-sm text-muted">{g.names.join(" · ")}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Invitar a un colega */}
      <section aria-labelledby="inv-t" className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
        <div className="rounded-[32px] bg-graphite p-6 text-white sm:p-10">
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="max-w-xl">
              <h2 id="inv-t" className="text-2xl font-extrabold text-white sm:text-3xl">¿Conocés a alguien que trabaje bien?</h2>
              <p className="mt-2 text-white/80">Pasale este enlace. {ownApproved ? "Si se suma desde tu enlace, queda registrado que llegó por vos." : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center gap-2 rounded-full bg-[#25D366] px-6 font-semibold text-onyx hover:brightness-95">
                <MessageCircle className="h-5 w-5" aria-hidden /> Compartir por WhatsApp
              </a>
              <CopyLink url={shareUrl} />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-t" className="mx-auto mt-16 max-w-3xl px-4 sm:px-6">
        <h2 id="faq-t" className="text-2xl font-extrabold sm:text-3xl">Preguntas frecuentes</h2>
        <div className="mt-6 divide-y divide-line rounded-[var(--radius-card)] bg-surface ring-1 ring-line">
          {faqs.map(([q, a]) => (
            <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fixy-50 text-fixy-800 transition group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-2 text-[15px] text-ink-2">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="mx-auto mt-16 max-w-3xl px-4 text-center sm:px-6">
        <h2 className="text-3xl font-extrabold sm:text-4xl">¿Arrancamos?</h2>
        <p className="mt-2 text-ink-2">Creá tu cuenta y completá tu perfil. Te avisamos cuando estés habilitado para recibir pedidos.</p>
        <ButtonLink href={signupHref} size="lg" className="mt-6"><Send className="h-5 w-5" aria-hidden />Quiero sumarme</ButtonLink>
      </section>

      {/* Otros oficios */}
      <nav aria-label="Otros oficios" className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
        <h2 className="text-lg font-bold">Buscamos profesionales de todos los oficios</h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {OFICIOS.filter((o) => o.slug !== oficio?.slug).map((o) => {
            const c = categories.find((x) => x.slug === o.category);
            return (
              <li key={o.slug}>
                <Link href={`/sumate/${o.slug}${ref ? `?ref=${ref}` : ""}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-surface px-4 text-sm font-semibold ring-1 ring-line hover:ring-fixy-500">
                  {c ? <CategoryIcon icon={c.icon} className="h-4 w-4 text-fixy-800" /> : <Users className="h-4 w-4 text-fixy-800" aria-hidden />}
                  {o.plural.charAt(0).toUpperCase() + o.plural.slice(1)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
