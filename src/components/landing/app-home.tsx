import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Mascot } from "@/components/brand/mascot";

/**
 * Inicio dentro de la app (iOS/Android): una sola tarea por pantalla. Contar el problema o ingresar; nada más.
 * La web muestra la landing completa; en la app eso sería ruido.
 */
export function AppHome({ notice }: { notice?: string }) {
  return (
    <main id="contenido" className="mx-auto flex min-h-dvh max-w-md flex-col px-6 pb-[max(env(safe-area-inset-bottom),28px)] pt-[max(env(safe-area-inset-top),28px)]">
      <Logo variant="white" size="sm" />
      {notice && <p role="status" className="mt-4 rounded-xl bg-graphite px-4 py-3 text-[15px] text-ivory">{notice}</p>}

      <div className="flex flex-1 flex-col justify-center py-8">
        <Mascot pose="wave" priority className="h-28 w-auto self-start" />
        <h1 className="mt-6 text-[2rem]" style={{ lineHeight: 1.1 }}>¿Qué necesitás resolver?</h1>
        <p className="mt-3 text-ash">Contalo con tus palabras y te mostramos profesionales de tu zona.</p>
        <form action="/solicitar" method="get" className="mt-7 flex flex-col gap-3">
          <label htmlFor="app-q" className="sr-only">Contanos el problema</label>
          <textarea
            id="app-q" name="q" rows={3} maxLength={300} required
            placeholder="Ej.: pierde agua la canilla de la cocina"
            className="w-full resize-none rounded-2xl border border-control bg-graphite px-4 py-3.5 text-base text-ivory placeholder:text-ash/70 focus:border-ivory focus:outline-none"
          />
          <button className="m-btn m-btn-primary h-[52px] w-full">Buscar profesional <ArrowRight className="h-4 w-4" aria-hidden /></button>
        </form>
      </div>

      <div className="space-y-3">
        <Link href="/ingresar" className="m-btn m-btn-ghost h-[52px] w-full">Ingresar</Link>
        <p className="text-center text-sm text-ash">¿No tenés cuenta? <Link href="/registro" className="text-ivory underline">Crear cuenta</Link></p>
        {/* La app es para quien contrata; quien ofrece servicios tiene su entrada aparte, sin competir con lo principal. */}
        <p className="pt-2 text-center text-xs text-ash/80">¿Sos profesional? <Link href="/sumate" className="underline">Trabajá con Fixy</Link></p>
      </div>
    </main>
  );
}
