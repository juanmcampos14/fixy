import { cn } from "@/lib/cn";

/**
 * Logotipo provisional de Fixy reconstruido en vector a partir del concepto (docs/fixy-logo-concepto-v1.png).
 * Símbolo hexagonal con rostro y chispa + "fixy" en minúsculas. Pendiente: arte final vectorial certificado.
 */
export function FixySymbol({ className, variant = "color", title }: { className?: string; variant?: "color" | "ink" | "white"; title?: string }) {
  const body = variant === "color" ? "#14B8A6" : variant === "ink" ? "#15343B" : "#FFFFFF";
  const face = variant === "white" ? "#15343B" : variant === "ink" ? "#FFFFFF" : "#15343B";
  const spark = variant === "color" ? "#FF9B54" : body;
  return (
    <svg viewBox="0 0 100 100" className={className} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <path d="M50 16 L82 34.5 L82 70.5 L50 89 L18 70.5 L18 34.5 Z" fill={body} stroke={body} strokeWidth="12" strokeLinejoin="round" />
      <rect x="34" y="45" width="8" height="13" rx="4" fill={face} />
      <rect x="58" y="45" width="8" height="13" rx="4" fill={face} />
      <path d="M42 65 Q50 72 58 65" fill="none" stroke={face} strokeWidth="4.5" strokeLinecap="round" />
      <rect x="63" y="0" width="9" height="15" rx="3" fill={spark} transform="rotate(30 67 8)" />
    </svg>
  );
}

export function Logo({ className, variant = "color", size = "md" }: { className?: string; variant?: "color" | "ink" | "white"; size?: "sm" | "md" | "lg" }) {
  const text = variant === "white" ? "text-white" : "text-ink";
  const s = { sm: ["h-7 w-7", "text-[1.45rem]"], md: ["h-9 w-9", "text-[1.8rem]"], lg: ["h-14 w-14", "text-[2.8rem]"] }[size];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <FixySymbol className={cn(s[0], "shrink-0")} variant={variant} />
      <span className={cn("font-display font-extrabold lowercase leading-none tracking-[-0.04em]", s[1], text)}>fixy</span>
      <span className="sr-only">Fixy</span>
    </span>
  );
}
