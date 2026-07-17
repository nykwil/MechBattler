# Spec 03 — Combat

Real-time 2D top-down arena. Projectile- and movement-based (BattleTech boardgame DNA), fully
playable hands-off (rule R3), controllable through exactly four verbs (rule R2). Runs on the
shared sim core at 20 Hz.

## 1. Arena

- v1: flat rectangle, **200 m × 140 m**, spawns 160 m apart facing each other. 1v1.
- v1.5 (before terrain proper): 2–4 static rectangular obstacles that block projectiles and
  movement — enough to make "ideal fire position" mean something.
- Battle length target: 30–120 s. Timeout at 120 s → judges' decision: winner is the mech
  with the higher % of functional part mass remaining.
- Victory: enemy core destroyed, **or** mission-kill (enemy has no functional weapons)
  triggering surrender after 3 s. Mission-kills matter: they leave more salvage intact
  (see `04-salvage-economy-spec.md` §2).

## 2. The four command verbs

The entire control surface, for player and autopilot alike:

| # | Verb | Values |
|---|---|---|
| 1 | Weapon on/off | per weapon |
| 2 | Set destination | point or waypoint queue; "none" (hold position) is legal — stationary turret builds are a strategy |
| 3 | Set speed | creep / cruise / flank |
| 4 | Set facing | face target / face movement / face fixed bearing |

