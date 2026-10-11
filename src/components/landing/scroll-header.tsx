"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/** Barra superior transparente sobre el hero; al scrollear toma un fondo esmerilado para separarse del contenido. */
export function ScrollHeader({ children }: { children: React.ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header className={cn("sticky top-0 z-40 transition-colors duration-300", scrolled ? "bg-onyx/80 backdrop-blur-xl" : "bg-transparent")}>
      {children}
    </header>
  );
}
