import { HEAT_AMBIENT_C, HEAT_FIRE_HOLD_C, HEAT_SHUTDOWN_C } from '@mechbattler/sim';

/** Maps a cell temperature to a color on the workshop's amber/red heat scale. See docs/02 §3 thresholds. */
export function thermalColor(tempC: number): string {
  const stops: [number, [number, number, number]][] = [
    [HEAT_AMBIENT_C, [42, 58, 74]],    // ambient -- cool schematic blue-grey
    [75, [90, 169, 199]],              // warm blue (presentation-only midpoint)
    [HEAT_FIRE_HOLD_C, [232, 162, 61]], // warning amber (fire-control starts holding)
    [HEAT_SHUTDOWN_C, [214, 69, 69]],  // shutdown red
    [180, [255, 255, 255]],            // cook-off white-hot (docs/02 §3, U-AMMO only)
  ];
  let lo = stops[0]!;
  let hi = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    if (tempC >= stops[i]![0] && tempC <= stops[i + 1]![0]) {
      lo = stops[i]!;
      hi = stops[i + 1]!;
      break;
    }
  }
  if (tempC <= stops[0]![0]) return rgb(stops[0]![1]);
  if (tempC >= stops[stops.length - 1]![0]) return rgb(stops[stops.length - 1]![1]);
  const t = (tempC - lo[0]) / (hi[0] - lo[0]);
  const mixed: [number, number, number] = [0, 1, 2].map(
    (i) => Math.round(lo[1][i] + (hi[1][i] - lo[1][i]) * t),
  ) as [number, number, number];
  return rgb(mixed);
}

function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}
