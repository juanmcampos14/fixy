"use client";

import { useEffect } from "react";
import { fixy } from "@/components/fixy3d/events";

/** Elementos con data-fixy-hover="Texto": al pasar el mouse (o enfocarlos), Fixy los señala y lo dice. */
export function FixyHoverBridge() {
  useEffect(() => {
    let current: Element | null = null;
    const enter = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-fixy-hover]");
      if (!el || el === current) return;
      current = el;
      const r = el.getBoundingClientRect();
      fixy({ type: "look", x: r.left + r.width / 2, y: r.top + r.height / 2, label: (el as HTMLElement).dataset.fixyHover });
    };
    const leave = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-fixy-hover]");
      const to = (e as PointerEvent).relatedTarget as Element | null;
      if (el && el === current && !el.contains(to)) {
        current = null;
        fixy({ type: "unlook" });
      }
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    return () => {
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
    };
  }, []);
  return null;
}
