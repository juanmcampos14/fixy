import { Alert } from "@/components/ui/alert";

export function LegalDraft({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-extrabold">{title}</h1>
      <Alert tone="warn" className="mt-4" title="Borrador pendiente de revisión legal">
        Este texto es un borrador de trabajo del MVP. No constituye una versión vigente ni afirma cumplimiento normativo validado.
      </Alert>
      <div className="mt-8 space-y-5 text-[15px] leading-relaxed text-ink-2 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </article>
  );
}
