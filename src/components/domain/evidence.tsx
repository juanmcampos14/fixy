/* eslint-disable @next/next/no-img-element */
import { formatDateTime } from "@/lib/format";

const KIND: Record<string, string> = { before: "Antes", progress: "Avance", after: "Después", note: "Nota" };

/** Las evidencias se muestran sin filtros que oculten detalles. Las URLs son temporales y privadas. */
export function EvidenceGallery({ items }: { items: { id: string; kind: string; note: string; url: string | null; created_at: Date; author: string | null }[] }) {
  if (!items.length) return <p className="text-sm text-muted">Todavía no hay avances registrados.</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {items.map((e) => (
        <li key={e.id} className="overflow-hidden rounded-2xl bg-cream/60 ring-1 ring-line">
          {e.url && (
            <a href={e.url} target="_blank" rel="noreferrer">
              <img src={e.url} alt={`Evidencia: ${e.note || KIND[e.kind]}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
            </a>
          )}
          <div className="p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-fixy-800">{KIND[e.kind] ?? e.kind}</p>
            {e.note && <p className="mt-0.5 text-[15px]">{e.note}</p>}
            <p className="mt-1 text-xs text-muted">{formatDateTime(e.created_at)}{e.author && ` · ${e.author}`}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
