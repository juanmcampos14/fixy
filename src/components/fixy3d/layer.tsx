"use client";

import dynamic from "next/dynamic";

/** Carga el escenario 3D solo en el navegador y después de lo importante (no frena la primera pintura). */
const Stage = dynamic(() => import("./stage"), { ssr: false, loading: () => null });

export function FixyLayer() {
  return <Stage />;
}
