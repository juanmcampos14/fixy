import { Zap, Droplets, Flame, Snowflake, WashingMachine, KeyRound, PaintRoller, BrickWall, Hammer, Sparkles, Wifi, Wrench, CircleHelp } from "lucide-react";

const MAP: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  zap: Zap, droplets: Droplets, flame: Flame, snowflake: Snowflake, "washing-machine": WashingMachine, "key-round": KeyRound,
  "paint-roller": PaintRoller, "brick-wall": BrickWall, hammer: Hammer, sparkles: Sparkles, wifi: Wifi, wrench: Wrench, "circle-help": CircleHelp,
};

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const I = MAP[icon] ?? Wrench;
  return <I className={className} aria-hidden />;
}
