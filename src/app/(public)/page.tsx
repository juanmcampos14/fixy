import Link from "next/link";
import { ArrowRight, Building2, Droplets, HandCoins, HardHat, House, Mail, MessageCircle, Paintbrush, ShieldCheck, CircleCheck, Wrench, Zap } from "lucide-react";
import { sql } from "@/server/db/client";
import { listCategories } from "@/server/modules/catalog";
import { ButtonLink } from "@/components/ui/button";
import { CategoryIcon } from "@/components/category-icon";
import { formatMoney } from "@/lib/format";
import { SUPPORT_EMAIL, whatsappUrl } from "@/lib/contact";
import { FixySpot } from "@/components/fixy3d/spot";
import { FixyLayer } from "@/components/fixy3d/layer";
import { HeroAsk } from "@/components/landing/hero-ask";
import { FixyHoverBridge } from "@/components/landing/fixy-hover-bridge";

export const dynamic = "force-dynamic";

const STEPS = [
  { title: "Contanos qué pasa", text: "Con tus palabras y, si querés, una foto. Te ayudamos a saber qué profesional necesitás.", action: "listen", pose: "listen", say: "Contame: con tus palabras alcanza." },
  { title: "Elegí a tu profesional", text: "Ves quién cubre tu zona, con reseñas reales, verificaciones y precios. O decís cuánto querés pagar y se anotan.", action: "search", pose: "think", say: "Busco quién puede ir a tu zona…" },
  { title: "Coordinen en Fixy", text: "Día y horario por el chat. Tu dirección se comparte recién cuando confirmás; al llegar, le das tu código de visita.", action: "thumbs", pose: "celebrate", say: "Tu dirección la cuido yo." },
  { title: "Aprobá y pagá en la app", text: "Te presupuesta en el lugar, lo aprobás y pagás. Los extras siempre pasan por vos.", action: "coins", pose: "celebrate", say: "Nada se cobra sin tu OK." },
] as const;

const PROBLEMS = ["Gotea la canilla", "Saltó la térmica", "El aire no enfría", "Humedad en la pared", "Se trabó la puerta", "Pintar el living", "No anda el lavarropas", "Cambiar el calefón", "Destapar la pileta", "Wifi que no llega", "Refacción del baño", "Mantenimiento del edificio"];

const FAQ = [
  ["¿Cómo elijo al profesional?", "Te mostramos quiénes cubren tu zona y tu tipo de trabajo, con reseñas de trabajos reales, verificaciones, cuánto cobran la visita y precios de referencia. Elegís uno; si no puede o no responde a tiempo, elegís otro."],
  ["¿Puedo decir cuánto quiero pagar?", "Sí. Elegí «Decir cuánto quiero pagar»: los profesionales de tu zona se anotan por ese precio o te ofrecen menos, y vos elegís por precio, reseñas y experiencia."],
  ["¿Hacen trabajos grandes u obras?", `Sí. Refacciones, obras, mantenimiento de edificios y consorcios, locales y empresas: escribinos a ${SUPPORT_EMAIL} y te acercamos a los mejores profesionales y empresas.`],
  ["¿Tengo que pasar mi teléfono o dirección?", "No. Se coordina por el chat de Fixy y la dirección se comparte solo con el profesional que confirmaste."],
  ["¿Cómo se paga?", "Dentro de Fixy, con Mercado Pago. Fixy no guarda datos de tarjetas y nada se cobra sin tu aprobación."],
  ["¿Qué significa que un profesional esté verificado?", "Que revisamos su identidad y, si corresponde, su matrícula. Mostramos solo verificaciones que hicimos."],
  ["¿Qué pasa si algo sale mal?", "Abrís un reclamo desde el trabajo, adjuntás evidencias y lo seguimos con vos. Todo queda registrado."],
];

/** Calcomanías de herramientas que flotan alrededor de Fixy en el hero. */
function Sticker({ icon: Icon, className, tone }: { icon: typeof Wrench; className: string; tone: string }) {
  return (
    <span aria-hidden className={`absolute grid h-14 w-14 place-items-center rounded-2xl shadow-[var(--shadow-card)] ring-4 ring-white motion-safe:animate-[float_6s_ease-in-out_infinite] ${tone} ${className}`}>
      <Icon className="h-7 w-7" />
    </span>
  );
}

