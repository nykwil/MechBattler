# Spec 01 — Chassis Grid

> **Sim 2.0 spatial update:** ordinary combat no longer walks a penetration ray
> through successive grid cells or kills the reserved core directly. See
> `mechbattler_spatial_construction_mechanics.md` for the implemented regional,
> routing, stacking, exposed-ticket, and global chassis-integrity rules. The
> older ray/core passages below are retained as historical design context.

The unique centerpiece. Parts are polyominoes placed on a masked 2D cell grid; power routing
is physical; damage is locational. This doc is also home to the **canonical part catalog**
(placement + mass + HP); power/heat stats live in `02-power-heat-spec.md` and ballistic stats
in `03-combat-spec.md`, keyed by the same part IDs.

## 1. The grid

- Cell size: **0.5 m × 0.5 m**. A mech's physical footprint in the arena is its grid bounding
  box at this scale (a 5×4 chassis is 2.5 m × 2.0 m top-down).
- A chassis is a rectangular grid with a **mask** (some cells don't exist — irregular
  silhouettes are the norm). Orientation: grid "up" is the mech's forward facing.
- Every chassis has exactly one **core cell** marked on the mask. The core is pre-installed,
  immovable, and is the run's life: core destroyed = run over.
- Parts are **polyominoes** (1×1 up to 2×5 in v1). They may be rotated in 90° steps, not
  mirrored. One part per cell; no stacking, no overlap.
- **Irregular shapes are a design goal, not an accident** (the tetris element): the catalog
  should grow L/T/S-shaped parts, and salvage variants of a part may differ in shape (a
  "compact" L-shaped variant is worth more on a crowded chassis). Combined with masked
  grids, a part's outline becomes a per-chassis valuation — see `06-synergy-design.md` §6a.
- Parts never hang off the mask. If it doesn't fit, it doesn't go.

## 2. Chassis catalog (v0 starters)

Locomotion is a chassis property, not a part. Directional speeds and turn rates are the
chassis's rated values at **rated mass**; overloading degrades them (formula in
`03-combat-spec.md` §3).

| ID | Name | Type | Grid (usable cells) | Rated mass | Fwd / Strafe / Rev (m/s) | Turn (°/s) | Notes |
|---|---|---|---|---|---|---|---|
| CH-2 | Vulture | Scout biped | 3 regions / 5×4 projection (16) | 3.0 t | 9.0 / 3.0 / 2.5 | 150 | Hardpoints grant weapons +10% range |
| CH-5 | Mule | Quad | 3 regions / 6×6 projection (30) | 6.0 t | 6.0 / 4.0 / 3.0 | 90 | Shoulder weapons gain +25° arc; fresh-account starter |
| CH-9 | Bastion | Assault biped | 3 regions / 8×9 projection (55) | 12.0 t | 4.0 / 1.5 / 1.2 | 45 | Hull equipment generates 15% less heat |

Chassis are themselves salvage (defeating a frame unlocks it; see `04-salvage-economy-spec.md`).
Transplanting to a new chassis moves all parts to an unplaced pool; the player re-lays
everything out. That re-layout *is* the reward gameplay.

## 3. Power routing (mandatory, physical)

In the regional spatial model, free **Bus** routing handles ordinary runs and
may occupy both endpoints of a port to cross between regions. A port is also a
socket: a gun or other equipment fitted directly over one endpoint draws power
when the linked endpoint is energized. All edge-adjacent fitted components
conduct the standard 60 kW. `U-CON` is a compact, damageable **Power coupler**
for filling a deliberate connection point when no useful equipment belongs
there; Bus routing crosses empty cells without consuming equipment space.
The legacy flat build rules below remain in force for builds that do not opt into
spatial routes.

- Every part with a power draw must be **connected** to a reactor.
- Connection rule: a part is connected if it is **edge-adjacent to a reactor, or
  edge-adjacent to a conduit that has a conduit-path to a reactor**. Diagonals don't count.
- Conduits (`U-CON`) are 1×1 parts. A conduit chain's **capacity is the lowest-capacity
  segment on the path** (standard 60 kW). Total draw routed through a path must not exceed
  its capacity; the workshop shows per-segment load.
- Multiple reactors: the power network is pooled per connected network. Two disconnected
  networks are two independent power systems (legal, and a real redundancy strategy).
- Locomotion (the chassis drivetrain) taps power at the **core cell** — the core must be
  connected to a reactor like any other part.

Rationale: adjacency-counts-as-connection keeps small builds routing-free (no busywork), while
big builds with spread-out parts must spend cells on conduit trunks — the "rerouting
everything" fantasy appears exactly when the chassis gets crowded.

## 4. Heat topology (passive conduction + optional loops)

Likewise, free **Heat pipe** routing may cross a port when its linked endpoints
are routed. `U-PIPE` is the damageable **Thermal manifold** alternative for
heat-transfer equipment, including port bridges. Both provide the same 4×
conduction rate, but only the manifold occupies equipment space and can be
destroyed.

