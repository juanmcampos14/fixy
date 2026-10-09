import { LEGAL } from "@/lib/legal";

export function LegalDocument({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">{title}</h1>
      <p className="mt-2 text-sm text-muted">
        Versión {LEGAL.version} · Vigente desde el {LEGAL.effectiveDate} · {LEGAL.company} (CUIT {LEGAL.cuit}){LEGAL.address ? ` · ${LEGAL.address}` : ""}
      </p>
      <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink-2 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink [&_h3]:mt-5 [&_h3]:font-bold [&_h3]:text-ink [&_li]:ml-5 [&_li]:list-disc [&_ol>li]:list-decimal [&_strong]:text-ink">{children}</div>
    </article>
  );
}
