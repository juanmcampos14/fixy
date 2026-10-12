import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * Mascota Fixy (lámina conceptual raster). Usos según el manual:
 *  wave: bienvenida · listen: recopilar información · think: búsqueda (con estado textual real)
 *  celebrate: finalización confirmada · empathy: sin disponibilidad / ayuda.
 * Nunca en desgloses de pago, controles principales ni como sello de verificación.
 */
const POSES = {
  wave: { src: "/brand/v2/fixy-wave.webp", w: 422, h: 480 },
  listen: { src: "/brand/v2/fixy-listen.webp", w: 345, h: 385 },
  think: { src: "/brand/v2/fixy-think.webp", w: 289, h: 386 },
  celebrate: { src: "/brand/v2/fixy-celebrate.webp", w: 375, h: 381 },
  empathy: { src: "/brand/v2/fixy-empathy.webp", w: 285, h: 384 },
} as const;

export type MascotPose = keyof typeof POSES;

export function Mascot({ pose, className, priority, animate = true }: { pose: MascotPose; className?: string; priority?: boolean; animate?: boolean }) {
  const p = POSES[pose];
  const anim = animate ? (pose === "wave" ? "motion-safe:animate-wave origin-bottom" : "motion-safe:animate-pop-in") : "";
  return (
    <Image
      src={p.src}
      width={p.w}
      height={p.h}
      alt=""
      aria-hidden
      priority={priority}
      className={cn("pointer-events-none select-none object-contain", anim, className)}
    />
  );
}
