import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

/** Mensaje único sobre la privacidad de la dirección: usarlo en todos los lugares donde se carga o muestra. */
export function AddressPrivacyNote({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <p className={cn("flex items-start gap-2 rounded-xl bg-fixy-50 px-3 py-2 text-sm text-ink", className)}>
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-fixy-700" aria-hidden />
      <span>
        <strong>Tu dirección la ve y la protege solo Fixy.</strong>
        {compact ? " El profesional la recibe recién cuando se confirma la visita." : " Ningún profesional la ve al postularse: se la mostramos únicamente al que elegiste, cuando se confirma la visita. Antes solo ve la zona."}
      </span>
    </p>
  );
}
