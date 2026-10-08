import Link from "next/link";
import { ArrowRight, Building2, House, MessageCircle, Receipt, ShieldCheck, ClipboardList, Search, CircleCheck } from "lucide-react";
import { sql } from "@/server/db/client";
import { listCategories } from "@/server/modules/catalog";
import { Mascot } from "@/components/brand/mascot";
import { ButtonLink } from "@/components/ui/button";
import { CategoryIcon } from "@/components/category-icon";
import { formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: MessageCircle, title: "Contanos qué pasa", text: "Describilo con tus palabras y sumá una foto si podés. Te hacemos solo las preguntas necesarias." },
  { icon: Search, title: "Recibí presupuestos", text: "Invitamos a un grupo acotado de profesionales que cubren tu zona y tu tipo de trabajo." },
  { icon: Receipt, title: "Compará y elegí", text: "Ves qué incluye cada propuesta, qué no incluye, el cargo de servicio y el total antes de confirmar." },
  { icon: ClipboardList, title: "Seguí el trabajo", text: "Mensajes, pagos, adicionales, avances y reclamos quedan registrados en Fixy." },
];

const FAQ = [
  ["¿Cuánto cuesta pedir presupuestos?", "Nada. Pedir y comparar presupuestos es gratis. Si contratás, ves el desglose completo antes de confirmar: mano de obra, materiales, visita, cargo de servicio de Fixy y total."],
  ["¿Cómo se paga?", "El pago se hace dentro de Fixy, a través de una pasarela de pagos. Fixy no guarda datos de tarjetas. En esta versión de prueba los pagos son simulados y no se mueve dinero real."],
  ["¿Fixy retiene el dinero hasta que termine el trabajo?", "No. Hoy no ofrecemos custodia de fondos. Te mostramos con claridad cuándo se cobra cada concepto y cómo funcionan las cancelaciones y los reclamos."],
  ["¿Qué significa que un profesional esté verificado?", "Mostramos solo verificaciones que revisamos: por ejemplo, identidad o una matrícula vigente cargada y aprobada por nuestro equipo. No mostramos verificaciones que no hicimos."],
  ["¿Y si no encuentro a nadie?", "Puede pasar: la cobertura inicial es CABA y GBA. Si no hay profesionales disponibles para tu pedido, te avisamos y una persona del equipo lo revisa."],
  ["No sé qué profesional necesito", "Elegí «No sé qué profesional necesito» y describí el problema. Una persona del equipo lo revisa y lo deriva."],
  ["¿Qué pasa si algo sale mal?", "Podés abrir un reclamo desde el trabajo, adjuntar evidencias y seguir el caso. Todo queda registrado en la plataforma."],
];

