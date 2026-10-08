import { Mascot, type MascotPose } from "@/components/brand/mascot";
import { cn } from "@/lib/cn";

export function EmptyState({ title, description, action, pose, icon, className }: { title: string; description?: React.ReactNode; action?: React.ReactNode; pose?: MascotPose; icon?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-[#d5e2df] bg-white/60 px-6 py-10 text-center", className)}>
      {pose ? <Mascot pose={pose} className="mb-3 h-24 w-auto" /> : icon ? <div className="mb-3 text-fixy-700">{icon}</div> : null}
      <h3 className="text-lg font-bold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
