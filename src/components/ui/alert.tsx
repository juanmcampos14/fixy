import { CircleCheck, Info, TriangleAlert, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/cn";

const styles = {
  info: ["bg-info-bg text-info ring-info/15", Info],
  ok: ["bg-ok-bg text-ok ring-ok/15", CircleCheck],
  warn: ["bg-warn-bg text-warn ring-warn/15", TriangleAlert],
  danger: ["bg-danger-bg text-danger ring-danger/15", OctagonAlert],
} as const;

export function Alert({ tone = "info", title, children, className, role }: { tone?: keyof typeof styles; title?: React.ReactNode; children?: React.ReactNode; className?: string; role?: "alert" | "status" }) {
  const [cls, Icon] = styles[tone];
  return (
    <div role={role ?? (tone === "danger" ? "alert" : "status")} className={cn("flex gap-3 rounded-2xl p-4 ring-1", cls, className)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 text-[15px] leading-relaxed">
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && "mt-0.5", "text-ink-2 [&_a]:font-semibold [&_a]:underline")}>{children}</div>}
      </div>
    </div>
  );
}