Full thermal model in `02-power-heat-spec.md`. Grid-relevant rules:

- Heat conducts between **edge-adjacent occupied cells** (empty masked cells don't conduct).
- Radiators (`U-RAD`) must occupy **perimeter cells** of the mask (they need exposure).
  This makes cooling shootable — armor placement vs. cooling exposure is a real trade.
- Heat pipes (`U-PIPE`, 1×1) conduct heat ~4× faster than structure and let you build
  deliberate thermal paths from hot parts (lasers, reactors) to radiators.

## 5. Locational damage

- Incoming hits resolve to an **entry cell** on the mech's perimeter based on impact bearing
  and impact point (resolution in `03-combat-spec.md` §6).
- Damage applies to the entry cell's occupant. Every part has HP (catalog below). When a
  part's HP reaches 0 it is **destroyed**: all its cells become wreck cells (they still
  conduct heat, still block penetration at 25% effectiveness, but do nothing).
- **Overkill penetrates**: damage beyond what destroyed the occupant continues along the
  projectile's travel line into the next cell at 50% of remaining damage.
- Destroying a conduit cell splits the power network. Downstream parts (no remaining path to
  a reactor) lose power immediately — mid-fight. This is why conduit redundancy matters.
- Multi-cell parts have one HP pool; a hit anywhere on the part damages the whole part.

## 6. Armor

- Armor plate (`U-ARM`) is a 1×1 part with high HP and no function. It exists to be hit.
- Since damage strikes perimeter cells first, armor is placed like armor: skinning the facing
  you intend to show the enemy. A mech that strafes exposes its flanks — armor layout and
  doctrine facing interact directly.

## 7. Canonical part catalog (v0) — placement, mass, HP

Stats in other columns live in their pillar's spec. Tier drives salvage/repair costs.

### Structural / utility

| ID | Name | Shape | Mass | HP | Tier | Placement rules |
|---|---|---|---|---|---|---|
| U-CON | Power coupler | 1×1 | 15 kg | 10 | 1 | Conductive equipment; can bridge a regional port |
| U-PIPE | Thermal manifold | 1×1 | 20 kg | 10 | 1 | Heat-transfer equipment; can bridge a regional port |
| U-RAD | Gill (radiator) | 1×3 | 100 kg | 25 | 2 | Perimeter cells only |
| U-HS | Brick (heat sink) | 1×1 | 60 kg | 20 | 1 | — |
| U-ARM | Plate (armor) | 1×1 | 150 kg | 60 | 1 | — |
| U-AMMO | Bin (ammo store) | 1×2 | 200 kg | 30 | 1 | Feeds adjacent or conduit-connected ballistic weapons; cook-off risk (see 02 §6) |
| U-TC1 | Abacus (targeting computer) | 1×1 | 50 kg | 15 | 2 | — |
| U-ACT | Stride (servo booster) | 1×2 | 160 kg | 25 | 2 | +15% all chassis speeds while powered |

### Power (details in 02)

| ID | Name | Shape | Mass | HP | Tier |
|---|---|---|---|---|---|
| R-C40 | Lump (combustion S) | 2×2 | 350 kg | 50 | 1 |
| R-C90 | Furnace (combustion M) | 3×3 | 900 kg | 90 | 3 |
| R-E25 | Whisper (electric S) | 2×2 | 300 kg | 45 | 1 |
| R-E60 | Arc (electric M) | 3×3 | 750 kg | 80 | 3 |
| P-CAP | Jolt (capacitor) | 1×2 | 90 kg | 20 | 2 |

### Weapons (ballistics in 03, power/heat in 02)

| ID | Name | Shape | Mass | HP | Tier | Mount arc (default) |
|---|---|---|---|---|---|---|
| W-MG | Stitcher (machine gun) | 1×2 | 120 kg | 25 | 1 | 90° |
| W-AC | Judge (autocannon) | 2×3 | 500 kg | 45 | 2 | 60° |
| W-LAS | Ember (laser) | 1×3 | 220 kg | 30 | 2 | 70° |
| W-RKT | Pepperbox (rocket pod) | 2×2 | 260 kg | 35 | 2 | 120° |
| W-RG | Longshot (railgun) | 2×5 | 1,400 kg | 70 | 4 | 30° |

