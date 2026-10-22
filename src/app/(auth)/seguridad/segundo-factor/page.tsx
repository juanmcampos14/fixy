import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { requireActor } from "@/server/auth/session";
import { canAccessAdmin } from "@/server/auth/actor";
import { mfaStatus, startMfaEnrollment } from "@/server/modules/mfa";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { CodeForm } from "@/components/auth/recovery-codes";
import { confirmEnrollmentAction, regenerateCodesAction } from "../actions";

export const metadata = { title: "Segundo factor", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SecondFactorPage({ searchParams }: { searchParams: Promise<{ respaldo?: string }> }) {
  const actor = await requireActor("/seguridad/segundo-factor");
  if (!canAccessAdmin(actor)) redirect("/app/cuenta");
  const { respaldo } = await searchParams;
  const status = await mfaStatus(actor);

  if (!status.available) {
    return (
      <>
        <h1 className="text-3xl font-extrabold">Segundo factor</h1>
        <Alert tone="warn" className="mt-6">Falta configurar la clave del segundo factor en el servidor (MFA_ENCRYPTION_KEY). Mientras tanto, el panel funciona sin pedirlo.</Alert>
      </>
    );
  }

  if (status.enabled) {
    return (
      <>
        <h1 className="text-3xl font-extrabold">Segundo factor activado</h1>
        {respaldo !== undefined && (
          <Alert tone={Number(respaldo) <= 3 ? "warn" : "info"} className="mt-6">Usaste un código de respaldo. Te quedan {respaldo}. {Number(respaldo) <= 3 && "Generá códigos nuevos abajo."}</Alert>
        )}
        <p className="mt-3 text-ink-2">Cada vez que entres al panel de operación te vamos a pedir el código de tu app de autenticación. Te quedan {status.recoveryLeft} códigos de respaldo.</p>
        <Card className="mt-6">
          <h2 className="text-lg">Generar códigos de respaldo nuevos</h2>
          <p className="mb-3 mt-1 text-sm text-muted">Anula los anteriores. Necesitás un código de tu app.</p>
          <CodeForm action={regenerateCodesAction} label="Código de tu app" submit="Generar códigos nuevos" />
        </Card>
        <a href="/admin" className="mt-6 inline-block font-semibold text-fixy-800 underline">Ir al panel</a>
      </>
    );
  }

  const { secret, uri } = await startMfaEnrollment(actor);
  const qr = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#171721", light: "#ffffff" } });
  return (
    <>
      <h1 className="text-3xl font-extrabold">Activá el segundo factor</h1>
      <p className="mt-3 text-ink-2">El panel de operación maneja pagos y datos personales: además de la contraseña, te vamos a pedir un código que cambia cada 30 segundos.</p>
      <Card className="mt-6 space-y-4">
        <ol className="list-decimal space-y-2 pl-5 text-[15px] text-ink-2">
          <li>Instalá una app de autenticación: Google Authenticator, Microsoft Authenticator o la de tu gestor de contraseñas.</li>
          <li>Escaneá este código con la app.</li>
          <li>Escribí el código de 6 números que te muestra.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element -- imagen generada en el servidor (data URI), no hay nada que optimizar */}
        <img src={`data:image/svg+xml;base64,${Buffer.from(qr).toString("base64")}`} alt="Código QR para la app de autenticación" width={192} height={192} className="mx-auto rounded-xl bg-white p-2" />
        <p className="text-center text-xs text-muted">¿No podés escanear? Cargá esta clave a mano:<br /><span className="font-mono text-sm text-ink break-all">{secret.match(/.{1,4}/g)?.join(" ")}</span></p>
        <CodeForm action={confirmEnrollmentAction} label="Código de 6 números" submit="Activar" />
      </Card>
    </>
  );
}
