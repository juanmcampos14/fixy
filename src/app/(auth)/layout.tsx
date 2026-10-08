import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center px-4 sm:px-6">
        <Link href="/" aria-label="Fixy, inicio"><Logo size="sm" /></Link>
      </header>
      <main id="contenido" className="mx-auto max-w-md px-4 pb-16 pt-4 sm:pt-10">{children}</main>
    </div>
  );
}
