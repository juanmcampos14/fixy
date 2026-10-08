import type { Metadata } from "next";
import { ArrowRight, CalendarClock, CircleCheck, CircleX, ClipboardList, FileCheck2, Inbox, MapPin, MessageCircle, ShieldCheck, Wallet } from "lucide-react";
import { getActor } from "@/server/auth/session";
import { getDefaultCommission } from "@/server/queries/provider";
import { paymentsAreTestMode } from "@/server/env";
import { Mascot } from "@/components/brand/mascot";
import { ButtonLink } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { applyBps } from "@/server/domain/money";

export const metadata: Metadata = {
  title: "Ofrecé tus servicios",
  description: "Profesionales independientes y empresas de servicios: recibí solicitudes de tu zona con condiciones claras.",
};
export const dynamic = "force-dynamic";

const BENEFITS = [
  { icon: Inbox, title: "Solicitudes de tu zona y oficio", text: "Te invitamos a cotizar pedidos que coinciden con tus especialidades, tus zonas y tu disponibilidad." },
  { icon: ClipboardList, title: "Vos ponés el precio", text: "Armás cada presupuesto con mano de obra, materiales y visita. Antes de enviarlo ves cuánto recibís." },
  { icon: MessageCircle, title: "Todo queda registrado", text: "Mensajes, fechas, adicionales y avances quedan en el trabajo. Ayuda a evitar malentendidos." },
  { icon: Wallet, title: "Cobro por la plataforma", text: "El cliente paga por una pasarela de pagos. La dirección del trabajo se revela cuando el pago está aprobado." },
];

const STEPS = [
  ["Cuenta", "Creá tu usuario de Fixy."],
  ["Perfil", "Nombre comercial, descripción y años de experiencia."],
  ["Servicios y zonas", "Elegí tus especialidades y dónde trabajás."],
  ["Disponibilidad", "Días y horarios en los que podés tomar trabajos."],
  ["Portfolio", "Fotos de trabajos tuyos (recomendado)."],
  ["Documentación", "DNI y, si tu especialidad lo pide, matrícula o credencial vigente."],
  ["Cobros", "Vinculás tu cuenta de cobro con el proceso de la pasarela de pagos."],
  ["Revisión", "El equipo de Fixy revisa tu perfil y te avisa el resultado."],
] as const;

