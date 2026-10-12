import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { canAccessAdmin } from "@/server/auth/actor";
import { inFixyApp } from "@/components/auth/google-button";
import { AppHome } from "@/components/landing/app-home";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, Mail, MessageCircle } from "lucide-react";
import { sql } from "@/server/db/client";
import { listCategories } from "@/server/modules/catalog";
import { CategoryIcon } from "@/components/category-icon";
import { formatMoney } from "@/lib/format";
import { SUPPORT_EMAIL, whatsappUrl } from "@/lib/contact";
import { FixySpot } from "@/components/fixy3d/spot";
import { FixyLayer } from "@/components/fixy3d/layer";
import { HeroAsk } from "@/components/landing/hero-ask";
import { FixyHoverBridge } from "@/components/landing/fixy-hover-bridge";

export const dynamic = "force-dynamic";

/**
 * Landing en estilo "Mercury" (docs/design/landing.md): lienzo ónix, tarjetas grafito planas (12 px, sin sombra ni borde),
 * controles en píldora, títulos anchos en peso 480 y UNA sola acción en cobalto por página (pedir un servicio).
 * El único otro color es Fixy, que recorre las secciones en 3D.
 */
const STEPS = [
  { title: "Contanos qué pasa", text: "Con tus palabras y, si querés, una foto. Te ayudamos a saber qué profesional necesitás.", action: "listen", pose: "listen", say: "Contame: con tus palabras alcanza." },
  { title: "Elegí a tu profesional", text: "Ves quién cubre tu zona, con reseñas reales, verificaciones y precios. O decís cuánto querés pagar y se anotan.", action: "search", pose: "think", say: "Busco quién puede ir a tu zona…" },
  { title: "Coordinen en Fixy", text: "Día y horario por el chat. Tu dirección se comparte recién cuando confirmás; al llegar, le das tu código de visita.", action: "thumbs", pose: "celebrate", say: "Tu dirección la cuido yo." },
  { title: "Aprobá y pagá en la app", text: "Te presupuesta en el lugar, lo aprobás y pagás. Los extras siempre pasan por vos.", action: "coins", pose: "celebrate", say: "Nada se cobra sin tu OK." },
] as const;

const PROBLEMS = ["Gotea la canilla", "Saltó la térmica", "El aire no enfría", "Humedad en la pared", "Se trabó la puerta", "Pintar el living", "No anda el lavarropas", "Cambiar el calefón", "Destapar la pileta", "Wifi que no llega", "Refacción del baño", "Mantenimiento del edificio"];

const BIG_JOBS = ["Refacciones y remodelaciones", "Obras y ampliaciones", "Mantenimiento de edificios y consorcios", "Locales, oficinas y empresas", "Instalaciones completas: electricidad, gas, agua y climatización", "Lo que no esté en la lista: escribinos igual"];

const FAQ = [
  ["¿Cómo elijo al profesional?", "Te mostramos quiénes cubren tu zona y tu tipo de trabajo, con reseñas de trabajos reales, verificaciones, cuánto cobran la visita y precios de referencia. Elegís uno; si no puede o no responde a tiempo, elegís otro."],
  ["¿Puedo decir cuánto quiero pagar?", "Sí. Elegí «Decir cuánto quiero pagar»: los profesionales de tu zona se anotan por ese precio o te ofrecen menos, y vos elegís por precio, reseñas y experiencia."],
  ["¿Hacen trabajos grandes u obras?", `Sí. Refacciones, obras, mantenimiento de edificios y consorcios, locales y empresas: escribinos a ${SUPPORT_EMAIL} y te acercamos a los mejores profesionales y empresas.`],
  ["¿Tengo que pasar mi teléfono o dirección?", "No. Se coordina por el chat de Fixy y la dirección se comparte solo con el profesional que confirmaste."],
  ["¿Cómo se paga?", "Dentro de Fixy, con Mercado Pago. Fixy no guarda datos de tarjetas y nada se cobra sin tu aprobación."],
  ["¿Qué significa que un profesional esté verificado?", "Que revisamos su identidad y, si corresponde, su matrícula. Mostramos solo verificaciones que hicimos."],
  ["¿Qué pasa si algo sale mal?", "Abrís un reclamo desde el trabajo, adjuntás evidencias y lo seguimos con vos. Todo queda registrado."],
];

