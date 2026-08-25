# Component height — design

*2026-08-24*

**Shipped 25 Aug 2026**, merged as `502cb0f`. This is the design as agreed and
as built: the arithmetic below is what `packages/sim/src/spatial.ts` implements.
Three claims in the first draft were wrong and were corrected before
implementation — the Mule's body is too shallow to put anything in front of a
three-row gun, a one-row bay is violated by a part hanging *into* it rather than
sitting in it, and one riser does not clear a gun. The plan beside this file
records what was actually built.

## The problem

A weapon's cells are its *mounting point*, not its barrel. Nothing in the grid
model says so, so a mech can bury a gun behind a reactor and the sim will
happily fire it through the reactor. There is also no way to say "this bay has a
low roof", and no way to buy your way out of a bad lane.

## The model

Every part occupies a whole number of **levels**. Every cell has a **ceiling**.
A part may be placed only where it fits under the ceiling of every cell it
covers. That is the entire mechanic.

Ceilings come from two places: the chassis (an interior bay with a low roof) and
weapons (a gun lowers the ceiling of everything in front of it, because its
barrel is in the way).

### Two new fields

Both live in `PartSpatialSpec` (`packages/sim/src/types.ts`), beside `layer` and
`stacksOn`, because they are spatial facts of the same kind:

| Field | Meaning | Default |
|---|---|---|
| `height` | Levels this part occupies. | `1` |
| `clearsForward` | The ceiling this part imposes on every cell ahead of it. Absent = imposes nothing. | absent |

`clearsForward` is authored, not derived. A derived `height - 2` reproduces the
common case and then lies about every interesting one: a low turret wants a
clear lane at height 3, a hull-down mortar wants to block nothing at all.

One field on the chassis: `ChassisSpec.clearanceZones`, a list of
`{ id, cells, height }` mirroring the existing `locationZones` shape.

| Field | Meaning | Default |
|---|---|---|
| `clearanceZones[].cells` | Cells sharing one authored roof. | none |
| `clearanceZones[].height` | Ceiling of those cells, before weapons lower it further. | — |

Cells in no zone are unbounded. This is per-cell, not per-region, on purpose: a
region-wide roof is too blunt. The Mule's shoulder regions are only two mask
rows deep, so a `rect(2,3)` gun cannot fit in one; a `clearance: 2` on the Mule's
body would not mean "guns go on the shoulders", it would mean the Mule can never
mount a big gun at all. A low roof has to be able to be one bay.

### The arithmetic

`stacksByCell` in `spatial.ts` is already ordered bottom-to-top, so within one
cell's stack:

```
base(p)     = sum of height(q) for every q below p in that cell
top(p)      = base(p) + height(p)
imposed(w)  = base(w) + clearsForward(w)          -- weapons only
```

and for a cell `c` in region `r` at `(x, y)`:

```
ceiling(c, excluding p) = min( height of c's clearance zone, if any,
                               imposed(w, x) for every weapon w != p in region r
                                             occupying some cell (x, y') with y' > y )
```

A part `p` may occupy cell `c` iff `top(p) <= ceiling(c, excluding p)`.

Two details the formula has to carry:

- **A weapon never blocks itself.** A `2x3` gun occupies three cells in its own
  lane; without the `w != p` exclusion its rear cells would impose a ceiling of 1
  on its front cells and no gun could ever be placed.
- **`imposed` is per lane.** A weapon spanning two columns sits on a separate
  stack in each, so it may be raised in one and not the other. It imposes
  `base(w in lane x) + clearsForward` on lane `x`, using its own base *in that
  lane*.

Forward is `-y`, and lanes are columns of constant `x`. This is not a new
convention: `exposedEquipmentTickets` (`spatial.ts:260`) already lanes by `x` and
takes the nearest `y` as "front".

Blocking never crosses a region seam. The Vulture's hardpoints are arms, not
parts of the hull; hull equipment at the same projected `x` does not occlude a
gun in a pod. This matches connectivity, which never crosses a seam without a
port.

### Why a ceiling and not a check

Expressed as a ceiling, the rule is order-independent: whether the gun or the
thing in front of it is placed first, the second one is refused. A rule phrased
as "a weapon may not be placed behind a tall part" would need a second,
mirror-image rule for the other order, and the two would drift.

### Risers and turret mounts

Raised mounting is a support-layer part the gun stacks on. Placing a part on one
raises its `base`, which raises `top` *and* `imposed` together — so a raised gun
both stands taller and tolerates more in its lane. Stacking firepower in one lane
is therefore bought with mass and a support slot, which is the intended answer to
"one gun per lane".

The progression is one level per riser, and it takes two to stack guns: a gun
stands 3 and clears 1, so clearing another gun needs a base of 2. One riser buys
you a reactor in the lane; two buy you a second gun. That is the intended shape,
not an off-by-one.

`U-TUR` (Gimbal, turret support) becomes the first of these: it is already a
support part weapons stack on, and already carries `weaponArcBonusDeg: 25`, so
`height: 1` makes the turret mount a raised mount that also swings wider. A
raised mount that costs power and gives arc is a better first riser than a dumb
block.