Each verb independently carries an **auto flag**. Auto = the autopilot issues it; manual = the
player's last order stands until cleared. One-click "resume full auto." Manual orders may
attach one simple trigger — **on arrival at destination, revert chosen verbs to auto** — which
is enough to express "hold fire, get to that spot, then fight" without a scripting language.
(When terrain ships, triggers gain "on entering region," enabling "don't fire until the
water.")

## 3. Movement model

Per-chassis directional speed profile (catalog in 01 §2): distinct forward / strafe / reverse
maxima. Movement direction decomposes against current facing, so *facing is a tactical
resource*: a biped that keeps its guns (and front armor) on target while side-stepping moves
at strafe speed — a spider barely cares.

Modifiers (multiplicative, applied to all three maxima and turn rate):

- **Load**: m_load = clamp(rated_mass / actual_mass, 0.4, 1.15).
- **Power**: commanded speed costs P = 1.2 kW × mass(t) × v (02 §2). If locomotion's
  allocated power is short (brownout, shed, or capped), actual speed = P_alloc / (1.2 × mass_t).
  Speed degrades continuously — an underpowered mech visibly labors.
- **CoG offset**: turn rate × (1 − 0.5 × offset), where offset = |CoG − grid center| as a
  fraction of the half-diagonal. Lopsided builds turn like barges. (Mass/CoG are day-one sim
  inputs — the future IK presentation reads these same values.)

Acceleration per chassis: CH-2 4.0, CH-5 3.0, CH-7 3.0, CH-9 1.5 m/s², × m_load.

**Recoil**: firing applies impulse to the shooter: Δv = impulse / mass (W-RG 8 kN·s pushes a
4 t mech 2 m/s backward; W-AC 0.4 kN·s is a twitch). **Stagger** (implemented mass-scaled):
a hit staggers when **damage ÷ mass(t) ≥ 3.3** — momentum transfer vs. inertia — interrupting
turning for 0.3 s and applying ×1.5 dispersion to the victim's fire for 1 s. So a 15-damage
hit staggers a ~4.5 t mech, a 3 t Vulture staggers at 10 damage, and a 12 t Bastion needs
~40 (railgun-class only). **Heavy = stable gun platform, by physics** — this is a core lever
of the tank archetype (a sniper's autocannon backup cannot stagger-lock an approaching tank).

**Arena walls** (implemented): the 200×140 m rectangle (§1) bounds movement — a mech pinned
to a wall loses the velocity driving it into the wall. This caps runaway kiting: a kiter has
only (arena length − spawn distance)/2 of runway. In practice the chassis grid already
prevents the worst runaway build (a fast chassis can't fit a long-range heavy weapon — the
railgun is 10 cells), so walls are a safety rail that isn't yet the binding constraint; they
matter once turrets/bigger fast chassis/terrain arrive.

## 4. Speed settings

| Setting | Speed | Locomotion power | Own-fire dispersion | Locomotion heat |
|---|---|---|---|---|
| Creep | 30% of max | proportional | ×0.7 | none |
| Cruise | 65% | proportional | ×1.0 | none |
| Flank | 100% | proportional ×1.25 | ×1.6 | 0.15 kJ/s per tonne |

## 5. Ballistics and the aim model

Projectiles are simulated point objects; every shot exists in the world and can miss into
something else. The only RNG in the sim is dispersion (seeded — battles are replayable).

| ID | Dmg | Cycle | Muzzle vel | Dispersion | Falloff (range → dmg mult) | Recoil |
|---|---|---|---|---|---|---|
| W-MG Stitcher | 1.5 | 0.1 s | 800 m/s | 8.0 mrad | 30 m ×1.0 → 90 m ×0.4 | — |
| W-AC Judge | 12 | 0.75 s | 600 m/s | 4.0 mrad | 50 ×1.0 → 150 ×0.5 | 0.4 kN·s |
| W-LAS Ember | 18 | 2.5 s (energy-gated) | hitscan | 1.5 mrad | 60 ×1.0 → 140 ×0.5 | — |
| W-RKT Pepperbox | 6 × 6 rockets | 15 s | 250 m/s | 20 mrad/rocket | 40 ×1.0 → 120 ×0.6 | — |
| W-RG Longshot | 85 | 5 s + recharge (02 §4) | 2,000 m/s | 1.2 mrad | 80 ×1.0 → 240 ×0.85 | 8 kN·s |

Projectiles despawn at 1.3 × falloff end. Damage below falloff start uses ×1.0 (no
point-blank bonus in v1).

**Mount arc gates fire**: a weapon holds fire while the target bearing is outside its mount
arc (relative to chassis facing) — no penalty shots, simply no trigger. The autopilot's
facing verb keeps arcs on target; a manual "face fixed bearing" order can deliberately mask
weapons (e.g. showing armor while cooling). Turreted weapons (backlog, 01 §10) decouple
their arc from chassis facing.

**Dispersion**: shot bearing = aim bearing + gaussian(σ = mrad), so lateral spread in meters
grows linearly with range (W-AC at 100 m: σ ≈ 0.4 m against a 2–4 m wide mech). Multipliers:
shooter speed setting (§4), shooter turning > 45°/s ×1.3, aim bearing in the outer 25% of the
mount arc ×1.25, stagger ×1.5. **Mount arc is a tunable trade**: wider arc = aim flexibility,
but (a) the arc-edge penalty bites more often and (b) wide-arc variants of a weapon carry
+20% base dispersion (salvage variants vary).

**Hit model (decided Jul 2026, implemented in `packages/sim/src/combat.ts` — supersedes
simulated projectile flight and dead reckoning)**: shooting is **purely stat-based**. Every
shot's hit probability is computed from physical modifiers, rolled against the seeded RNG,
and — on a hit — resolved to an entry cell by sampling where across the target's silhouette
it lands (then the normal penetration walk of §6 runs). The lateral aim error at the
target combines, in quadrature:

- **Dispersion**: σ(rad) × range, with all shooter-state multipliers (speed setting,
  turning, arc edge, stagger).
- **Aim staleness × target crossing speed**: staleness = **tracking lag + time-of-flight**,
  where lag = 0.3 s (0.1 s with a powered U-TC1) and time-of-flight = range ÷ muzzle
  velocity (0 for hitscan). Lateral target speed × staleness is the miss distance.

P(hit) = erf(projected target half-width ÷ (σ_m √2)). Consequences, all measured in
battle: sustained crossing speed is a defensive stat; **slow projectiles are statistically
dodgeable** (a 250 m/s rocket gives a strafing target ~5× the escape time of a railgun
slug) with zero flight simulation; approaching head-on costs nothing (zero crossing
speed); the targeting computer is the purchasable counter (autocannon 64% → 87% vs an
orbiting spider at 40 m). Muzzle velocity stays a first-class balance stat. Drawn
projectiles/tracers are **pure presentation** over the event log. The EMA dead-reckoning
model that previously occupied this section is retired — the staleness term subsumes lead
error statistically.

## 6. Hit resolution → locational damage

1. Projectile/beam intersects the target's oriented bounding box (grid footprint at 0.5 m/cell).
2. Impact point converts to mech-local coordinates → **entry cell** = the perimeter cell of
   the impacted side nearest the impact point.
3. Damage applies per 01 §5: occupant takes it; overkill penetrates inward along the travel
   line at 50%; wreck cells absorb at 25% effectiveness.

Consequences that fall out for free: facing decides which parts get hit (front-armor skins
matter), juking exposes flanks, and **subsystem hunting is positioning** — to shoot the
radiator off, get an angle on the side it's mounted (rule R2: no targeting button).

## 7. Envelopes, ideal range band, and the autopilot

**Per-weapon envelope**: expected DPS(r) = base DPS × falloff(r) × P_hit(r), where P_hit uses
σ(r) against a nominal 2.5 m target. The envelope is the range interval where expected
DPS ≥ 50% of its peak.

**Ideal range band**: the DPS-weighted intersection of all mounted weapons' envelopes (if
disjoint, the band of the highest-DPS group wins and the workshop warns about the mismatch).
Shown in the workshop stats bar and drawn as a ring in the arena (rule R5).

**Autopilot, in terms of the four verbs** (evaluated at 4 Hz):

1. *Destination*: if outside band → nearest point inside band; inside band → hold, drifting
   to keep range near band center; if enemy closes under band minimum and we out-range them →
   back away (kite) along the range gradient, obstacle-aware (v1.5).
2. *Speed*: flank when > 1.5× band max away; cruise inside/near band; creep when an active
   weapon has dispersion ≤ 2 mrad (precision guns want stillness).
3. *Facing*: face target (default). Chassis with strafe ≥ 75% of forward speed (spiders)
   orbit while facing; others bite the strafe penalty or turn.
4. *Weapons*: enable when target in envelope AND part temperature < 115°C AND powering the
   weapon won't shed a higher-priority consumer (a one-tick brownout preview using the
   player's priority list). Player force-on overrides all three checks — knowingly cooking or
   browning out your mech is allowed.

The autopilot never uses information a player couldn't see. It is deliberately simple; its
quality is a product of the build (envelopes, priorities, chassis) — which is the game.

## 8. The wiggle-war question — moot under the stat-based hit model

**Superseded (Jul 2026)**: with hit resolution purely statistical (§5), there are no
simulated projectiles to juke and no per-shot lead prediction to exploit — evasion value
comes only from *sustained* crossing speed, which is bounded by chassis stats and already
costs range control. The analysis below is kept for the record in case simulated flight
ever returns.

Concern: dead reckoning implies course changes dodge shots; does combat degenerate into
wiggling? **Decision: no explicit anti-wiggle rule in v1.** Four systemic costs already bound
evasion, all falling out of existing rules:

1. Physics rate-limits jukes (accel, turn rate, strafe maxima) — evading sacrifices closure
   toward your own ideal band, and turning > 45°/s costs your own accuracy ×1.3.
2. Dispersion clouds swallow small jukes: against σ ≥ 4 mrad weapons inside 100 m, weaving
   inside the spread changes little. Only precision guns (W-RG, W-LAS) are meaningfully
   dodgeable — which reads as correct, not degenerate.
3. The EMA tracker only lags on *sustained* course changes, and U-TC1 shortens the lag —
   evasion has a purchasable counter that costs a cell, 3 kW, and 50 kg.
4. Serpentining alternately exposes flank armor and flank-mounted parts (§6).

**Kill criterion** (validated in the prototype via autopilot-vs-autopilot batch sims): if a
"weave" movement behavior beats an otherwise identical straight-line build > 65% of the time
across three matched pairs, escalate: add an accuracy penalty while own lateral acceleration
exceeds a threshold, and/or raise base q to 0.5.

## 9. Readability requirements (rule R4)

Combat must be legible enough that the workshop fix is obvious:

- **Brownout**: shed parts blink dark; toast "POWER SHED: locomotion"; capacitor bank meter
  visibly drains on cap-fed shots.
- **Heat**: per-part glow ramps yellow → red from 100°C; shutdown = steam vent puff + icon;
  cook-off = distinct flash + bang.
- **Damage**: destroyed cells char on the mech's silhouette (the top-down sprite *is* the
  grid); severed conduits spark once, then everything downstream greys out.
- **Aim**: subtle predicted-aim-point markers; the ideal range ring around each mech.
- **Post-battle report**: event timeline (every shed/shutdown/part-loss, timestamped), damage
  by part, per-cell max temperature, supply-vs-demand power graph. This report is the bridge
  back to the workshop.
- Deterministic replays (same seed) — cheap because of rule R6; scrubbing UI can come later,
  but the sim must support re-running a battle from its seed from day one.

## 10. Numbers needing prototype validation

- Fight length: total part HP (~300–500) vs sustained DPS (~10–20) suggests 30–90 s — verify
  misses and shutdowns don't stretch past 120 s timeouts routinely.
- Autopilot at 4 Hz: reactive enough without machine-gun order spam?
- Judges' decision on timeout: does % functional mass incentivize enough aggression?
- Arc-edge penalty (outer 25%, ×1.25): perceptible or noise?
- Core HP: the core is not a catalog part; the combat slice uses 50 HP (`CORE_HP` in
  `combat.ts`) — validate against fight-length targets.
- Tracking lag 0.3 s / 0.1 s (§5): measured effect at 40 m is AC 74% → 94% hit rate with a
  TC vs an orbiting spider — confirm this reads as a fair trade at other ranges/speeds.
