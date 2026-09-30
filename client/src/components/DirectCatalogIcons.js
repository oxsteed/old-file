import {
  AirVent,
  Bug,
  Car,
  Droplets,
  Flame,
  Gauge,
  GraduationCap,
  Hammer,
  HardHat,
  Home,
  KeyRound,
  Layers,
  MonitorSmartphone,
  Package,
  Paintbrush,
  PawPrint,
  Refrigerator,
  Ruler,
  Shield,
  ShieldCheck,
  Sparkles,
  Trees,
  Truck,
  Wrench,
  Zap,
} from 'lucide-react';

// Shared icon registry for the public Direct catalog. Category and tool rows
// carry an iconKey from the server; this map resolves it to a Lucide icon.
// Keep in sync with the server-side icon registry in server/migrations and
// the admin catalog UI.
export const DIRECT_CATALOG_ICONS = Object.freeze({
  wrench: Wrench,
  zap: Zap,
  droplets: Droplets,
  hammer: Hammer,
  paintbrush: Paintbrush,
  trees: Trees,
  ruler: Ruler,
  drill: Gauge,
  truck: Truck,
  'shield-check': ShieldCheck,
  refrigerator: Refrigerator,
  'air-vent': AirVent,
  sparkles: Sparkles,
  bug: Bug,
  'key-round': KeyRound,
  package: Package,
  car: Car,
  'monitor-smartphone': MonitorSmartphone,
  home: Home,
  layers: Layers,
  'hard-hat': HardHat,
  flame: Flame,
  shield: Shield,
  'paw-print': PawPrint,
  'graduation-cap': GraduationCap,
});

export function directCatalogIcon(iconKey) {
  return DIRECT_CATALOG_ICONS[iconKey] || Wrench;
}