Stacks require identical footprints (`sameCells` → `footprint-mismatch`), so a
riser exists per shape rather than per part. Guns come in five shapes; risers
cover three:

| Riser | Shape | Raises |
|---|---|---|
| `U-RISE2` | `rect(2, 2)` | `W-RKT`, `W-SC` |
| `U-RISE3` | `rect(2, 3)` | `W-AC`, `W-BR` |
| `U-RISEL` | `line(3)` | `W-LAS`, `W-ION` |
| (`U-TUR`) | `line(2)` | `W-MG`, `W-CB` |

`W-RG` (railgun, `rect(2,5)`) has no riser and cannot be raised. A gun that size
sits where it sits.

Every riser is `layer: 'support'`, `height: 1`, `stacksOn: ['support']` — so two
risers stack for height 2, and a gimbal may sit on a riser. Height 2 is a
quantity of risers, not a second part.

Every weapon gains `stacksOn: ['support']`. Only `W-MG` declares it today, which
is why nothing but the machine gun can currently sit on a gimbal.

### Armour is height 0

`U-ARM` and `U-SHELL` are skins over a payload part. Giving them a height would
make plating a gun illegal wherever the gun already reaches the ceiling, and
would raise a silhouette that physically did not change. They occupy no level.

## Authored values

Starting point, to be adjusted once the stock builds are re-laid:

| Part | height | clearsForward |
|---|---|---|
| Guns (`W-AC`, `W-RG`, `W-BR`, `W-LAS`, `W-RKT`, `W-ION`) | 3 | 1 |
| Small guns (`W-MG`, `W-CB`, `W-SC`) | 1 | 0 |
| Reactors, capacitors | 2 | — |
| Utility, ammo, heat sinks, radiators, conduit | 1 | — |
| `U-TUR` (gimbal), risers | 1 | — |
| `U-ARM`, `U-SHELL` | 0 | — |
| Risers (new) | 1 / 2 | — |

A small gun sits low and has no clearance at all in front of it: nothing may
share its lane forward, not even a wire run's worth of equipment. That is the
trade for its size.

One authored clearance zone, so the field is a mechanic and not a dead type:
the **Mule's rear body row** — `body` cells `(1,5) (2,5) (3,5) (4,5)`, the
`.####.` row — is a cargo bay with `height: 1`. Only flat equipment goes in the
hauler's boot: ammo, sinks, wiring. Not a reactor, not a gun. The rest of the
hull is untouched, so the Mule keeps every weapon it can mount today.

## Where the code goes

- **Rule**: `checkSpatialPartPlacement` (`spatial.ts:120`). `validateWholeBuildPlacement`
  already drives it part-by-part, and `useBuild.ts:113` already calls it to
  colour the workshop ghost, so a refused placement turns the ghost red with no
  UI work.
- **Two failure reasons**, so the message can be right in both directions:
  - `ceiling-exceeded` — this part is too tall for where you are putting it.
  - `blocks-firing-lane` — this weapon would bury something already in front of it.
  Both added to `SpatialPlacementReason` and to the reason→message map in
  `App.tsx:53`.
- **Part card**: show height, and show `clearsForward` on weapons as the
  clearance they demand. A player cannot plan a lane they cannot read.
- **`combat.ts`: untouched.** This is a placement rule. A built mech has no
  blocked weapons, because it could not have been built with one.

## Content

Stock content is re-authorable — the game is not shipped and nothing needs
preserving. `templates.ts`, the ladder builds, the starter blueprint and
`adaptation.ts`'s auto-placer all assert clean placement, and any of them may
need re-laying once guns are three levels tall. That is the work, not a
follow-up.

`adaptation.ts` deserves attention rather than a re-lay: it *places parts by
itself* between fights, so it must learn the ceiling or it will generate illegal
fittings. Its placement search already consults `checkPlacement`; it needs to
consult the ceiling too, and a riser is a legal thing for it to add.

## Testing

Unit, in `packages/sim/test`:

- a height-3 gun refuses a height-2 part placed ahead of it in the same lane, and
  accepts a height-1 one
- the same two placements in the opposite order fail identically (order
  independence)
- a riser under the gun raises both its top and the ceiling it imposes, so a
  second gun fits in front
- `clearsForward: 0` refuses everything forward in the lane
- a part in another region at the same projected `x` is never blocked
- armour stacks onto a gun that is already at the ceiling
- a region `clearance` refuses a taller part with no weapon involved

Then the existing suites — `grid.test.ts`, `ladder.test.ts`, `adaptation.test.ts`,
`templates.test.ts` and `npm run game:audit` — must pass against re-laid content.

Then look at the workshop: place a gun, drag a reactor in front of it, and see
the ghost go red with the right message (`npm run web:shot`, per CLAUDE.md).

## Balance

Legal layouts change, so builds change and the balance report will move. Per the
working agreement this is noted, not gated, and the baseline is not re-cut to
make the swing go away.
