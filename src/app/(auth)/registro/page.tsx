import Link from "next/link";
import type { Metadata } from "next";
import { Card } from "@/components/ui/card";
import { RegisterForm } from "./form";
import { GoogleButton } from "@/components/auth/google-button";
import { Mascot } from "@/components/brand/mascot";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string; tipo?: string }> }) {
  const { next, tipo } = await searchParams;
  const target = next ?? (tipo === "proveedor" ? "/proveedor/alta" : tipo === "organizacion" ? "/app/organizaciones/nueva" : "/app");
  const intro =
    tipo === "proveedor" ? "Primero creá tu cuenta. Después completás tu perfil profesional." :
    tipo === "organizacion" ? "Creá tu cuenta y después sumá tu organización y sus sedes." :
    "Con una sola cuenta podés pedir servicios y también ofrecerlos.";
  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold">Crear cuenta</h1>
          <p className="mt-1 text-muted">{intro}</p>
        </div>
        <Mascot pose="wave" className="h-20 w-auto" />
      </div>
      <Card className="mt-6">
        <GoogleButton next={target} signup />
        <RegisterForm next={target} />
        <p className="mt-5 text-center text-[15px] text-muted">
          ¿Ya tenés cuenta? <Link href={`/ingresar?next=${encodeURIComponent(target)}`} className="font-semibold text-fixy-800 underline">Ingresar</Link>
        </p>
      </Card>
    </>
  );
}
