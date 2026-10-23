import { verifyOptOutToken } from "@/server/modules/supply-campaigns";
import { Card } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dejar de recibir mensajes", robots: { index: false } };

/**
 * Baja de los emails de captación. Pide confirmar con un botón: los programas que revisan los links de un email
 * no pueden dar de baja a nadie sin querer.
 */
export default async function OptOutPage({ searchParams }: { searchParams: Promise<{ t?: string; listo?: string }> }) {
  const { t, listo } = await searchParams;
  const valid = !!t && !!verifyOptOutToken(t);
  return (
    <article className="mx-auto max-w-xl px-4 py-12 sm:px-6">
      <Card className="p-6 sm:p-8">
        {listo ? (
          <>
            <h1 className="text-2xl font-bold">Listo, no te vamos a escribir más</h1>
            <p className="mt-3 text-[15px] text-ink-2">Quedó registrado tu pedido. Si alguna vez querés sumarte a Fixy, podés hacerlo desde fixy.solutions/sumate.</p>
          </>
        ) : valid ? (
          <>
            <h1 className="text-2xl font-bold">¿Dejar de recibir mensajes de Fixy?</h1>
            <p className="mt-3 text-[15px] text-ink-2">
              Te escribimos porque tu contacto comercial figura públicamente en internet. Si confirmás, no te vamos a volver a contactar
              para invitarte a Fixy, ni por email ni por WhatsApp.
            </p>
            <form method="post" action="/captacion/baja/confirmar" className="mt-6">
              <input type="hidden" name="t" value={t} />
              <button type="submit" className={buttonClass("primary", "lg")}>Sí, no quiero recibir más mensajes</button>
            </form>
            <p className="mt-4 text-sm text-muted">Fixy es un servicio de FLIPS S.R.L. Podés pedir el acceso o la supresión de tus datos escribiendo a través de fixy.solutions/ayuda.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">El link no es válido</h1>
            <p className="mt-3 text-[15px] text-ink-2">Revisá que esté completo, o escribinos desde fixy.solutions/ayuda y te damos de baja.</p>
          </>
        )}
      </Card>
    </article>
  );
}
