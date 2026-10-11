"use client";

import { useEffect, useRef, useState } from "react";
import { Mail, X } from "lucide-react";
import { SUPPORT_EMAIL, whatsappUrl } from "@/lib/contact";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.2h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.13-.15.17-.25.25-.42.08-.16.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.42h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  );
}

/** Botón flotante: el asistente de Fixy por WhatsApp, y la atención de una persona por mail. */
export function WhatsAppButton({ tone = "brand" }: { tone?: "brand" | "dark" } = {}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => panel.current && !panel.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={panel} className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6 print:hidden">
      {open && (
        <div id="contacto-fixy" role="dialog" aria-label="Contactar a Fixy" className="w-[min(20rem,calc(100vw-2rem))] rounded-2xl bg-white p-4 shadow-xl ring-1 ring-line">
          <div className="flex items-start justify-between gap-3">
            <p className="font-display text-lg font-extrabold">¿Te ayudamos?</p>
            <button type="button" onClick={() => setOpen(false)} className="-m-1 rounded-full p-1 text-muted hover:bg-ink/5" aria-label="Cerrar">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="mt-1 text-sm text-ink-2">Contale tu problema al asistente de Fixy por WhatsApp y te mostramos profesionales de tu zona. Responde al instante, a toda hora.</p>
          <a
            href={whatsappUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex h-12 items-center justify-center gap-2 rounded-full bg-[#25D366] px-5 font-semibold text-ink hover:brightness-95"
          >
            <WhatsAppIcon className="h-5 w-5" />
            Escribir por WhatsApp
          </a>
          <div className="mt-4 border-t border-line pt-3 text-sm">
            <p className="text-muted">¿Un trabajo grande, una obra o preferís hablar con una persona del equipo?</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="mt-1 inline-flex items-center gap-1.5 font-semibold text-fixy-800 underline">
              <Mail className="h-4 w-4" aria-hidden />
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="contacto-fixy"
        aria-label={open ? "Cerrar contacto" : "Contactar a Fixy por WhatsApp"}
        className={tone === "dark"
          ? "flex h-14 w-14 items-center justify-center rounded-full bg-obsidian text-ivory ring-1 ring-slate-line/50 transition hover:bg-[#30303f] focus-visible:outline-2 focus-visible:outline-ivory"
          : "flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg ring-4 ring-white transition hover:scale-105 focus-visible:outline-none focus-visible:ring-fixy-500/60"}
      >
        {open ? <X className="h-6 w-6" aria-hidden /> : <WhatsAppIcon className="h-7 w-7" />}
      </button>
    </div>
  );
}