export default async function Landing() {
  const categories = await listCategories(sql());
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-14 pt-10 sm:px-6 md:grid-cols-[1.25fr_1fr] md:pb-20 md:pt-16">
          <div className="motion-safe:animate-fade-up">
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-semibold text-fixy-800 ring-1 ring-line">
              <span className="h-2 w-2 rounded-full bg-spark" aria-hidden /> Servicios para tu hogar y oficina
            </p>
            <h1 className="text-[2.6rem] font-extrabold leading-[1.05] sm:text-6xl">De problema a resuelto.</h1>
            <p className="mt-4 max-w-xl text-lg text-ink-2">Contanos qué pasa. Encontrá al profesional indicado, conocé el precio antes de contratar y gestioná todo desde un solo lugar.</p>
            <form action="/solicitar" method="get" className="mt-7 rounded-[28px] bg-white p-2 shadow-[var(--shadow-lift)] ring-1 ring-line">
              <label htmlFor="hero-q" className="sr-only">¿Qué necesitás resolver hoy?</label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input id="hero-q" name="q" placeholder="¿Qué necesitás resolver hoy? Ej.: pierde agua la canilla" className="h-14 min-w-0 flex-1 rounded-[22px] px-4 text-[17px] placeholder:text-[#7d8f93] focus:outline-none" autoComplete="off" maxLength={300} />
                <button className="inline-flex h-14 items-center justify-center gap-2 rounded-[22px] bg-fixy-700 px-6 font-semibold text-white hover:bg-fixy-800">
                  Empezar <ArrowRight className="h-5 w-5" aria-hidden />
                </button>
              </div>
            </form>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[15px] text-ink-2">
              {["Pedir presupuestos es gratis", "Precio claro antes de confirmar", "Todo queda registrado"].map((t) => (
                <li key={t} className="flex items-center gap-1.5"><CircleCheck className="h-4 w-4 text-fixy-700" aria-hidden />{t}</li>
              ))}
            </ul>
          </div>
          <div className="relative mx-auto w-full max-w-sm">
            <div className="absolute inset-x-6 bottom-2 top-10 -z-10 rounded-[48px] bg-gradient-to-br from-fixy-100 to-spark-100" aria-hidden />
            <Mascot pose="wave" priority className="mx-auto h-72 w-auto sm:h-96" />
          </div>
        </div>
      </section>

      {/* Categorías */}
      <section aria-labelledby="cat-title" className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="cat-title" className="text-2xl font-extrabold sm:text-3xl">¿Con qué te ayudamos?</h2>
            <p className="mt-1 text-muted">Elegí una categoría o describilo con tus palabras.</p>
          </div>
        </div>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c) => (
            <li key={c.id}>
              <Link href={`/solicitar?categoria=${c.slug}`} className="group flex h-full items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)] hover:ring-fixy-200">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-fixy-50 text-fixy-700 group-hover:bg-fixy-100">
                  <CategoryIcon icon={c.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold leading-snug">{c.name}</span>
                  <span className="mt-0.5 hidden text-sm text-muted sm:block">{c.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* Cómo funciona */}
      <section id="como-funciona" aria-labelledby="how-title" className="mx-auto mt-20 max-w-6xl scroll-mt-20 px-4 sm:px-6">
        <h2 id="how-title" className="text-2xl font-extrabold sm:text-3xl">Cómo funciona</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-[var(--radius-card)] bg-white p-5 ring-1 ring-line">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-ink font-display font-bold text-white">{i + 1}</span>
                <s.icon className="h-5 w-5 text-fixy-700" aria-hidden />
              </div>
              <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
              <p className="mt-1 text-[15px] text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Transparencia */}
      <section aria-labelledby="price-title" className="mx-auto mt-20 grid max-w-6xl items-center gap-8 px-4 sm:px-6 md:grid-cols-2">
        <div>
          <h2 id="price-title" className="text-2xl font-extrabold sm:text-3xl">Revisá qué incluye antes de confirmar</h2>
          <p className="mt-3 text-ink-2">Cada presupuesto separa mano de obra, materiales, visita y el cargo de servicio de Fixy. Ves el total, la vigencia, las exclusiones y las condiciones de cancelación antes de contratar. Sin cargos ocultos.</p>
          <ul className="mt-5 space-y-2 text-[15px]">
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />Los adicionales solo se cobran si los aceptás.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />El alcance y el precio contratados quedan guardados y no cambian.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />Distinguimos estimación, presupuesto y precio confirmado.</li>
          </ul>
        </div>
        <figure className="rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-lift)] ring-1 ring-line">
          <figcaption className="mb-3 flex items-center justify-between text-sm"><span className="font-semibold">Ejemplo de desglose</span><span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-muted">Valores ilustrativos</span></figcaption>
          <dl className="tabular divide-y divide-line text-[15px]">
            {[["Mano de obra", 4_500_000], ["Materiales", 1_800_000], ["Visita", 1_500_000], ["Cargo de servicio Fixy (5 %)", 390_000]].map(([k, v]) => (
              <div key={k as string} className="flex justify-between py-2.5"><dt className="text-muted">{k}</dt><dd>{formatMoney(v as number)}</dd></div>
            ))}
            <div className="flex justify-between py-3 text-lg font-bold"><dt>Total</dt><dd>{formatMoney(8_190_000)}</dd></div>
          </dl>
        </figure>
      </section>

      {/* Hogares y empresas */}
      <section id="empresas" aria-label="Para hogares y oficinas" className="mx-auto mt-20 grid max-w-6xl scroll-mt-20 gap-4 px-4 sm:px-6 md:grid-cols-2">
        <article className="rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line sm:p-8">
          <House className="h-8 w-8 text-fixy-700" aria-hidden />
          <h2 className="mt-4 text-2xl font-extrabold">Hogares</h2>
          <p className="mt-2 text-ink-2">Guardá tus propiedades, seguí cada pedido y tené a mano el historial de lo que se hizo, cuánto costó y quién lo hizo.</p>
          <ButtonLink href="/solicitar" variant="secondary" className="mt-6">Pedir presupuesto</ButtonLink>
        </article>
        <article className="rounded-[var(--radius-card)] bg-ink p-6 text-white sm:p-8">
          <Building2 className="h-8 w-8 text-fixy-200" aria-hidden />
          <h2 className="mt-4 text-2xl font-extrabold text-white">Oficinas y empresas</h2>
          <p className="mt-2 text-white/80">Organizá sedes y equipo, asigná responsables, consultá gastos por sede, período, proveedor y categoría, y exportá a CSV.</p>
          <ButtonLink href="/registro?tipo=organizacion" variant="secondary" className="mt-6">Crear cuenta para mi organización</ButtonLink>
        </article>
      </section>

      {/* Proveedores */}
      <section aria-labelledby="pro-title" className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-6 overflow-hidden rounded-[32px] bg-gradient-to-br from-fixy-50 via-white to-spark-100 p-6 ring-1 ring-line sm:p-10 md:grid-cols-[1fr_auto]">
          <div>
            <h2 id="pro-title" className="text-2xl font-extrabold sm:text-4xl">Tu oficio, más oportunidades.</h2>
            <p className="mt-3 max-w-xl text-ink-2">Profesionales independientes y empresas de servicios pueden registrarse, cargar su perfil y documentación, y recibir solicitudes de su zona con condiciones claras.</p>
            <ButtonLink href="/sumate" size="lg" className="mt-6">Ofrecé tus servicios <ArrowRight className="h-5 w-5" aria-hidden /></ButtonLink>
          </div>
          <Mascot pose="celebrate" className="mx-auto hidden h-52 w-auto md:block" />
        </div>
      </section>

      {/* FAQ */}
      <section id="preguntas" aria-labelledby="faq-title" className="mx-auto mt-20 max-w-3xl scroll-mt-20 px-4 sm:px-6">
        <h2 id="faq-title" className="text-2xl font-extrabold sm:text-3xl">Preguntas frecuentes</h2>
        <div className="mt-6 divide-y divide-line rounded-[var(--radius-card)] bg-white ring-1 ring-line">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {q}
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fixy-50 text-fixy-800 transition group-open:rotate-45" aria-hidden>+</span>
              </summary>
              <p className="mt-2 text-[15px] text-ink-2">{a}</p>
            </details>
          ))}
        </div>
        <div className="mt-10 text-center">
          <ButtonLink href="/solicitar" size="lg">Contanos qué pasa</ButtonLink>
        </div>
      </section>
    </>
  );
}