Weapons must be placed with their muzzle row on a perimeter cell facing the arc they fire
into (forward by default; side/rear mounts are legal and change the arc's center bearing).
**A weapon can only fire while the target bearing is inside its mount arc** (03 §5) — arc
placement is a build decision the doctrine must live with.

### Location affinity (bonus/penalty by placement)

Where a part sits modifies how it performs — always shown on the placement preview before
the part is dropped (rule R5):

| Placement | Effect | Rationale |
|---|---|---|
| Weapon mounted rear-facing | Dispersion ×1.3 | Fire-control runs backward; awkward feed geometry |
| Weapon mounted side-facing | Dispersion ×1.15 | Milder version of the above |
| U-TC1 edge-adjacent to a weapon | That weapon ignores its facing dispersion penalty | Local fire-control shortens the signal path |
| U-AMMO edge-adjacent to its weapon | Weapon cycle ×0.9 | Direct feed, no belt run |
| Reactor on a perimeter cell | Takes +25% damage from hits | Exposed pressure vessel |
| U-HS edge-adjacent to reactor | Its thermal soak works at ×1.25 | Purpose-built engine cooling jacket |

Affinities are physical rationalizations, not tags (rule R1): each is a fixed consequence of
geometry the player can read off the grid, and each interacts with the systems that already
exist (a rear turret-less gun is worse — a rear gun *with* an adjacent targeting computer is
fine, which is itself a synergy; see `06-synergy-design.md` §3). v1 ships the table above
small and legible; grow it only where an affinity creates a *placement dilemma*, never as
flavor noise.

## 8. Mass and center of gravity

- Total mass = chassis structural mass (30% of rated mass) + sum of part masses.
- CoG = mass-weighted centroid of all placed parts (cell centers).
- Both are always-visible workshop stats and are first-class combat sim inputs (speed,
  acceleration, turn rate, recoil displacement, stagger — formulas in 03 §3). This is the
  hook the future IK/physics presentation hangs on.

## 9. Workshop editor requirements (for the prototype)

- Drag/rotate/place with instant legality feedback (mask fit, perimeter rules, overlap).
- Power network overlay: connected parts green, orphaned red, per-conduit load shown.
- Thermal overlay: predicted equilibrium temperature per cell under "all weapons firing".
- Every placement instantly updates the derived stats bar (rule R5): mass/rated,
  speed profile, burst DPS, sustained DPS, energy margin, time-to-overheat, brownout point,
  ideal range band.
- **Balance bars**: two always-visible net-flow gauges — energy balance (supply − demand;
  negative = draining capacitors, annotated with time-to-empty) and heat balance (net kW
  into vs. out of the build at predicted equilibrium). What the player is balancing must be
  on screen at all times, not derivable.
- **Inventory hover preview**: hovering any part in the palette/bench pool previews its
  delta on both balance bars and the stats bar *before* placement — browsing inventory is
  reading trade-offs, not reading flavor text.
- **Test bench**: run the real sim against a stationary/moving target dummy without leaving
  the workshop. Same code path as the arena (rule R6). Planned diagnostics extensions in
  02 §6.
- **Quick build audit** (planned, Jul 2026 notes intake): one button that inspects the
  current build and reports findings in three severities — **hard errors** (a required
  subsystem cannot function: orphaned reactor, weapon with no power path), **warnings**
  (functions but starved, knife-edge hot, arc-blocked, or never satisfies its firing gate),
  and **optimization notes** (works, but routing or cooling is wasteful). Principle: help
  the player *find* the problem; never make the building decision for them.
- **Auto-wire baseline** (planned, same intake): an optional operation that lays a
  functional (not optimal) conduit graph so a new player gets a running mech to improve,
  rather than a dead one to debug. Hand-routing remains the optimization game (05 R1
  routing-tedium mitigation).
- **Weapon arc visualization** (planned, same intake): placed weapons draw their mount arc
  as an overlay wedge in the workshop, so arc coverage/blind spots are a visible build
  property before the fight (rule R5) — arcs already gate fire in combat (03 §5).

## 10. Turret mounts (post-v1 design sketch)

Captured from design discussion — not in v1, but the grid rules should not preclude it.

- A **turret ring** is a base part (e.g. 2×2 or 3×3) whose cells are a sub-grid that hosts
  exactly one weapon of limited size (ring size caps hosted cells: 2×2 ring hosts ≤2-cell
  weapons, 3×3 hosts ≤4). This is the one sanctioned exception to "no stacking".
- The hosted weapon's mount arc **decouples from chassis facing**: 360° traverse (or a wide
  arc for cheaper rings), letting a kiting mech shoot behind itself — the verb set is
  unchanged (facing still steers the *chassis*; the turret tracks the target itself).
- Costs that keep it honest: ring mass + hosted weapon mass, a continuous traverse power
  draw, traverse rate limit (fast targets can out-turn a heavy turret), and a single point
  of failure — destroying the ring silences the hosted weapon even if the weapon is intact.
- Hit resolution: the turret sits "above" the deck; hits on its cells damage ring or hosted
  weapon (split TBD), so a turret is inherently more exposed than a hull mount.

## 11. Numbers that need prototype validation

- 16 cells (CH-2) enough for meaningful layout choices? 55 cells (CH-9) tedious?
- Adjacency-connection vs. conduit-trunk ratio: are conduits ~10–20% of cells on large
  builds? If more, routing is tedium (see `05-risk-review.md` R1).
- Wreck-cell penetration at 25%/50% — does deep coring happen too fast?
