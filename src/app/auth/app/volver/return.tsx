"use client";

import { useEffect } from "react";

/** Intenta volver solo; si el navegador lo bloquea (pide un toque de la persona), queda el botón. */
export function ReturnToApp({ href }: { href: string }) {
  useEffect(() => {
    const t = setTimeout(() => { window.location.href = href; }, 250);
    return () => clearTimeout(t);
  }, [href]);
  return <a href={href} className="m-btn m-btn-primary mt-8 w-full">Volver a Fixy</a>;
}
