"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 2500);
        } catch {}
      }}
      className="inline-flex h-12 items-center gap-2 rounded-full px-6 font-semibold text-white ring-1 ring-inset ring-white/30 hover:bg-white/10"
    >
      {done ? <Check className="h-5 w-5" aria-hidden /> : <Copy className="h-5 w-5" aria-hidden />}
      <span aria-live="polite">{done ? "¡Enlace copiado!" : "Copiar enlace"}</span>
    </button>
  );
}
