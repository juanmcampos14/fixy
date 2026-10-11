import { Zap, Droplets, Flame, Snowflake, WashingMachine, KeyRound, PaintRoller, BrickWall, Hammer, Sparkles, Wifi, Wrench, CircleHelp, Trees, Waves, Bug, Truck, Package, HardHat, DraftingCompass, Lamp, Umbrella, LayoutGrid, Layers, Fence, AppWindow, Gem, Cctv, Sun, Blinds, Armchair, Tv, HouseWifi, Heater, ArrowUpDown } from "lucide-react";

const MAP: Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  zap: Zap, droplets: Droplets, flame: Flame, snowflake: Snowflake, "washing-machine": WashingMachine, "key-round": KeyRound,
  "paint-roller": PaintRoller, "brick-wall": BrickWall, hammer: Hammer, sparkles: Sparkles, wifi: Wifi, wrench: Wrench, "circle-help": CircleHelp,
  trees: Trees, waves: Waves, bug: Bug, truck: Truck, package: Package, "hard-hat": HardHat, "drafting-compass": DraftingCompass, lamp: Lamp, umbrella: Umbrella,
  "layout-grid": LayoutGrid, layers: Layers, fence: Fence, "app-window": AppWindow, gem: Gem, cctv: Cctv, sun: Sun, blinds: Blinds, armchair: Armchair, tv: Tv,
  "house-wifi": HouseWifi, heater: Heater, "arrow-up-down": ArrowUpDown,
};

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const I = MAP[icon] ?? Wrench;
  return <I className={className} aria-hidden />;
}
