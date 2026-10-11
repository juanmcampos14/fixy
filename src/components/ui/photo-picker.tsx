"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, FileText, ImagePlus, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Lado mayor de las fotos al subir: alcanza para ver el detalle y pesa poco (Vercel admite ~4,5 MB por envío). */
const MAX_SIDE = 1600;
const QUALITY = 0.82;
/** Margen bajo el límite de la plataforma para todo el envío. */
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

type Item = { id: number; file: File; url: string | null };

/** Reduce y re-codifica la foto en el teléfono: pesa menos y pierde los metadatos (ubicación incluida). */
async function compress(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // formato que el navegador no puede leer (ej. HEIC en algunos equipos): va tal cual y lo valida el servidor
  }
}

/**
 * Selector de fotos (y opcionalmente PDF) cómodo en el celular: varias a la vez, cámara directa,
 * arrastrar y soltar, vista previa y quitar. Los archivos viajan en el input `name` del formulario.
 */
export function PhotoPicker({ name, max = 6, allowPdf = false, label = "Fotos", hint, className }: {
  name: string; max?: number; allowPdf?: boolean; label?: string; hint?: string; className?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const formInput = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // El input real del formulario siempre refleja la lista (ya comprimida).
  useEffect(() => {
    if (!formInput.current) return;
    const dt = new DataTransfer();
    items.forEach((i) => dt.items.add(i.file));
    formInput.current.files = dt.files;
  }, [items]);

  // Al enviarse y reiniciarse el formulario, se vacía la lista.
  useEffect(() => {
    const form = formInput.current?.form;
    if (!form) return;
    const onReset = () => setItems((xs) => { xs.forEach((x) => x.url && URL.revokeObjectURL(x.url)); return []; });
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  async function add(list: FileList | File[] | null) {
    if (!list?.length) return;
    setError(null);
    setBusy(true);
    const accepted = Array.from(list).filter((f) => f.type.startsWith("image/") || (allowPdf && f.type === "application/pdf"));
    if (accepted.length < Array.from(list).length) setError(allowPdf ? "Solo fotos (JPG, PNG, WEBP) o PDF." : "Solo fotos (JPG, PNG o WEBP).");
    const room = Math.max(0, max - items.length);
    if (accepted.length > room) setError(`Podés sumar hasta ${max} archivos por vez.`);
    const processed = await Promise.all(accepted.slice(0, room).map(compress));
    setItems((xs) => {
      const next = [...xs];
      for (const f of processed) next.push({ id: ++seq.current, file: f, url: f.type.startsWith("image/") ? URL.createObjectURL(f) : null });
      const total = next.reduce((s, i) => s + i.file.size, 0);
      if (total > MAX_TOTAL_BYTES) {
        setError("Es mucho para un solo envío: mandá estos y después sumá el resto.");
        while (next.length > xs.length && next.reduce((s, i) => s + i.file.size, 0) > MAX_TOTAL_BYTES) {
          const r = next.pop();
          if (r?.url) URL.revokeObjectURL(r.url);
        }
      }
      return next;
    });
    setBusy(false);
  }

  const remove = (id: number) => setItems((xs) => xs.filter((x) => { if (x.id === id && x.url) URL.revokeObjectURL(x.url); return x.id !== id; }));
  const accept = allowPdf ? "image/*,application/pdf" : "image/*";

  return (
    <div className={className}>
      <p className="mb-1.5 text-[15px] font-semibold">{label}</p>
      <input ref={formInput} type="file" name={name} multiple className="hidden" tabIndex={-1} aria-hidden />
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void add(e.dataTransfer.files); }}
        className={cn("rounded-2xl border border-dashed p-3 transition", drag ? "border-fixy-600 bg-fixy-50" : "border-control bg-surface")}
      >
        {items.length > 0 && (
          <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
            {items.map((i) => (
              <li key={i.id} className="relative overflow-hidden rounded-xl bg-cream ring-1 ring-line">
                {i.url ? (
                  <img src={i.url} alt="" className="aspect-square w-full object-cover" />
                ) : (
                  <span className="flex aspect-square flex-col items-center justify-center gap-1 p-2 text-center text-xs text-muted"><FileText className="h-6 w-6" aria-hidden /><span className="line-clamp-2 break-all">{i.file.name}</span></span>
                )}
                <button type="button" onClick={() => remove(i.id)} aria-label={`Quitar ${i.file.name}`}
                  className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-full bg-onyx/70 text-white hover:bg-onyx">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-fixy-50 px-4 font-semibold text-fixy-800 hover:bg-fixy-100 focus-within:ring-3 focus-within:ring-fixy-500/40">
            <ImagePlus className="h-4 w-4" aria-hidden />{items.length ? "Sumar más" : allowPdf ? "Elegir fotos o PDF" : "Elegir fotos"}
            <input type="file" accept={accept} multiple className="sr-only" disabled={items.length >= max} onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          </label>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full bg-surface px-4 font-semibold text-fixy-800 ring-1 ring-control hover:ring-fixy-500 focus-within:ring-3 focus-within:ring-fixy-500/40 sm:hidden">
            <Camera className="h-4 w-4" aria-hidden />Sacar foto
            <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={items.length >= max} onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
          </label>
          {busy && <span className="inline-flex items-center gap-1.5 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />Preparando…</span>}
          <span className="hidden text-sm text-muted sm:inline">o arrastralas acá</span>
        </div>
        <p className="mt-2 text-xs text-muted">{hint ?? `Hasta ${max} por vez. Las achicamos antes de subirlas para que vayan rápido.`}</p>
      </div>
      {error && <p role="alert" className="mt-1.5 text-sm text-warn">{error}</p>}
    </div>
  );
}