export default async function OfferServicesPage() {
  const [actor, commission] = await Promise.all([getActor(), getDefaultCommission()]);
  const hasProvider = !!actor?.providers.length;
  const cta = hasProvider ? "/proveedor" : actor ? "/proveedor/alta" : "/registro?tipo=proveedor";
  const ctaLabel = hasProvider ? "Ir a mi panel de proveedor" : actor ? "Completar mi alta" : "Crear cuenta de proveedor";
  const rate = commission.providerRateBps != null ? commission.providerRateBps / 100 : null;
  const exampleGross = 10_000_000; // $100.000, valores ilustrativos
  const exampleFee = commission.providerRateBps != null ? applyBps(exampleGross, commission.providerRateBps) : 0;

  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-8 px-4 pb-12 pt-10 sm:px-6 md:grid-cols-[1.3fr_1fr] md:pt-16">
        <div className="motion-safe:animate-fade-up">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-semibold text-fixy-800 ring-1 ring-line">
            <span className="h-2 w-2 rounded-full bg-spark" aria-hidden /> Para profesionales y empresas de servicios
          </p>
          <h1 className="text-[2.4rem] font-extrabold leading-[1.05] sm:text-6xl">Tu oficio, más oportunidades.</h1>
          <p className="mt-4 max-w-xl text-lg text-ink-2">
            Sumate a Fixy, recibí solicitudes de hogares y oficinas de tu zona y gestioná presupuestos, trabajos y cobros en un solo lugar.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <ButtonLink href={cta} size="lg">{ctaLabel} <ArrowRight className="h-5 w-5" aria-hidden /></ButtonLink>
            <ButtonLink href="#como-funciona" size="lg" variant="secondary">Cómo es el alta</ButtonLink>
          </div>
          <p className="mt-4 text-sm text-muted">Hoy cubrimos CABA y GBA. Registrarte no tiene costo.</p>
        </div>
        <div className="relative mx-auto w-full max-w-xs">
          <div className="absolute inset-x-6 bottom-2 top-10 -z-10 rounded-[48px] bg-gradient-to-br from-fixy-100 to-spark-100" aria-hidden />
          <Mascot pose="wave" priority className="mx-auto h-64 w-auto sm:h-80" />
        </div>
      </section>

      <section aria-labelledby="ben-t" className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2 id="ben-t" className="text-2xl font-extrabold sm:text-3xl">Qué te ofrece Fixy</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map((b) => (
            <li key={b.title} className="rounded-[var(--radius-card)] bg-white p-5 ring-1 ring-line">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-fixy-50 text-fixy-700"><b.icon className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-4 text-lg font-bold">{b.title}</h3>
              <p className="mt-1 text-[15px] text-muted">{b.text}</p>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted">Fixy no garantiza una cantidad de trabajos: las oportunidades dependen de los pedidos de tu zona y especialidad.</p>
      </section>

      <section id="como-funciona" aria-labelledby="steps-t" className="mx-auto mt-20 max-w-6xl scroll-mt-20 px-4 sm:px-6">
        <h2 id="steps-t" className="text-2xl font-extrabold sm:text-3xl">Cómo es el alta</h2>
        <p className="mt-1 text-muted">Podés completarla de a poco y guardar en cada paso.</p>
        <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex gap-3 rounded-2xl bg-white p-4 ring-1 ring-line">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ink font-display text-sm font-bold text-white">{i + 1}</span>
              <span>
                <span className="block font-bold">{t}</span>
                <span className="block text-[15px] text-muted">{d}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-[15px] text-ink-2">
          Recibís oportunidades cuando tu perfil está aprobado, tu identidad verificada, la recepción de cobros habilitada y tus credenciales obligatorias vigentes.
        </p>
      </section>

      <section aria-labelledby="ver-t" className="mx-auto mt-20 grid max-w-6xl gap-4 px-4 sm:px-6 md:grid-cols-2">
        <div className="rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line sm:p-8">
          <h2 id="ver-t" className="flex items-center gap-2 text-2xl font-extrabold"><ShieldCheck className="h-7 w-7 text-fixy-700" aria-hidden /> Qué verificamos</h2>
          <ul className="mt-4 space-y-2 text-[15px]">
            <li className="flex gap-2"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />Tu identidad, con el documento que cargás.</li>
            <li className="flex gap-2"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />Matrículas o credenciales que piden algunas especialidades (por ejemplo, gas), y su vencimiento.</li>
            <li className="flex gap-2"><FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-ok" aria-hidden />Que tu perfil esté completo antes de aprobarlo.</li>
          </ul>
          <p className="mt-4 text-sm text-muted">En tu perfil público mostramos solo las verificaciones que hicimos y siguen vigentes.</p>
        </div>
        <div className="rounded-[var(--radius-card)] bg-white p-6 ring-1 ring-line sm:p-8">
          <h2 className="flex items-center gap-2 text-2xl font-extrabold"><CircleX className="h-7 w-7 text-muted" aria-hidden /> Qué no verificamos</h2>
          <ul className="mt-4 space-y-2 text-[15px] text-ink-2">
            <li>• Antecedentes penales ni referencias laborales.</li>
            <li>• La calidad de cada trabajo antes de que suceda: para eso están las reseñas de trabajos reales.</li>
            <li>• Seguros propios del profesional, salvo que una especialidad lo pida como credencial.</li>
          </ul>
          <p className="mt-4 text-sm text-muted">Tus datos privados (CUIT, facturación, teléfono, documentos) no se publican.</p>
        </div>
      </section>

      <section aria-labelledby="com-t" className="mx-auto mt-20 grid max-w-6xl items-start gap-8 px-4 sm:px-6 md:grid-cols-2">
        <div>
          <h2 id="com-t" className="text-2xl font-extrabold sm:text-3xl">Cuánto cobra Fixy</h2>
          {rate != null ? (
            <p className="mt-3 text-ink-2">
              La comisión vigente para profesionales es del <strong>{rate.toLocaleString("es-AR")} %</strong> sobre el importe de tu presupuesto (mano de obra, materiales y visita).
              {commission.hasCategoryRules && " Algunas categorías pueden tener una comisión distinta: la ves siempre antes de enviar cada presupuesto."}
            </p>
          ) : (
            <p className="mt-3 text-ink-2">La comisión se muestra antes de enviar cada presupuesto.</p>
          )}
          <ul className="mt-5 space-y-2 text-[15px]">
            <li className="flex gap-2"><CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />Registrarte y cotizar no tiene costo.</li>
            <li className="flex gap-2"><CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />El cliente paga aparte su cargo de servicio; no sale de tu importe.</li>
            <li className="flex gap-2"><CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-fixy-700" aria-hidden />La liquidación se genera cuando el cliente da conformidad al trabajo.</li>
          </ul>
          {paymentsAreTestMode() && <p className="mt-4 text-sm text-warn">Esta versión funciona en modo de prueba: los pagos y liquidaciones son simulados.</p>}
        </div>
        {rate != null && (
          <figure className="rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-lift)] ring-1 ring-line">
            <figcaption className="mb-3 flex items-center justify-between text-sm"><span className="font-semibold">Ejemplo</span><span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs text-muted">Valores ilustrativos</span></figcaption>
            <dl className="tabular divide-y divide-line text-[15px]">
              <div className="flex justify-between py-2.5"><dt className="text-muted">Tu presupuesto</dt><dd>{formatMoney(exampleGross)}</dd></div>
              <div className="flex justify-between py-2.5"><dt className="text-muted">Comisión Fixy ({rate.toLocaleString("es-AR")} %)</dt><dd>− {formatMoney(exampleFee)}</dd></div>
              <div className="flex justify-between py-3 text-lg font-bold"><dt>Recibís</dt><dd>{formatMoney(exampleGross - exampleFee)}</dd></div>
            </dl>
          </figure>
        )}
      </section>

      <section aria-labelledby="more-t" className="mx-auto mt-20 max-w-6xl px-4 sm:px-6">
        <h2 id="more-t" className="sr-only">Gestión del trabajo</h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {[
            [MapPin, "Dirección protegida", "Antes de contratar ves la zona y el tipo de propiedad. La dirección y el acceso, cuando el pago está aprobado."],
            [CalendarClock, "Agenda y equipo", "Reprogramaciones acordadas, agenda de trabajos y, si sos empresa, asignación a técnicos."],
            [ClipboardList, "Adicionales claros", "Si aparece algo extra, lo proponés con su precio y el cliente lo acepta antes de hacerlo."],
          ].map(([Icon, t, d]) => {
            const I = Icon as typeof MapPin;
            return (
              <li key={t as string} className="rounded-2xl bg-white p-5 ring-1 ring-line">
                <I className="h-6 w-6 text-fixy-700" aria-hidden />
                <h3 className="mt-3 font-bold">{t as string}</h3>
                <p className="mt-1 text-[15px] text-muted">{d as string}</p>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mx-auto mt-20 max-w-6xl px-4 pb-4 sm:px-6">
        <div className="grid items-center gap-6 overflow-hidden rounded-[32px] bg-gradient-to-br from-fixy-50 via-white to-spark-100 p-6 ring-1 ring-line sm:p-10 md:grid-cols-[1fr_auto]">
          <div>
            <h2 className="text-2xl font-extrabold sm:text-4xl">¿Arrancamos?</h2>
            <p className="mt-3 max-w-xl text-ink-2">Creá tu cuenta y completá tu perfil. Te acompañamos en cada paso del alta.</p>
            <ButtonLink href={cta} size="lg" className="mt-6">{ctaLabel} <ArrowRight className="h-5 w-5" aria-hidden /></ButtonLink>
          </div>
          <Mascot pose="celebrate" className="mx-auto hidden h-48 w-auto md:block" />
        </div>
      </section>
    </>
  );
}
