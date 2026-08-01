import type { ReactNode } from 'react';
import type { PartDef } from '@mechbattler/sim';
import { CATEGORY_COLOR } from '../lib/partVisuals.js';
import './PartPalette.css';

/**
 * True-scale shape preview: every cell renders at the same fixed size across
 * all parts, so a 1x1 conduit is visibly tiny and a 2x5 railgun is visibly
 * huge — the cell cost of a part is readable before you pick it up.
 */
export function ShapePreview({ def }: { def: PartDef }) {
  const minDx = Math.min(...def.shape.map((c) => c.dx));
  const minDy = Math.min(...def.shape.map((c) => c.dy));
  const maxDx = Math.max(...def.shape.map((c) => c.dx));
  const maxDy = Math.max(...def.shape.map((c) => c.dy));
  const w = maxDx - minDx + 1;
  const h = maxDy - minDy + 1;
  const occupied = new Set(def.shape.map((c) => `${c.dx - minDx},${c.dy - minDy}`));
  const color = CATEGORY_COLOR[def.category];

  const cells: ReactNode[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = occupied.has(`${x},${y}`);
      cells.push(
        <div
          key={`${x},${y}`}
          className="part-shape-cell"
          style={{ background: on ? color : 'transparent' }}
        />,
      );
    }
  }
  return (
    <div className="part-shape-box">
      <div
        className="part-shape"
        style={{
          gridTemplateColumns: `repeat(${w}, var(--shape-cell))`,
          gridTemplateRows: `repeat(${h}, var(--shape-cell))`,
        }}
      >
        {cells}
      </div>
    </div>
  );
}

/**
 * Quantified costs/outputs, each resource in its one app-wide color:
 * blue = energy, amber = heat, green = cooling, red = damage/hazard.
 */
export interface Chip {
  text: string;
  kind: 'energy' | 'heat' | 'cool' | 'dmg' | 'note';
}

export function chipsFor(def: PartDef): Chip[] {
  const chips: Chip[] = [];

  if (def.reactor) {
    chips.push({ text: `+${def.reactor.outputKw} kW`, kind: 'energy' });
    const waste = def.reactor.wasteHeatKw;
    chips.push({
      text: Array.isArray(waste) ? `${waste[0]}–${waste[1]} kW heat` : `${waste} kW heat`,
      kind: 'heat',
    });
  }
  if (def.capacitor) chips.push({ text: `${def.capacitor.storedKj} kJ buffer`, kind: 'energy' });

  if (def.weapon) {
    const dps = (def.weapon.damage * (def.weapon.salvoCount ?? 1)) / def.weapon.cycleS;
    chips.push({ text: `${dps.toFixed(1)} dps`, kind: 'dmg' });
    if (def.draw?.continuousKw) chips.push({ text: `−${def.draw.continuousKw} kW`, kind: 'energy' });
    if (def.draw?.chargedEnergyPerShotKj) chips.push({ text: `−${def.draw.chargedEnergyPerShotKj} kJ/shot`, kind: 'energy' });
    if (def.draw?.capFedEnergyPerShotKj) chips.push({ text: `−${def.draw.capFedEnergyPerShotKj} kJ/shot, caps only`, kind: 'energy' });
    if (def.heat?.heatPerShotKj) {
      chips.push({ text: `${(def.heat.heatPerShotKj / def.weapon.cycleS).toFixed(1)} kW heat`, kind: 'heat' });
    }
  } else if (def.draw?.continuousKw) {
    chips.push({ text: `−${def.draw.continuousKw} kW`, kind: 'energy' });
  }

  switch (def.id) {
    case 'U-CON': chips.push({ text: 'bridges power', kind: 'note' }); break;
    case 'U-PIPE': chips.push({ text: 'bridges heat ×4', kind: 'heat' }); break;
    case 'U-RAD': chips.push({ text: 'cools 6 kW', kind: 'cool' }); break;
    case 'U-HS': chips.push({ text: 'soaks heat ×6', kind: 'cool' }); break;
    case 'U-AMMO': chips.push({ text: 'cook-off @ 180°C', kind: 'dmg' }); break;
    case 'U-TC1': chips.push({ text: 'anti-strafe aim', kind: 'note' }); break;
    case 'U-ACT': chips.push({ text: '+15% speed', kind: 'note' }); break;
    case 'U-ARM': chips.push({ text: 'just gets hit', kind: 'note' }); break;
  }
  return chips;
}

export function ChipRow({ def }: { def: PartDef }) {
  return (
    <div className="part-chips">
      {chipsFor(def).map((c, i) => (
        <span key={i} className={`part-chip ${c.kind}`}>{c.text}</span>
      ))}
    </div>
  );
}
