# Spec 06 — Synergy Design

Synergies are the heart of the build game. Rule R1 forbids tag/proc synergies ("+15% when X"),
so every synergy here is a **physical coupling**: two parts interact because of watts, joules,
degrees, cells, or geometry. This doc catalogs the synergy classes the sim already produces,
names archetype builds that exploit them, and lists the design levers that widen the space.

The test for a good synergy: *the player can discover it by reasoning about the physics,
verify it on the test bench, and see it pay off (or fail) legibly in the arena* (rules R4, R5).

## 1. Power-graph synergies (who feeds whom)

| Synergy | Physics | Archetype |
|---|---|---|
| **Capacitor bank + burst weapon** | Caps decouple *generation* from *output*: a 40 kW reactor fires a 220 kW railgun because 4 caps buffer the difference. The energy bar goes negative (draining stored kJ) after each shot | "Railgun Mule" (02 §4) |
| **Cap buffer + everything** | Even non-cap-fed weapons benefit: caps absorb demand spikes so the brownout never triggers. Caps are the power system's shock absorber | Any build living near its energy margin |
| **Hybrid reactors** | Combustion = raw watts, slow throttle, hot. Electric = instant, cool, watt-poor. One of each: electric carries idle load instantly, combustion spools up for sustained fire | "Mule tinkerer" starter (04 §6) |
| **Split networks** | Two disconnected reactor networks = full redundancy. Losing one conduit trunk can't kill both guns | Twin-boom builds on wide chassis |
| **Priority as combo enabler** | Putting locomotion *below* the guns turns firing into a planted alpha-strike; above, the guns politely wait. Same parts, opposite doctrine — authored with zero extra parts | "Stop-and-pop" vs "run-and-gun" |
| **Servo booster economics** | Stride (+15% speed, 4 kW) is worth more per kW on light fast chassis — speed multiplies an already-high base | Vulture skirmishers |

## 2. Thermal synergies (where the heat goes)

| Synergy | Physics | Archetype |
|---|---|---|
| **Heat-pipe highway** | Pipes conduct 4× faster: a deliberate path laser → pipe → pipe → radiator moves ~4.8 kW that plain structure can't. The pipe cells are themselves a shootable subsystem | "Laser boat" (02 §5) |
| **Heat sink as burst buffer** | U-HS has 6× thermal mass — it doesn't dissipate, it *soaks*. Adjacent to a burst weapon it flattens the temperature spike so short fights never hit 130°C. Buffers win sprints, radiators win marathons | Brawlers betting on 45-second fights |
| **Air-gap insulation** | Empty masked cells don't conduct. A one-cell moat around the ammo bin means the laser next door can't cook it | Any build mixing ammo and energy weapons |
| **Reactor–radiator pairing** | A combustion reactor above half load makes ~6 kW of waste heat — one radiator's full capacity. The pairing is almost mandatory; skipping it is a legal bet that fights end fast | Every combustion build |
| **Wreck cells as heat mass** | Destroyed parts keep conducting heat. A dead armor plate is still a heat spreader — mid-fight thermal topology *changes* as parts die | Emergent, not built |
| **Cold-soaked quirk on a hot part** | Thermal mass ×2 = heats *and* cools slowly. On a burst weapon that's a free heat sink; on a sustained-fire part it's a trap (never cools between fights... of the same battle) | Quirk-driven refit decisions |
| **(Backlog) water cooling** | Radiators ×3 in water: a radiator-stacked build fights for the pond and wins wars of attrition there | "Swamp monster" — see terrain intel (04 §5) |

## 3. Spatial / geometric synergies (where things sit)

| Synergy | Physics | Archetype |
|---|---|---|
| **Armor skinning × doctrine facing** | Hits sample directionally visible equipment cells. Front armor + "face target" doctrine makes protection matter, while flank pressure exposes a different ticket set | Gunline vs mobile skirmisher |
| **Radiator placement × kiting** | A kiter shows its rear while retreating — rear-mounted radiators on a kiting build get shot off exactly when needed most. Put cooling on the face you *don't* show | Range builds |
| **Sacrificial meat** | Overkill penetrates at 50%, wreck cells absorb at 25%. Cheap 1×1 parts layered in front of the core are ablative armor that costs scrap, not function | "Onion" builds on big chassis |
| **Conduit loops** | A ring topology means any single conduit kill leaves an alternate path. Costs cells; pure redundancy | Large-chassis trunk builds |
| **CoG centering** | Turn rate × (1 − 0.5 × offset). A railgun (1.4 t) on one wing needs counter-mass on the other or the mech turns like a barge — mass placement is a stat | Every asymmetric build |
| **Tetris pressure** (§6 below) | Irregular part shapes + irregular masks: the L-shaped reactor that fits the Vulture's shoulder notch is *worth more on that chassis*. Shape is a stat | Chassis-specific part valuations |

