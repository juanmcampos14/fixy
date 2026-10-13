import { MessageCircle } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { whatsappUrl } from "@/lib/contact";
import Link from "next/link";
import type { Metadata } from "next";
import { demoLoginEnabled } from "@/server/env";
import { DEMO_USERS, demoEmail, DEMO_PASSWORD } from "@/server/seed/demo";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { LoginForm, DemoLogin } from "./forms";
import { GoogleButton } from "@/components/auth/google-button";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; restablecida?: string; aviso?: string }> }) {
  const { next = "", restablecida, aviso } = await searchParams;
  const demo = demoLoginEnabled();
  return (
    <>
      <h1 className="text-3xl font-extrabold">Ingresar</h1>
      <p className="mt-1 text-muted">¿Qué necesitás resolver hoy?</p>
      {restablecida && <Alert tone="ok" className="mt-6">Listo, actualizamos tu contraseña. Ya podés ingresar.</Alert>}
      {aviso && <Alert tone="warn" className="mt-6">{aviso.slice(0, 200)}</Alert>}
      <Card className="mt-6">
        <GoogleButton next={next} signup />
        <LoginForm next={next} />
        <p className="mt-4 text-center text-sm"><Link href="/recuperar" className="font-semibold text-fixy-800 underline">Olvidé mi contraseña</Link></p>
        {/* Tercera forma de entrar, igual de visible que las otras: para quien se anotó por WhatsApp y no tiene clave. */}
        <div className="mt-5 flex items-center gap-3 text-sm text-muted" aria-hidden>
          <span className="h-px flex-1 bg-line" />o sin clave<span className="h-px flex-1 bg-line" />
        </div>
        <a href={whatsappUrl("entrar")} className={buttonClass("secondary", "lg", "mt-4 w-full")}>
          <MessageCircle className="h-5 w-5" aria-hidden />Entrar con WhatsApp
        </a>
        <p className="mt-2 text-center text-sm text-muted">Si te anotaste por WhatsApp: mandá el mensaje que aparece y te llega un link para entrar.</p>
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
