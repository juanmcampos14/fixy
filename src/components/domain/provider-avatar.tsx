/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/cn";

/** Foto de perfil del profesional o, si no tiene, sus iniciales. `url` la arma el servidor (archivo público). */
export function ProviderAvatar({ url, name, className }: { url: string | null; name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return url ? (
    <img src={url} alt={`Foto de ${name}`} className={cn("shrink-0 rounded-full object-cover ring-2 ring-white", className)} loading="lazy" />
  ) : (
    <span className={cn("grid shrink-0 place-items-center rounded-full bg-fixy-50 font-extrabold text-fixy-800", className)} aria-hidden>{initials}</span>
  );
}
