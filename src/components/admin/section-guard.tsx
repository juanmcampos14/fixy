import { Eye } from "lucide-react";
import { requireSection } from "@/server/auth/session";
import type { AdminSection } from "@/server/auth/permissions";
import { ReadOnly } from "@/components/ui/form";

/** Layout de cada sección del admin: valida el permiso y, si es "solo ve", deshabilita las acciones. */
export async function SectionGuard({ section, children }: { section: AdminSection; children: React.ReactNode }) {
  const { readOnly } = await requireSection(section);
  return (
    <ReadOnly when={readOnly}>
      {readOnly && (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-cream px-3 py-2 text-sm text-ink-2 ring-1 ring-line">
          <Eye className="h-4 w-4 shrink-0" aria-hidden />Modo solo lectura: podés ver esta sección, pero no hacer cambios.
        </p>
      )}
      {children}
    </ReadOnly>
  );
}