export default async function Landing({ searchParams }: { searchParams: Promise<{ cuenta?: string }> }) {
  const [categories, sp] = await Promise.all([listCategories(sql()), searchParams]);
  return (
    <>
      {sp.cuenta === "eliminada" && (
        <p role="status" className="mx-auto mt-4 max-w-6xl rounded-2xl bg-white px-4 py-3 text-[15px] ring-1 ring-line sm:px-6">Tu cuenta fue eliminada. Gracias por haber usado Fixy.</p>
      )}
      <FixyLayer />
      <FixyHoverBridge />

      {/* ── Hero ── */}
      <section data-fixy-scope className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-fixy-100/70 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -left-32 bottom-0 h-80 w-80 rounded-full bg-spark-100/80 blur-3xl" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-6 px-4 pb-10 pt-8 sm:px-6 md:grid-cols-[1.15fr_1fr] md:pb-16 md:pt-14">
          <div className="motion-safe:animate-fade-up">
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-semibold text-fixy-800 ring-1 ring-line">
              <span className="h-2 w-2 rounded-full bg-spark" aria-hidden /> Tu centro de soluciones para el hogar, la oficina y la obra
            </p>
            <h1 className="text-[2.9rem] font-extrabold leading-[0.98] tracking-tight sm:text-7xl">
              De problema
              <br />a{" "}
              <span className="relative inline-block">
                resuelto.
                <svg aria-hidden viewBox="0 0 300 24" className="absolute -bottom-2 left-0 h-4 w-full text-spark sm:-bottom-3 sm:h-5" preserveAspectRatio="none">
                  <path d="M3 17 C 60 5, 120 5, 170 13 S 260 21, 297 7" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" className="motion-safe:animate-[draw_1.1s_0.4s_ease-out_both]" pathLength={1} strokeDasharray={1} />
                </svg>
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-ink-2">Desde una canilla que gotea hasta una obra completa. Contanos qué pasa y te acercamos a los mejores profesionales; coordinás, aprobás y pagás todo en un solo lugar.</p>
            <HeroAsk />
          </div>
          <div className="relative mx-auto h-[19rem] w-full max-w-md sm:h-[26rem]">
            <div aria-hidden className="absolute inset-x-6 bottom-6 top-12 rounded-[48%_52%_44%_56%/55%_45%_55%_45%] bg-gradient-to-br from-fixy-100 to-spark-100 motion-safe:animate-[blob_14s_ease-in-out_infinite]" />
            <Sticker icon={Wrench} className="left-2 top-10 rotate-[-12deg]" tone="bg-white text-fixy-700" />
            <Sticker icon={Zap} className="right-4 top-4 rotate-[10deg] [animation-delay:-2s]" tone="bg-spark-100 text-ink" />
            <Sticker icon={Droplets} className="bottom-24 left-0 rotate-[8deg] [animation-delay:-4s]" tone="bg-fixy-50 text-fixy-800" />
            <Sticker icon={Paintbrush} className="bottom-28 right-0 rotate-[-8deg] [animation-delay:-3s]" tone="bg-white text-[#c4621c]" />
            <FixySpot action="wave" pose="wave" size={340} mobileInline say="¡Hola! Soy Fixy. ¿Qué se rompió?" className="absolute inset-x-0 bottom-4 mx-auto h-64 w-64 sm:h-80 sm:w-80" />
          </div>
        </div>
      </section>

      {/* ── Cinta de problemas ── */}
      <div aria-hidden className="relative -rotate-2 overflow-hidden bg-ink py-4 text-white shadow-[var(--shadow-lift)]">
        <div className="flex w-max gap-10 whitespace-nowrap font-display text-2xl font-extrabold motion-safe:animate-[marquee_38s_linear_infinite] sm:text-3xl">
          {[...PROBLEMS, ...PROBLEMS].map((p, i) => (
            <span key={i} className="inline-flex items-center gap-10">{p}<span className="text-spark">✦</span></span>
          ))}
        </div>
      </div>

      {/* ── Rubros ── */}
      <section data-fixy-scope aria-labelledby="cat-title" className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 id="cat-title" className="text-3xl font-extrabold sm:text-4xl">¿Con qué te ayudamos?</h2>
            <p className="mt-1 text-muted">Elegí un rubro o contalo con tus palabras. Y si no está, igual lo resolvemos.</p>
          </div>
          <FixySpot action="idle" pose="listen" size={150} say="Pasá por un rubro y te cuento." className="hidden h-36 w-32 shrink-0 md:block" />
        </div>
        <ul className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {categories.map((c, i) => (
            <li key={c.id}>
              <Link
                href={`/solicitar?categoria=${c.slug}`}
                data-fixy-hover={c.slug === "otro" ? "¡Eso también lo resolvemos!" : `¿${c.name}? ¡Tengo gente!`}
                className={`group flex h-full flex-col items-start gap-2 rounded-3xl bg-white p-3.5 ring-1 ring-line sm:flex-row sm:gap-3 sm:p-4 transition duration-300 hover:-translate-y-1 hover:rotate-[-0.6deg] hover:shadow-[var(--shadow-lift)] hover:ring-fixy-300 ${i % 3 === 1 ? "sm:translate-y-3" : ""}`}
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-fixy-50 text-fixy-700 transition group-hover:scale-110 group-hover:rotate-6 group-hover:bg-spark-100 group-hover:text-ink">
                  <CategoryIcon icon={c.icon} className="h-6 w-6" />
                </span>
                <span className="min-w-0">
                  <span className="block hyphens-auto break-words font-semibold leading-snug" lang="es">{c.name}</span>
                  <span className="mt-0.5 hidden text-sm text-muted sm:block">{c.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Cómo funciona: un camino que Fixy recorre ── */}
      <section id="como-funciona" aria-labelledby="how-title" className="mx-auto mt-28 max-w-5xl scroll-mt-20 px-4 sm:px-6">
        <h2 id="how-title" className="text-center text-3xl font-extrabold sm:text-4xl">Así de simple</h2>
        <p className="mx-auto mt-2 max-w-md text-center text-muted">Fixy te acompaña en cada paso. Seguilo.</p>
        <ol className="relative mt-12 space-y-10 md:space-y-4">
          <svg aria-hidden className="absolute left-1/2 top-0 hidden h-full w-24 -translate-x-1/2 md:block" viewBox="0 0 100 1000" preserveAspectRatio="none">
            <path d="M50 0 C 95 120, 5 250, 50 370 S 95 620, 50 740 S 5 900, 50 1000" fill="none" stroke="#b8e6de" strokeWidth="5" strokeDasharray="2 16" strokeLinecap="round" />
          </svg>
          {STEPS.map((s, i) => (
            <li key={s.title} data-fixy-scope className="relative grid items-center gap-4 md:grid-cols-2 md:gap-24">
              <div className={`rounded-[28px] bg-white p-6 shadow-[var(--shadow-card)] ring-1 ring-line ${i % 2 ? "md:order-2" : ""}`}>
                <span className="grid h-11 w-11 place-items-center rounded-full bg-ink font-display text-lg font-extrabold text-white">{i + 1}</span>
                <h3 className="mt-4 text-xl font-extrabold">{s.title}</h3>
                <p className="mt-1.5 text-[15px] text-ink-2">{s.text}</p>
              </div>
              <FixySpot action={s.action} pose={s.pose} size={190} say={s.say} className={`mx-auto hidden h-44 w-40 md:block ${i % 2 ? "md:order-1" : ""}`} />
            </li>
          ))}
        </ol>
      </section>

      {/* ── Decí cuánto querés pagar ── */}
      <section data-fixy-scope aria-labelledby="budget-title" className="mx-auto mt-28 max-w-6xl px-4 sm:px-6">
        <div className="relative grid items-center gap-6 overflow-hidden rounded-[36px] bg-spark-100 p-6 sm:p-10 md:grid-cols-[1fr_auto]">
          <div className="relative">
            <span className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-semibold"><HandCoins className="h-4 w-4" aria-hidden /> Nuevo</span>
            <h2 id="budget-title" className="mt-4 text-3xl font-extrabold sm:text-5xl">Vos ponés el precio.</h2>
            <p className="mt-3 max-w-xl text-lg text-ink-2">Decí cuánto querés pagar y los profesionales de tu zona se anotan por ese precio o te ofrecen menos. Comparás ofertas, reseñas y experiencia, y elegís.</p>
            <ButtonLink href="/solicitar" size="lg" className="mt-6">Proponer mi precio <ArrowRight className="h-5 w-5" aria-hidden /></ButtonLink>
          </div>
          <FixySpot action="sign" pose="wave" size={230} say="¡Ofertá vos!" className="mx-auto h-52 w-48 md:h-60 md:w-52" />
        </div>
      </section>

      {/* ── Transparencia ── */}
      <section data-fixy-scope aria-labelledby="price-title" className="mx-auto mt-28 grid max-w-6xl items-center gap-10 px-4 sm:px-6 md:grid-cols-2">
        <div>
          <h2 id="price-title" className="text-3xl font-extrabold sm:text-4xl">Nada se cobra sin tu OK.</h2>
          <p className="mt-3 text-ink-2">Antes de elegir ves el precio de la visita y los precios de referencia. Después, el presupuesto llega a la app con mano de obra, materiales y el cargo de Fixy separados. Vos decidís.</p>
          <ul className="mt-5 space-y-2 text-[15px]">
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />Los adicionales solo se cobran si los aceptás.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />El alcance y el precio contratados quedan guardados.</li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />Mensajes, dirección y pagos dentro de Fixy.</li>
          </ul>
        </div>
        <div className="relative">
          <FixySpot action="thumbs" pose="celebrate" size={170} say="¡Todo clarito!" className="absolute -left-6 -top-28 z-10 hidden h-40 w-36 md:block" />
          <figure className="rotate-[1.5deg] rounded-[28px] bg-white p-6 shadow-[var(--shadow-lift)] ring-1 ring-line transition hover:rotate-0">
            <figcaption className="mb-3 flex items-center justify-between text-sm"><span className="font-semibold">Ejemplo de presupuesto</span><span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-muted">Valores ilustrativos</span></figcaption>
            <dl className="tabular divide-y divide-dashed divide-line text-[15px]">
              {[["Mano de obra", 4_500_000], ["Materiales", 1_800_000], ["Visita", 1_500_000], ["Cargo de servicio Fixy (10 %)", 780_000]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between py-2.5"><dt className="text-muted">{k}</dt><dd>{formatMoney(v as number)}</dd></div>
              ))}
              <div className="flex justify-between py-3 text-lg font-bold"><dt>Total</dt><dd>{formatMoney(8_580_000)}</dd></div>
            </dl>
          </figure>
        </div>
      </section>

      {/* ── Trabajos grandes ── */}
      <section data-fixy-scope id="trabajos-grandes" aria-labelledby="big-title" className="mx-auto mt-28 max-w-6xl scroll-mt-20 px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-[36px] bg-ink p-6 text-white sm:p-10">
          <div aria-hidden className="absolute inset-0 opacity-[0.07] [background-image:repeating-linear-gradient(45deg,#fff_0_14px,transparent_14px_28px)]" />
          <div className="relative grid gap-8 md:grid-cols-[1.2fr_1fr]">
            <div>
              <HardHat className="h-9 w-9 text-spark" aria-hidden />
              <h2 id="big-title" className="mt-4 text-3xl font-extrabold text-white sm:text-5xl">Trabajos grandes, también.</h2>
              <p className="mt-3 max-w-xl text-white/80">¿Una obra, una refacción completa o el mantenimiento de un edificio? Contanos el proyecto y te acercamos siempre a los mejores profesionales y empresas. Si lo necesitás, lo resolvemos.</p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Proyecto para Fixy")}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-6 font-semibold text-ink hover:bg-cream"><Mail className="h-5 w-5" aria-hidden />{SUPPORT_EMAIL}</a>
                <a href={whatsappUrl("Hola Fixy, quiero contarles un trabajo grande")} target="_blank" rel="noopener noreferrer" className="inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 font-semibold text-white ring-1 ring-white/40 hover:bg-white/10"><MessageCircle className="h-5 w-5" aria-hidden />Por WhatsApp</a>
              </div>
            </div>
            <div className="grid content-center gap-2">
            <FixySpot action="hardhat" pose="wave" size={190} say="¿Obra grande? ¡A la orden!" className="ml-auto hidden h-44 w-40 md:block" />
            <ul className="grid content-center gap-2 text-[15px] sm:grid-cols-2 md:grid-cols-1">
              {["Refacciones y remodelaciones", "Obras y ampliaciones", "Mantenimiento de edificios y consorcios", "Locales, oficinas y empresas", "Instalaciones completas: electricidad, gas, agua y climatización", "Lo que no esté en la lista: escribinos igual"].map((t) => (
                <li key={t} className="flex items-start gap-2 rounded-2xl bg-white/5 px-4 py-3 ring-1 ring-white/10"><CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-spark" aria-hidden />{t}</li>
              ))}
            </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Hogares y empresas ── */}
      <section id="empresas" aria-label="Para hogares y oficinas" className="mx-auto mt-20 grid max-w-6xl scroll-mt-20 gap-4 px-4 sm:px-6 md:grid-cols-2">
        <article className="rounded-[32px] bg-white p-6 ring-1 ring-line sm:p-8">
          <House className="h-8 w-8 text-fixy-700" aria-hidden />
          <h2 className="mt-4 text-2xl font-extrabold">Hogares</h2>
          <p className="mt-2 text-ink-2">Guardá tus propiedades, seguí cada pedido y tené a mano el historial de lo que se hizo, cuánto costó y quién lo hizo.</p>
          <ButtonLink href="/solicitar" variant="secondary" className="mt-6">Hacer un pedido</ButtonLink>
        </article>
        <article className="rounded-[32px] bg-fixy-800 p-6 text-white sm:p-8">
          <Building2 className="h-8 w-8 text-fixy-200" aria-hidden />
          <h2 className="mt-4 text-2xl font-extrabold text-white">Oficinas y empresas</h2>
          <p className="mt-2 text-white/80">Organizá sedes y equipo, asigná responsables, consultá gastos por sede, período, proveedor y rubro, y exportá a CSV.</p>
          <ButtonLink href="/registro?tipo=organizacion" variant="secondary" className="mt-6">Crear cuenta para mi organización</ButtonLink>
        </article>
      </section>

      {/* ── Profesionales ── */}
      <section data-fixy-scope aria-labelledby="pro-title" className="mx-auto mt-28 max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-6 overflow-hidden rounded-[36px] bg-gradient-to-br from-fixy-50 via-white to-spark-100 p-6 ring-1 ring-line sm:p-10 md:grid-cols-[1fr_auto]">
          <div>
            <h2 id="pro-title" className="text-3xl font-extrabold sm:text-5xl">Tu oficio, más trabajo.</h2>
            <p className="mt-3 max-w-xl text-ink-2">Registrate en minutos, recibí pedidos de tu zona por la web y por WhatsApp, y cobrá sin comisión de Fixy.</p>
            <ButtonLink href="/sumate" size="lg" className="mt-6">Ofrecé tus servicios <ArrowRight className="h-5 w-5" aria-hidden /></ButtonLink>
          </div>
          <FixySpot action="celebrate" pose="celebrate" size={230} say="¡Sumate, hay trabajo!" className="mx-auto h-52 w-52" />
        </div>
      </section>

      {/* ── Preguntas ── */}
      <section data-fixy-scope id="preguntas" aria-labelledby="faq-title" className="mx-auto mt-28 max-w-3xl scroll-mt-20 px-4 sm:px-6">
        <div className="flex items-end justify-between gap-4">
          <h2 id="faq-title" className="text-3xl font-extrabold sm:text-4xl">Preguntas frecuentes</h2>
          <FixySpot action="think" pose="think" size={150} say="Mmm… ¿dudas? Acá están." className="hidden h-36 w-28 shrink-0 sm:block" />
        </div>
        <div className="mt-6 divide-y divide-line rounded-[28px] bg-white ring-1 ring-line">
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
      </section>

      {/* ── Cierre ── */}
      <section data-fixy-scope aria-labelledby="end-title" className="mx-auto mb-10 mt-28 max-w-3xl px-4 text-center sm:px-6">
        <FixySpot action="sleep" pose="empathy" size={170} say="Zzz… avisame si se rompe algo." className="mx-auto h-40 w-36" />
        <h2 id="end-title" className="mt-4 text-3xl font-extrabold sm:text-4xl">¿Algo para arreglar?</h2>
        <p className="mt-2 text-muted">Despertá a Fixy: en un minuto tenés a quién llamar.</p>
        <ButtonLink href="/solicitar" size="lg" className="mt-6">Contanos qué pasa</ButtonLink>
      </section>
    </>
  );
}
