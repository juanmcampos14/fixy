"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

/** Carga el escenario 3D solo en el navegador y después de lo importante (no frena la primera pintura). */
const Stage = dynamic(() => import("./stage"), { ssr: false, loading: () => null });

/**
 * Fixy 3D recorre la página solo en pantallas anchas. En celular no hay lugar para que camine sin pasar por encima
 * del texto: ahí queda la ilustración fija en su sitio (ver FixySpot).
 */
export function FixyLayer() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide ? <Stage /> : null;
}
