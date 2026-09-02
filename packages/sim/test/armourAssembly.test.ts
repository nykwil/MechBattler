import { describe, expect, it } from 'vitest';
import {
  PARTS, assembleBuild, getChassis, getOccupiedCells, getPart, validateBuild,
  type PlacedPart, type Rotation,
} from '../src/index.js';

/**
 * Armour must be assemblable, in any wish order, on every chassis.
 *
 * Two independent breaks made every armour part unreachable by every search
 * that has ever run (docs/17 F29), and both produced output identical to dead
 * gear — docs/20 §7 gates 2 and 3 failing at the same time:
 *
 *  - `placeParts` refused any `overlap` from the grid's flat occupancy check.
 *    A cell already occupied is exactly where armour goes, and it is
 *    `checkSpatialPartPlacement` that decides whether the stack is legal. The
 *    workshop's own PLACE reducer has always tolerated `overlap` for this
 *    reason; the completer did not, so no armour could be auto-placed at all.
 *  - `assembleBuild` sorted the wish biggest-footprint-first, which put armour
 *    down before the part it has to cover existed. Armour is a dependent
 *    placement and has to go last, which is the opposite of `W-SR`'s rule and
 *    why it needs a separate sort key rather than a different size.
 *
 * Every armour part in the catalog is checked, so a new one cannot ship into
 * the same hole.
 */
const ARMOUR_IDS = Object.values(PARTS)
  .filter((def) => def.spatial?.layer === 'armour')
  .map((def) => def.id);

const CHASSIS = ['CH-2', 'CH-5', 'CH-9'];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

/** A footprint, normalised to its own bounding box, so shapes can be compared. */
function footprint(partId: string, rotation: Rotation): string {
  const cells = getOccupiedCells(
    { instanceId: 'probe', partId, origin: { x: 0, y: 0 }, rotation, integrity: 1 } as PlacedPart,
    getPart(partId),
  );
  const minX = Math.min(...cells.map((c) => c.x));
  const minY = Math.min(...cells.map((c) => c.y));
  return cells.map((c) => `${c.x - minX},${c.y - minY}`).sort().join('|');
}

/**
 * Something this armour can legally sit on. Armour covers one payload part
 * *exactly* (`footprint-mismatch`), so the set of parts it can protect is
 * decided entirely by its shape -- which is the whole of docs/17 F29. Derived
 * rather than listed, so a new armour shape is tested against whatever the
 * catalog actually offers it.
 */
function carrierFor(armourId: string): string | undefined {
  const shapes = new Set(ROTATIONS.map((r) => footprint(armourId, r)));
  return Object.values(PARTS).find((def) =>
    def.id !== armourId
    && (def.spatial?.layer ?? 'payload') === 'payload'
    && def.category === 'weapon'
    && ROTATIONS.some((r) => shapes.has(footprint(def.id, r))))?.id;
}

describe('armour is reachable by the completer', () => {
  it('has armour to test', () => {
    expect(ARMOUR_IDS.length).toBeGreaterThan(0);
  });

  it.each(ARMOUR_IDS)('%s has something in the catalog it can cover', (armourId) => {
    // An armour shape matching nothing is F18's "+0.0" as a part: unusable and
    // indistinguishable from useless.
    expect(carrierFor(armourId), `nothing enabled has ${armourId}'s footprint`).toBeDefined();
  });

  it.each(ARMOUR_IDS)('%s assembles somewhere beside a part it can cover', (armourId) => {
    // Deliberately not "on every chassis", and deliberately not "alone".
    // Assembling alone needs the seeded reactor to share the armour's own
    // footprint -- true of the Mantle at 2x2, false of the Carapace's 2-cell
    // line. And a chassis can refuse a legal-looking cover on its own terms:
    // the Vulture's hardpoint ceiling rejects a Carapace over a Stitcher with
    // `ceiling-exceeded`, which is the height rule working, not the completer
    // failing. What the fix guarantees is that armour is placeable *at all* --
    // before it, this was zero on every chassis for every armour part.
    const carrier = carrierFor(armourId)!;
    const anywhere = CHASSIS.some((chassisId) => assembleBuild({
      chassisId,
      parts: [{ partId: carrier, count: 1 }, { partId: armourId, count: 1 }],
    }).build.parts.some((part) => part.partId === armourId));
    expect(anywhere, `${armourId} could not be completed beside ${carrier} on any chassis`).toBe(true);
  });

  it.each(ARMOUR_IDS)('%s places whether it is listed first, middle or last', (armourId) => {
    // Genomes carry parts in arbitrary order, so a part that only survives one
    // ordering is silently lost by most of them (docs/17 F16).
    const carrier = carrierFor(armourId)!;
    const orders = [
      [{ partId: armourId, count: 1 }, { partId: carrier, count: 1 }, { partId: 'R-E25', count: 1 }],
      [{ partId: carrier, count: 1 }, { partId: armourId, count: 1 }, { partId: 'R-E25', count: 1 }],
      [{ partId: carrier, count: 1 }, { partId: 'R-E25', count: 1 }, { partId: armourId, count: 1 }],
    ];
    for (const chassisId of CHASSIS) {
      const counts = orders.map((parts) => assembleBuild({ chassisId, parts })
        .build.parts.filter((part) => part.partId === armourId).length);
      // Order-independence is the property, not success: whether this chassis
      // can take the armour at all is a geometry question, but it must not
      // depend on where the caller happened to list it. Before the sort fix
      // these read [0, 0, 1].
      expect(
        new Set(counts).size,
        `${armourId} on ${chassisId} depends on wish order: ${JSON.stringify(counts)}`,
      ).toBe(1);
    }
  });

  it('still hands back builds a player could have built by hand', () => {
    // Tolerating `overlap` is only safe because the spatial check is
    // authoritative. If that ever stops being true this is where it shows.
    for (const chassisId of CHASSIS) {
      for (const armourId of ARMOUR_IDS) {
        const report = assembleBuild({
          chassisId,
          parts: [{ partId: carrierFor(armourId)!, count: 1 }, { partId: armourId, count: 2 }],
        });
        const illegal = validateBuild(getChassis(chassisId), report.build)
          .filter((issue) => issue.code === 'illegal-placement' || issue.code === 'illegal-route');
        expect(illegal, `${armourId} on ${chassisId}`).toEqual([]);
      }
    }
  });
});
