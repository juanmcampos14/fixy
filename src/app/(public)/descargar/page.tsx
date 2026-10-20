import Image from "next/image";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Apple, Smartphone } from "lucide-react";
import { inFixyApp } from "@/components/auth/google-button";
import { APP_STORE_URL, playStoreUrl, storeFor } from "@/lib/app-links";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Descargá la app",
  description: "Bajate la app de Fixy: pedí arreglos y seguí tus trabajos desde el celular, en toda la Argentina.",
};

/**
 * Link único para compartir la app (fixy.solutions/descargar): en Android va directo a Google Play,
 * en iPhone al App Store (cuando esté aprobada) y en la computadora muestra un QR.
 */
export default async function DownloadPage({ searchParams }: { searchParams: Promise<{ src?: string }> }) {
  if (await inFixyApp()) redirect("/");
  const { src } = await searchParams;
  const target = storeFor((await headers()).get("user-agent") ?? "");
  if (target === "android") redirect(playStoreUrl(src));
  if (target === "ios" && APP_STORE_URL) redirect(APP_STORE_URL);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl">Descargá la app de Fixy</h1>
      <p className="mt-3 text-ink-2">Pedí arreglos, compará profesionales y seguí tus trabajos desde el celular.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card>
          <Smartphone className="h-6 w-6 text-fixy-800" aria-hidden />
          <h2 className="mt-3 text-lg">Android</h2>
          <p className="mt-1 text-sm text-muted">Disponible en Google Play.</p>
          <a href={playStoreUrl(src)} className={buttonClass("primary", "md", "mt-4")}>Abrir Google Play</a>
        </Card>
        <Card>
          <Apple className="h-6 w-6 text-fixy-800" aria-hidden />
          <h2 className="mt-3 text-lg">iPhone</h2>
          {APP_STORE_URL ? (
            <>
              <p className="mt-1 text-sm text-muted">Disponible en el App Store.</p>
              <a href={APP_STORE_URL} className={buttonClass("primary", "md", "mt-4")}>Abrir App Store</a>
            </>
          ) : (
            <>
              <p className="mt-1 text-sm text-muted">Muy pronto en el App Store. Mientras tanto, usá Fixy desde el navegador: funciona igual.</p>
              <Link href="/solicitar" className={buttonClass("secondary", "md", "mt-4")}>Pedir un servicio</Link>
            </>
          )}
        </Card>
      </div>

      {target === "other" && (
        <div className="mt-8 hidden items-center gap-6 sm:flex">
          <Image src="/brand/qr-descargar.svg" alt="Código QR para descargar la app de Fixy" width={136} height={136} className="rounded-xl bg-white p-2" unoptimized />
          <p className="text-sm text-muted">¿Estás en la computadora? Escaneá el código con la cámara del celular y te lleva a la tienda que corresponde.</p>
        </div>
      )}
    </article>
  );
}