const section = "mx-auto max-w-[1200px] px-5 sm:px-8";
const eyebrow = "m-strong text-xs uppercase tracking-[0.14em] text-ash";

export default async function Landing({ searchParams }: { searchParams: Promise<{ cuenta?: string }> }) {
  const sp = await searchParams;
  // Dentro de la app: quien ya ingresó va directo a su panel; el resto ve una pantalla con una sola tarea.
  if (await inFixyApp()) {
    const actor = await getActor();
    if (actor) redirect(canAccessAdmin(actor) ? "/admin" : actor.providers.length && !actor.organizations.length ? "/proveedor" : "/app");
    return <AppHome notice={sp.cuenta === "eliminada" ? "Tu cuenta fue eliminada. Gracias por haber usado Fixy." : undefined} />;
  }
  const categories = await listCategories(sql());
  // Los rubros más pedidos van como tarjetas (con «Otro» al final); el resto, como etiquetas compactas.
  const named = categories.filter((c) => c.slug !== "otro");
  const featured = [...named.slice(0, 11), ...categories.filter((c) => c.slug === "otro")];
  const more = named.slice(11);
  return (
    <>
      {sp.cuenta === "eliminada" && (
        <p role="status" className={`${section} pt-4`}><span className="block rounded-xl bg-graphite px-5 py-3 text-[15px] text-ivory">Tu cuenta fue eliminada. Gracias por haber usado Fixy.</span></p>
      )}
      <FixyLayer />
      <FixyHoverBridge />

      {/* ── Hero: pila centrada sobre una atmósfera de "hora azul" ── */}
      <section data-fixy-scope className="relative -mt-[72px] overflow-hidden pt-[72px]">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-[-22%] h-[780px] w-[1250px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(82,102,235,0.24),rgba(82,102,235,0.07)_55%,transparent)]" />
          <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-onyx to-transparent" />
          <div className="absolute inset-x-0 bottom-[34px] mx-auto h-px max-w-[720px] bg-gradient-to-r from-transparent via-slate-line/60 to-transparent" />
        </div>
        <div className={`${section} relative flex min-h-[calc(100dvh-72px)] flex-col items-center justify-center pb-6 pt-8 text-center`}>
          <p className={`${eyebrow} m-rise`}>Hogar · Oficina · Obra</p>
          <h1 className="m-rise mt-5 max-w-[760px] text-[2.6rem] sm:text-[4.0625rem]" style={{ lineHeight: 1.08, animationDelay: "60ms" }}>De problema a resuelto.</h1>
          <p className="m-strong m-rise mx-auto mt-5 max-w-[520px] text-lg leading-[1.4] text-ash" style={{ animationDelay: "120ms" }}>
            Desde una canilla que gotea hasta una obra completa. Te acercamos a los mejores profesionales y coordinás, aprobás y pagás en un solo lugar.
          </p>
          <div className="m-rise w-full" style={{ animationDelay: "180ms" }}>
            <HeroAsk />
          </div>
          <FixySpot action="wave" pose="wave" size={200} mobileInline say="¡Hola! Soy Fixy. ¿Qué se rompió?" className="mx-auto mt-10 h-48 w-48 sm:h-52 sm:w-52" />
        </div>
      </section>

      {/* ── Cinta de problemas (decorativa; se detiene al pasar el mouse y con movimiento reducido) ── */}
      <div aria-hidden className="m-ticker-wrap overflow-hidden border-y border-slate-line/25 py-5">
        <div className="m-ticker flex w-max gap-10 whitespace-nowrap text-[15px] text-ash">
          {[...PROBLEMS, ...PROBLEMS].map((p, i) => (
            <span key={i} className="inline-flex items-center gap-10">{p}<span className="h-1 w-1 rounded-full bg-slate-line" /></span>
          ))}
        </div>
      </div>

      {/* ── Rubros ── */}
      <section data-fixy-scope aria-labelledby="cat-title" className={`${section} pt-[112px]`}>
        <div className="flex items-end justify-between gap-6">
          <div className="max-w-[620px]">
            <p className={eyebrow}>Rubros</p>
            <h2 id="cat-title" className="mt-4 text-[2rem] sm:text-[2.625rem]">¿Con qué te ayudamos?</h2>
            <p className="mt-4 text-lg leading-[1.4] text-ash">Elegí un rubro o contalo con tus palabras. Y si no está en la lista, igual lo resolvemos.</p>
          </div>
          <FixySpot action="idle" pose="listen" size={150} say="Pasá por un rubro y te cuento." className="hidden h-36 w-32 shrink-0 md:block" />
        </div>
        <ul className="mt-10 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {featured.map((c) => (
            <li key={c.id}>
              <Link
                href={`/solicitar?categoria=${c.slug}`}
                data-fixy-hover={c.slug === "otro" ? "¡Eso también lo resolvemos!" : `¿${c.name}? ¡Tengo gente!`}
                className="group flex h-full flex-col gap-4 rounded-xl bg-graphite p-5 transition-colors duration-200 hover:bg-obsidian sm:p-6"
              >
                <span className="flex items-center justify-between text-ivory">
                  <CategoryIcon icon={c.icon} className="h-6 w-6" />
                  <ArrowUpRight className="h-4 w-4 text-slate-line transition-colors group-hover:text-ivory" aria-hidden />
                </span>
                <span>
                  <span className="m-strong block hyphens-auto break-words leading-snug text-ivory" lang="es">{c.name}</span>
                  <span className="mt-1.5 hidden text-sm leading-normal text-ash sm:block">{c.description}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {more.length > 0 && (
          <>
            <p className="mt-10 text-sm text-ash">Y también</p>
            <ul className="mt-4 flex flex-wrap gap-2">
              {more.map((c) => (
                <li key={c.id}>
                  <Link href={`/solicitar?categoria=${c.slug}`} data-fixy-hover={`¿${c.name}? ¡Tengo gente!`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-[40px] bg-graphite px-4 text-[15px] text-ivory transition-colors duration-200 hover:bg-obsidian">
                    <CategoryIcon icon={c.icon} className="h-4 w-4 text-ash" />
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* ── Cómo funciona: el camino que Fixy recorre ── */}
      <section id="como-funciona" aria-labelledby="how-title" className={`${section} scroll-mt-24 pt-[128px]`}>
        <div className="mx-auto max-w-[620px] text-center">
          <p className={eyebrow}>Cómo funciona</p>
          <h2 id="how-title" className="mt-4 text-[2rem] sm:text-[2.625rem]">Así de simple.</h2>
          <p className="mt-4 text-lg leading-[1.4] text-ash">Cuatro pasos. Fixy te acompaña en cada uno.</p>
        </div>
        <ol className="relative mx-auto mt-14 max-w-[960px] space-y-4">
          <svg aria-hidden className="absolute left-1/2 top-0 hidden h-full w-24 -translate-x-1/2 md:block" viewBox="0 0 100 1000" preserveAspectRatio="none">
            <path d="M50 0 C 95 120, 5 250, 50 370 S 95 620, 50 740 S 5 900, 50 1000" fill="none" stroke="var(--color-slate-line)" strokeOpacity="0.55" strokeWidth="3" strokeDasharray="2 14" strokeLinecap="round" />
          </svg>
          {STEPS.map((s, i) => (
            <li key={s.title} data-fixy-scope className="relative grid items-center gap-4 md:grid-cols-2 md:gap-28">
              <div className={`m-card ${i % 2 ? "md:order-2" : ""}`}>
                <p className="m-strong tabular text-sm tracking-[0.08em] text-ash">0{i + 1}</p>
                <h3 className="mt-4 text-[1.5rem] sm:text-[1.75rem]">{s.title}</h3>
                <p className="mt-3 leading-normal text-ash">{s.text}</p>
              </div>
              <FixySpot action={s.action} pose={s.pose} size={190} say={s.say} className={`mx-auto hidden h-44 w-40 md:block ${i % 2 ? "md:order-1" : ""}`} />
            </li>
          ))}
        </ol>
      </section>

      {/* ── Vos ponés el precio ── */}
      <section data-fixy-scope aria-labelledby="budget-title" className={`${section} pt-[128px]`}>
        <div className="m-card grid items-center gap-8 md:grid-cols-[1fr_auto] md:!p-14">
          <div className="max-w-[560px]">
            <p className={eyebrow}>Nuevo</p>
            <h2 id="budget-title" className="mt-4 text-[2rem] sm:text-[2.625rem]">Vos ponés el precio.</h2>
            <p className="mt-4 text-lg leading-[1.4] text-ash">Decí cuánto querés pagar y los profesionales de tu zona se anotan por ese precio o te ofrecen menos. Comparás ofertas, reseñas y experiencia, y elegís.</p>
            <Link href="/solicitar" className="m-btn m-btn-ghost mt-8">Proponer mi precio <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <FixySpot action="sign" pose="wave" size={220} say="¡Ofertá vos!" className="mx-auto h-52 w-48 md:mr-6" />
        </div>
      </section>

      {/* ── Transparencia ── */}
      <section data-fixy-scope aria-labelledby="price-title" className={`${section} grid items-center gap-12 pt-[128px] md:grid-cols-2`}>
        <div>
          <p className={eyebrow}>Transparencia</p>
          <h2 id="price-title" className="mt-4 text-[2rem] sm:text-[2.625rem]">Nada se cobra sin tu OK.</h2>
          <p className="mt-4 text-lg leading-[1.4] text-ash">Antes de elegir ves el precio de la visita y los precios de referencia. Después, el presupuesto llega a la app con cada concepto separado. Vos decidís.</p>
          <ul className="mt-8 space-y-4">
            {["Los adicionales solo se cobran si los aceptás.", "El alcance y el precio contratados quedan guardados.", "Mensajes, dirección y pagos dentro de Fixy."].map((t) => (
              <li key={t} className="flex gap-3 text-ivory"><Check className="mt-1 h-4 w-4 shrink-0 text-ash" aria-hidden />{t}</li>
            ))}
          </ul>
        </div>
        <div className="relative">
          <FixySpot action="thumbs" pose="celebrate" size={160} say="¡Todo clarito!" className="absolute -top-32 right-4 z-10 hidden h-36 w-32 md:block" />
          <figure className="m-card">
            <figcaption className="flex items-center justify-between gap-3"><span className="m-strong text-ivory">Ejemplo de presupuesto</span><span className="rounded-[40px] bg-obsidian px-3 py-1 text-xs text-ash">Valores ilustrativos</span></figcaption>
            <dl className="tabular mt-5 text-[15px]">
              {[["Mano de obra", 4_500_000], ["Materiales", 1_800_000], ["Visita", 1_500_000], ["Cargo de servicio Fixy (10 %)", 780_000]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between border-b border-slate-line/25 py-3.5"><dt className="text-ash">{k}</dt><dd className="text-ivory">{formatMoney(v as number)}</dd></div>
              ))}
              <div className="m-strong flex justify-between pt-5 text-lg text-ivory"><dt>Total</dt><dd>{formatMoney(8_580_000)}</dd></div>
            </dl>
          </figure>
        </div>
      </section>

      {/* ── Trabajos grandes ── */}
      <section data-fixy-scope id="trabajos-grandes" aria-labelledby="big-title" className={`${section} scroll-mt-24 pt-[128px]`}>
        <div className="grid gap-12 md:grid-cols-[1.1fr_1fr]">
          <div>
            <p className={eyebrow}>Obras y empresas</p>
            <h2 id="big-title" className="mt-4 text-[2rem] sm:text-[2.625rem]">Trabajos grandes, también.</h2>
            <p className="mt-4 max-w-[520px] text-lg leading-[1.4] text-ash">¿Una obra, una refacción completa o el mantenimiento de un edificio? Contanos el proyecto y te acercamos siempre a los mejores profesionales y empresas. Si lo necesitás, lo resolvemos.</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Proyecto para Fixy")}`} className="m-btn m-btn-ghost"><Mail className="h-4 w-4" aria-hidden />{SUPPORT_EMAIL}</a>
              <a href={whatsappUrl("Hola Fixy, quiero contarles un trabajo grande")} target="_blank" rel="noopener noreferrer" className="m-btn m-btn-quiet"><MessageCircle className="h-4 w-4" aria-hidden />Por WhatsApp</a>
            </div>
            <FixySpot action="hardhat" pose="wave" size={190} say="¿Obra grande? ¡A la orden!" className="mt-20 hidden h-44 w-40 md:block" />
          </div>
          <ul className="m-card !py-3">
            {BIG_JOBS.map((t, i) => (
              <li key={t} className={`flex items-center justify-between gap-4 py-5 text-ivory ${i ? "border-t border-slate-line/25" : ""}`}>
                <span>{t}</span><span className="tabular text-sm text-slate-line">0{i + 1}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Hogares y empresas ── */}
      <section id="empresas" aria-label="Para hogares y empresas" className={`${section} grid scroll-mt-24 gap-3 pt-[128px] md:grid-cols-2`}>
        <article className="m-card md:!p-10">
          <p className={eyebrow}>Hogares</p>
          <h2 className="mt-4 text-[1.75rem]">Tu casa, en orden.</h2>
          <p className="mt-3 max-w-md leading-normal text-ash">Guardá tus propiedades, seguí cada pedido y tené a mano el historial de lo que se hizo, cuánto costó y quién lo hizo.</p>
          <Link href="/solicitar" className="m-btn m-btn-quiet mt-8">Hacer un pedido</Link>
        </article>
        <article className="m-card md:!p-10">
          <p className={eyebrow}>Oficinas y empresas</p>
          <h2 className="mt-4 text-[1.75rem]">Todas tus sedes, un panel.</h2>
          <p className="mt-3 max-w-md leading-normal text-ash">Organizá sedes y equipo, asigná responsables, consultá gastos por sede, período, proveedor y rubro, y exportá a CSV.</p>
          <Link href="/registro?tipo=organizacion" className="m-btn m-btn-quiet mt-8">Crear cuenta para mi organización</Link>
        </article>
      </section>

      {/* ── Profesionales ── */}
      <section data-fixy-scope aria-labelledby="pro-title" className={`${section} pt-3`}>
        <div className="m-card grid items-center gap-8 md:grid-cols-[1fr_auto] md:!p-14">
          <div className="max-w-[560px]">
            <p className={eyebrow}>Profesionales</p>
            <h2 id="pro-title" className="mt-4 text-[2rem] sm:text-[2.625rem]">Tu oficio, más trabajo.</h2>
            <p className="mt-4 text-lg leading-[1.4] text-ash">Registrate en minutos, recibí pedidos de tu zona por la web y por WhatsApp, y cobrá sin comisión de Fixy.</p>
            <Link href="/sumate" className="m-btn m-btn-ghost mt-8">Ofrecé tus servicios <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </div>
          <FixySpot action="celebrate" pose="celebrate" size={220} say="¡Sumate, hay trabajo!" className="mx-auto h-52 w-52 md:mr-6" />
        </div>
      </section>

      {/* ── Preguntas ── */}
      <section data-fixy-scope id="preguntas" aria-labelledby="faq-title" className={`${section} scroll-mt-24 pt-[128px]`}>
        <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className={eyebrow}>Preguntas</p>
            <h2 id="faq-title" className="mt-4 text-[2rem] sm:text-[2.625rem]">Lo que suelen preguntarnos.</h2>
            <FixySpot action="think" pose="think" size={170} say="Mmm… ¿dudas? Acá están." className="mt-24 hidden h-40 w-32 md:block" />
          </div>
          <div className="m-card !py-2">
            {FAQ.map(([q, a], i) => (
              <details key={q} className={`group py-5 [&_summary::-webkit-details-marker]:hidden ${i ? "border-t border-slate-line/25" : ""}`}>
                <summary className="m-strong flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 rounded-lg text-ivory">
                  {q}
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-obsidian text-lg leading-none text-ivory transition-transform duration-200 group-open:rotate-45" aria-hidden>+</span>
                </summary>
                <p className="mt-3 max-w-[60ch] leading-normal text-ash">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Cierre ── */}
      <section data-fixy-scope aria-labelledby="end-title" className={`${section} pt-[128px] text-center`}>
        <FixySpot action="sleep" pose="empathy" size={170} say="Zzz… avisame si se rompe algo." className="mx-auto h-40 w-36" />
        <h2 id="end-title" className="mx-auto mt-8 max-w-[640px] text-[2rem] sm:text-[3.0625rem]">¿Algo para arreglar?</h2>
        <p className="mx-auto mt-4 max-w-[460px] text-lg leading-[1.4] text-ash">Despertá a Fixy: en un minuto tenés a quién llamar.</p>
        <Link href="/solicitar" className="m-btn m-btn-primary mt-8">Pedir un servicio <ArrowRight className="h-4 w-4" aria-hidden /></Link>
      </section>
    </>
  );
}
