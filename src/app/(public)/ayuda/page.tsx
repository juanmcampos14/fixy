import Link from "next/link";
import { Mail, MessageCircle, ShieldAlert, Trash2 } from "lucide-react";
import { SUPPORT_EMAIL, whatsappUrl } from "@/lib/contact";
import { LEGAL } from "@/lib/legal";
import { Card } from "@/components/ui/card";

export const metadata = {
  title: "Ayuda y soporte",
  description: "Cómo contactar a Fixy, resolver un problema con un pedido o un pago, y eliminar tu cuenta.",
};

const FAQ: { q: string; a: React.ReactNode }[] = [
  { q: "¿Cómo pido un servicio?", a: <>Entrá a <Link href="/solicitar" className="underline">Pedir un servicio</Link>, contá qué pasa con tus palabras y elegí un profesional o pedí presupuestos. También podés hacerlo por WhatsApp.</> },
  { q: "¿Cuándo se cobra?", a: "Recién cuando aceptás un presupuesto o confirmás una visita. Antes de pagar ves el detalle completo: trabajo, cargo por servicio y total. El pago se procesa con Mercado Pago." },
  { q: "Tuve un problema con un trabajo", a: "Desde el trabajo, en tu panel, tocá «Tengo un problema». El equipo de Fixy revisa el caso con las dos partes y te responde por la plataforma y por correo." },
  { q: "Quiero cancelar o me arrepentí", a: <>Podés cancelar un pedido desde tu panel mientras no esté contratado. Si ya contrataste, tenés el <Link href="/arrepentimiento" className="underline">botón de arrepentimiento</Link> dentro de los 10 días.</> },
  { q: "No me llegan los avisos", a: "Revisá que las notificaciones de Fixy estén permitidas en los ajustes del teléfono y que tu correo esté bien escrito en «Mi cuenta». Los avisos también quedan en la campanita del panel." },
  { q: "Soy profesional: ¿cómo cobro?", a: `Cuando el cliente confirma el trabajo, el importe queda en tu saldo. Pedís el retiro desde «Cobros» y se transfiere a tu cuenta bancaria dentro de los ${LEGAL.withdrawalDays} días.` },
];

export default function HelpPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl">Ayuda y soporte</h1>
      <p className="mt-3 text-ink-2">Estamos para ayudarte con tu cuenta, un pedido, un pago o la app de Fixy.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <Mail className="h-6 w-6 text-fixy-800" aria-hidden />
          <h2 className="mt-3 text-lg">Escribinos por correo</h2>
          <p className="mt-1 text-sm text-muted">Te responde una persona del equipo. Lunes a viernes de 9 a 18 h; respondemos dentro de las 24 horas hábiles.</p>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-3 inline-block text-fixy-800 underline">{SUPPORT_EMAIL}</a>
        </Card>
        <Card>
          <MessageCircle className="h-6 w-6 text-fixy-800" aria-hidden />
          <h2 className="mt-3 text-lg">Asistente por WhatsApp</h2>
          <p className="mt-1 text-sm text-muted">Para pedir un servicio o consultar cómo funciona, a toda hora. Responde un asistente automático.</p>
          <a href={whatsappUrl()} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-fixy-800 underline">Abrir WhatsApp</a>
        </Card>
      </div>

      <section aria-labelledby="faq-t" className="mt-12">
        <h2 id="faq-t" className="text-2xl">Preguntas frecuentes</h2>
        <div className="mt-4 divide-y divide-line rounded-[var(--radius-card)] bg-surface">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-[17px] text-ink marker:hidden">{f.q}</summary>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="eliminar-cuenta" aria-labelledby="del-t" className="mt-12 scroll-mt-24">
        <Card>
          <Trash2 className="h-6 w-6 text-fixy-800" aria-hidden />
          <h2 id="del-t" className="mt-3 text-xl">Eliminar tu cuenta y tus datos</h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] text-ink-2">
            <li>Ingresá a Fixy (en la app o en {LEGAL.site}).</li>
            <li>Abrí <Link href="/app/cuenta" className="underline">Mi cuenta</Link> y bajá hasta «Eliminar mi cuenta».</li>
            <li>Escribí la palabra de confirmación y tocá «Eliminar».</li>
          </ol>
          <p className="mt-3 text-sm text-muted">
            Se borran tu nombre, correo, teléfono, direcciones, fotos y el vínculo con WhatsApp, y no podés volver a ingresar. Conservamos, sin datos que te identifiquen más de lo necesario, los
            comprobantes de pagos y trabajos que la ley nos obliga a guardar, por los plazos que fija la ley. Si tenés un trabajo o un pago en curso, primero hay que cerrarlo.
            ¿No podés ingresar? Pedí la baja a <a href={`mailto:${SUPPORT_EMAIL}`} className="underline">{SUPPORT_EMAIL}</a> desde el correo de tu cuenta. Más detalle en <Link href="/privacidad" className="underline">Privacidad</Link>.
          </p>
        </Card>
      </section>

      <p className="mt-8 flex items-start gap-2 text-sm text-muted">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Fixy no reemplaza a los servicios de emergencia. Ante olor a gas, fuego o riesgo para una persona, llamá al 911.
      </p>
      <p className="mt-2 text-sm text-muted">{LEGAL.company} · CUIT {LEGAL.cuit} · {LEGAL.address}</p>
    </article>
  );
}
