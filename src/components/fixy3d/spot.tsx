import type { FixyAction } from "./model";
import { Mascot, type MascotPose } from "@/components/brand/mascot";
import { cn } from "@/lib/cn";

/**
 * Lugar de Fixy en una sección: Fixy 3D camina hasta acá, hace `action` y dice `say`.
 * Muestra la ilustración fija como respaldo (sin WebGL o con movimiento reducido) y para reservar el espacio.
 */
export function FixySpot({ action, say, pose, className, size, mobileInline }: {
  action: FixyAction; say?: string; pose: MascotPose; className?: string; size?: number; mobileInline?: boolean;
}) {
  return (
    <div
      data-fixy
      data-fixy-action={action}
      data-fixy-say={say}
      data-fixy-size={size}
      data-fixy-mobile={mobileInline ? "inline" : undefined}
      className={cn("relative", className)}
      aria-hidden
    >
      <Mascot pose={pose} className="fixy-fallback h-full w-auto" />
    </div>
  );
}
