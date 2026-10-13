import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Mascot } from "@/components/brand/mascot";
import { peekLoginLink } from "@/server/whatsapp/pro-signup";
import { whatsappUrl } from "@/lib/contact";
import { enterAction } from "./actions";

export const metadata = { title: "Entrar a Fixy", robots: { index: false } };
export const dynamic = "force-dynamic";

/**
 * Link de ingreso que manda el WhatsApp de Fixy. Abrirlo no inicia sesión (WhatsApp previsualiza los links):
 * hace falta tocar el botón, y ahí el link se gasta.
 */
export default async function EnterFromWhatsApp({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { token } = await params;
  const link = (await searchParams).e ? null : await peekLoginLink(token);
  return (
    <main id="contenido" className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center px-6 text-center">
      <Logo variant="white" />
      {link ? (
        <>
          <Mascot pose="wave" priority className="mt-8 h-32 w-auto" />
          <h1 className="mt-5 text-3xl">¡Hola, {link.firstName}!</h1>
          <p className="mt-2 text-lg text-muted">Tocá el botón para entrar.</p>
          <form action={enterAction} className="mt-8 w-full">
            <input type="hidden" name="token" value={token} />
            <button className="m-btn m-btn-primary h-16 w-full text-xl">Entrar a Fixy</button>
          </form>
        </>
      ) : (
        <>
          <Mascot pose="empathy" className="mt-8 h-28 w-auto" />
          <h1 className="mt-5 text-2xl">Este link ya no sirve</h1>
          <p className="mt-2 text-muted">Los links para entrar duran 15 minutos y se usan una sola vez. Pedí uno nuevo escribiendo <strong>entrar</strong> al WhatsApp de Fixy.</p>
          <Link href={whatsappUrl("entrar")} className="m-btn m-btn-primary mt-8 h-14 w-full text-lg">Pedir otro link</Link>
        </>
      )}
    </main>
  );
}