## 4. Doctrine / envelope synergies (how it fights)

| Synergy | Physics | Archetype |
|---|---|---|
| **Envelope matching** | The ideal range band is the intersection of weapon envelopes. All-brawl or all-snipe = tight band, confident autopilot. Mixed = disjoint band, the workshop warns, the mech dithers | Themed arsenals beat "good stuff" piles |
| **Targeting computer × precision** | U-TC1 raises prediction quality 0.40 → 0.75 (counter-juke). Worthless on a shotgun spread, transformative on a 1.2 mrad railgun | Sniper builds |
| **Creep discipline** | Precision weapons trigger autopilot creep (dispersion ×0.7). A precision build is *automatically* a slow build — pair with long envelopes so slow is safe | Railgun/laser platforms |
| **Shoulder articulation × facing** | Mule shoulder weapons gain +25° arc, allowing a mobile gunline to keep firing through turns; body-mounted weapons pay their authored arc | Mule shoulder builds |
| **Stationary turret** | Destination "none" is legal: zero locomotion draw frees the whole reactor for guns and cooling. Pure area denial; pays for it in salvage position | "Bunker" builds |
| **Mission-kill hunting** | Shooting weapons off (they're perimeter parts by rule) triggers surrender and leaves non-weapon loot pristine. A precise low-DPS build farms *better salvage* than an alpha-striker | Economy-optimized runs (04 §2) |

## 5. Quirk synergies (making flaws load-bearing)

Quirks are assigned, never chosen — the synergy game is *placement and priority that neutralize
flaws or amplify gifts*:

- **Miswired** (always sheds first) on a part you'd shed first anyway (e.g. Stride) — the flaw
  costs nothing.
- **Leaky** (+20% draw as heat) placed adjacent to a radiator — the leak drains away.
- **Overvolted reactor** (+12% output, −25% HP) buried center-grid behind sacrificial cells —
  fragility mitigated by geometry.
- **Hot-running** on a part at the end of a heat-pipe highway that had spare capacity.
- **Frankensteined** (−10% mass) on the heaviest part you own — mass savings scale.

The wreck screen shows where the enemy placed their quirked parts (04 §2) — reading *their*
mitigation teaches the player the pattern language.

## 6. New mechanics that widen the space (captured from design discussion)

These are captured here with intent; placement/spec details land in the pillar docs.

### 6a. Irregular part shapes — the tetris element (v1)

The catalog currently uses only rectangles. Widen to true polyominoes: L, T, S/Z shapes
(e.g. an L-shaped 4-cell reactor variant, a T-shaped autocannon whose stem is the ammo feed).
Salvage variants of the same part may differ *in shape* — a "compact" Judge worth more on a
crowded chassis. Combined with irregular chassis masks, shape becomes a per-chassis valuation:
synergy between a part's outline and *this* mech's leftover holes. Spec: 01 §7.

### 6b. Turret mounts (post-v1 sketch)

A turret ring is a base part that hosts a small weapon and decouples its arc from chassis
facing (fire while fleeing — the kiting railgun fantasy). Costs: cells, mass, traverse power,
and a single point of failure (kill the ring, silence the gun). Full sketch: 01 §11.
Interacts with: kiting doctrine (§4), rear-radiator placement (§3).

### 6c. Mount minimums vs. warn-only (open question)

Idea: hard build-time requirements — "this gun needs ≥10 kW of network supply to mount at
all" (it may still draw 12 kW when firing, covered by caps). Current philosophy is warn-only
(knowingly flawed builds are legal; the workshop flags, never forbids — except physical
impossibility like a cap-fed railgun with zero caps). Tension: hard gates teach faster and
prevent frustrating no-op builds; warn-only preserves the "legal but stupid" experimentation
space. **Proposal: keep warn-only, but make the warning state loud** (red part outline +
"CANNOT SUSTAIN FIRE" on the stats bar). Revisit after playtests. Spec note: 02 §2.

### 6d. Energy balance readability — the negative bar

The capacitor model already allows demand > generation (draw down stored kJ). Surface it as
the player imagines it: one **energy balance bar** showing net flow — positive = charging,
negative = draining caps, with time-to-empty at current draw. Same treatment for heat: net
kW into vs. out of the build at equilibrium. Both visible in the workshop *and* while
browsing inventory (hovering any part previews its delta on both bars before placement).
Spec: 01 §9.

### 6e. Location affinity (bonus/penalty by placement)

Placement modifies performance: rear-mounted guns take a dispersion penalty, ammo adjacent
to its weapon speeds the cycle, a heat sink hugging a reactor soaks better, a perimeter
reactor is fragile. Table and rules: 01 §7. Each affinity is a geometric fact the player can
read off the grid (rule R1-safe) and each opens counter-play — the rear-gun penalty is
*erased* by an adjacent targeting computer, so "gun in the back" becomes a two-part combo
instead of a mistake. Growth rule: add an affinity only when it creates a placement dilemma.

### 6f. Temperature-conditioned performance — running hot on purpose

The sharpest new synergy class: parts whose performance curve depends on their own cell
temperature. Example quirks (04 §4): **Heat-loose** (weapon cycles 20% faster above 100°C,
but takes damage from 140°C instead of 150°C) and **Cold-blooded** (weak until warmed up).

Why this is R1-legal: no tag or proc — temperature is already simulated per cell, the
condition reads off the existing thermal overlay, and the *player builds the condition*
with the same tools used to avoid it (under-cool deliberately, park the part near a
combustion reactor, skip the heat pipe). Precedent: BattleTech's Triple Strength Myomer,
which only activates above a heat threshold and spawned an entire "run hot" archetype.

The synergy web it opens: combustion waste heat becomes a *feature*; Hot-running and Leaky
flaw-quirks become fuel; a radiator becomes optional on exactly the part everyone else must
cool — and the whole plan lives inside a 40°C window one enemy laser hit can shove you out
of, top or bottom. Riding the window is the archetype's skill test.

Design guardrails: keep temperature-conditioned behavior on *quirks and rare parts only* in
v1 (baseline parts stay monotonic: hotter = worse). If every part has a performance curve,
the thermal overlay stops answering "is hot bad?" at a glance and readability (R4) loses.

### 6g. Scouting × terrain (extends opponent intel)

Opponent cards (04 §5) gain an **arena preview**: map silhouette, spawn positions, and
terrain features (when terrain ships). A range build reads sightlines; a future water-cooled
build hunts pond maps. Picking the fight is picking the battlefield *and* the loot.
Spec: 04 §5.

## 7. Anti-synergies (the workshop must surface these too)

Negative interactions are half of legibility (rule R4):

- **Disjoint envelopes**: sniper + brawler weapons → the autopilot can't pick a range. Warn.
- **Combustion + laser stacking**: two big heat sources sharing one radiator's watershed.
  The thermal overlay must make the shared bottleneck visible.
- **Ammo next to hot parts**: cook-off at 180°C. The overlay shows predicted equilibrium —
  an ammo bin trending orange is a pre-fight alarm.
- **Priority inversions**: targeting computer below the weapon it serves — the gun keeps
  power but goes blurry. The brownout-point stat names *what* sheds, catching this.
- **Wide arcs on precision guns**: +20% base dispersion for flexibility a sniper never uses.

## 8. Design health checks

1. Every synergy above must be discoverable from visible numbers + overlays alone (no wiki
   required — the RogueTech "LIES" failure is the anti-goal).
2. Submission gate: ≥ 2 coherent represented identities per chassis; long-term target:
   ≥ 3 viable archetypes per chassis at each ladder tier. Validate coherent builds, not
   arbitrary legal layouts, with deterministic control/perk cohorts.
3. No dominant pairing: if one synergy appears in > 50% of winning batch-sim builds, re-price
   its parts (mass/cells/tier), don't rule-patch it (rule R1).
