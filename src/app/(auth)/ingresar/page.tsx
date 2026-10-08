import Link from "next/link";
import type { Metadata } from "next";
import { demoLoginEnabled } from "@/server/env";
import { DEMO_USERS, demoEmail, DEMO_PASSWORD } from "@/server/seed/demo";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { LoginForm, DemoLogin } from "./forms";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; restablecida?: string }> }) {
  const { next = "", restablecida } = await searchParams;
  const demo = demoLoginEnabled();
  return (
    <>
      <h1 className="text-3xl font-extrabold">Ingresar</h1>
      <p className="mt-1 text-muted">¿Qué necesitás resolver hoy?</p>
      {restablecida && <Alert tone="ok" className="mt-6">Listo, actualizamos tu contraseña. Ya podés ingresar.</Alert>}
      <Card className="mt-6">
        <LoginForm next={next} />
        <p className="mt-4 text-center text-sm"><Link href="/recuperar" className="font-semibold text-fixy-800 underline">Olvidé mi contraseña</Link></p>
        <p className="mt-5 text-center text-[15px] text-muted">
          ¿No tenés cuenta? <Link href={`/registro${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-fixy-800 underline">Crear cuenta</Link>
        </p>
      </Card>
      {demo && (
        <section aria-labelledby="demo-title" className="mt-8">
          <h2 id="demo-title" className="text-lg font-bold">Accesos de demostración</h2>
          <p className="mt-1 text-sm text-muted">
            Solo en desarrollo. Cuentas ficticias por rol (contraseña: <code className="rounded bg-ink/5 px-1">{DEMO_PASSWORD}</code>).
          </p>
          <DemoLogin next={next} users={DEMO_USERS.map((u) => ({ email: demoEmail(u.key), name: u.name, desc: u.desc }))} />
        </section>
      )}
    </>
  );
}
