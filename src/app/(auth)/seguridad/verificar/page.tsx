import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { mfaStatus } from "@/server/modules/mfa";
import { Card } from "@/components/ui/card";
import { CodeForm } from "@/components/auth/recovery-codes";
import { verifyCodeAction } from "../actions";

export const metadata = { title: "Código de verificación", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/admin" } = await searchParams;
  const safe = next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
  const actor = await requireActor(`/seguridad/verificar?next=${encodeURIComponent(safe)}`);
  const status = await mfaStatus(actor);
  if (!status.enabled) redirect(status.available ? "/seguridad/segundo-factor" : safe);
  return (
    <>
      <h1 className="text-3xl font-extrabold">Código de verificación</h1>
      <p className="mt-2 text-ink-2">Abrí tu app de autenticación y escribí el código de Fixy. Si perdiste el celular, usá un código de respaldo.</p>
      <Card className="mt-6">
        <CodeForm action={verifyCodeAction} label="Código de 6 números o de respaldo" submit="Verificar" hidden={{ next: safe }} />
      </Card>
    </>
  );
}
