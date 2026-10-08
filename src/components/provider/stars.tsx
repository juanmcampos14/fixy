import { Star } from "lucide-react";
import { cn } from "@/lib/cn";

/** Calificación con texto accesible (no depende solo del ícono). */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  const full = Math.round(rating);
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span className="inline-flex" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} className={cn("h-4 w-4", i <= full ? "fill-spark text-spark" : "text-line")} />
        ))}
      </span>
      <span className="text-sm font-semibold">{rating.toLocaleString("es-AR", { maximumFractionDigits: 1 })} de 5</span>
    </span>
  );
}
