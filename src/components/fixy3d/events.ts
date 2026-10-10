/** Mensajes de la página a Fixy (sin acoplar componentes): hablar, mirar algo o hacer una acción un rato. */
import type { FixyAction } from "./model";

export type FixyEvent =
  | { type: "say"; text: string; ms?: number }
  | { type: "look"; x: number; y: number; label?: string }
  | { type: "unlook" }
  | { type: "act"; action: FixyAction; ms?: number }
  | { type: "jump" };

const NAME = "fixy";

export function fixy(e: FixyEvent) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<FixyEvent>(NAME, { detail: e }));
}

export function onFixy(cb: (e: FixyEvent) => void) {
  const h = (ev: Event) => cb((ev as CustomEvent<FixyEvent>).detail);
  window.addEventListener(NAME, h);
  return () => window.removeEventListener(NAME, h);
}
