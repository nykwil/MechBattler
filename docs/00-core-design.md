# MechBattler — Core Design Document

Version 0.1 (design phase — no code exists yet)

## One-line pitch

A roguelike where the game is the workshop: you engineer a jury-rigged mech on a physical
chassis grid, then watch it fight under its own doctrine — intervening with light RTS orders
only as much as you want — with every outcome a consequence of your engineering.

## Player fantasy

You are not a pilot. You are the engineer in the pit crew of a one-mech junkyard gladiator
operation. The fantasy moments the design must deliver:

1. **The frankenstein build.** Rerouting every conduit on a chassis two sizes too small so one
   absurd railgun fits — knowing that firing it browns out the legs.
2. **The diagnosis.** Watching your mech lose, seeing *exactly* why (the radiator got shot off
   and the laser cooked itself), and knowing what to fix.
3. **Ship of Theseus.** By fight 12, nothing of your starting mech remains. Its history is
   written in mismatched salvage and quirky parts.
4. **The bet.** Sending your build into the arena and watching it perform is placing a bet on
   your own engineering.

## The core loop

```
Workshop (repair, refit, reroute, test bench)
        │
        ▼
Battle (real-time 2D arena; autopilot doctrine + optional four-verb orders)
        │
   win ─┼─ lose (core destroyed) ──► run over
        ▼
Salvage (strip parts from the wreck; parts drop damaged, sometimes quirky)
        │
        ▼
back to Workshop
```

One persistent mech per run. Permadeath when the core is destroyed. A run is a ladder of
12 fights with branching opponent choice (see `04-salvage-economy-spec.md`).

## The five pillars

1. **Chassis grid** — parts are polyominoes on a 2D cell grid; power routing is physical;
   damage is locational. Spec: `01-chassis-grid-spec.md`.
2. **Power & heat simulation** — deterministic watts-and-degrees model with player-set
   brownout priority. The same sim runs on the workshop test bench and in combat.
   Spec: `02-power-heat-spec.md`.
3. **Combat** — real-time 2D arena, projectile- and movement-based (BattleTech boardgame DNA,
   not proc synergies). Exactly four command verbs; the autopilot is just another issuer of
   those verbs. Spec: `03-combat-spec.md`.
4. **Salvage & repair economy** — parts drop damaged with possible quirks; repair costs scrap;
   how you win shapes the loot. Spec: `04-salvage-economy-spec.md`.
5. **Run structure** — 12-fight ladder, scouted opponent choice, boss frames gate chassis
   upgrades. Spec: `04-salvage-economy-spec.md`.

Cross-cutting: `06-synergy-design.md` catalogs the emergent synergy space (all physical
couplings per rule R1 — no tags) and the design levers that widen it.

## Design rules (constitution)

These resolve arguments. When two ideas conflict, the one that satisfies these wins.

- **R1 — Simulation over scripting.** Outcomes emerge from the physical model (watts, joules,
  degrees, meters). No synergy tags, no proc chains, no "+15% damage when X" cards.
- **R2 — Four verbs only.** The entire combat control surface is: weapon on/off, set
  destination, set speed, set facing. Player and autopilot share it. Any proposed feature that
  needs a fifth verb must instead become emergent (e.g. subsystem targeting is done by
  maneuvering, not a button).
- **R3 — Hands-off must be viable.** A player who never issues a manual order in combat plays
  a complete game. Manual orders are an edge, never a requirement.
- **R4 — Readability is a feature.** Every failure must be visually attributable: brownouts
  flicker, overheats glow, severed conduits spark. If the player can't see why they lost, the
  loop is broken.
- **R5 — Deck-builder feedback.** Every part placed in the workshop immediately moves visible
  derived numbers (DPS, speed profile, time-to-overheat, ideal range band). No hidden math at
  build time.
- **R6 — The sim is the portable asset.** The simulation core is a pure, deterministic,
  engine-agnostic module with zero rendering dependencies.

## Position vs. prior art

No existing game occupies the intersection; every ingredient has a proven home. The risk is
in the combination, not the pieces.

| Game | What it proves | Where we diverge |
|---|---|---|
| Mech Engineer | Engineering-as-the-game carries a title | We add the salvage roguelike loop, a single frankenstein mech, and a spatial chassis |
| RogueTech (BattleTech mod) | Harsh-sim refitting + punishing heat + granular salvage has a devoted audience | Their building is tonnage/slots/hardpoints (no spatial placement, no power sim, scalar heat pool); combat is manual turn-based lance tactics; loop is a sandbox campaign. Their refit screen famously "LIES" about stats — our sim-backed test bench is the direct answer |
| Cats in the Shell (2026) | Mech roguelike auto-battler loop sells | Their building is abstract slot synergies; ours is a physical sim. Their combat is proc-driven; ours is projectile/movement |
| Cogmind | Salvage-frankenstein with power/heat budgets is compelling | Their combat is manual; ours is watched. Building is ~90% of our play |
| Crossout | Mass/CoG affecting handling + locational damage works | Theirs is manually driven MMO PvP |
| BattleTech / Car Wars | The balancing fantasy and range/facing/heat combat model | We remove the piloting layer entirely |
| Backpack Hero / Captain Forever | Spatial building is fun | Never wired to an autobattler with an electrical/thermal sim |

**The two mechanics with no precedent anywhere — protect these:**
physical power/coolant routing on the chassis grid, and player-set brownout priority.

## Session shape

- A battle: 30–120 seconds.
- A workshop visit: 1–5 minutes (longer after big salvage hauls).
- A full run: 45–90 minutes across 12 fights.
- Target feel: "one more fight" cadence of an autobattler, with the between-fight depth of a
  mech lab.

## Tech stack (decided)

Web. React + TypeScript for the workshop UI, PixiJS for the 2D top-down arena. Simulation
core is a pure TypeScript module (rule R6), shared by test bench and arena, fixed-tick at
20 Hz with a seeded RNG for full determinism and replayability. Unreal ruled out (binary UI
assets). A later Unity/3D port replaces only the shell, never the rules.

## MVP scope (prototype phase, after design sign-off)

Build pillars 1 + 2 first — grid editor + live test bench on the real sim — because that is
where the novelty risk lives. Combat arena second. Economy/run structure third.

## Backlog (explicitly not in v1)

- **Physics/IK locomotion (north star).** Mechs as procedural IK walkers whose gait, lean,
  and stumble emerge from actual weight distribution — a rear-heavy build visibly drags, a
  railgun's recoil rocks the frame. V1 keeps a simple 2D movement model, but mass and
  center-of-gravity are first-class sim inputs from day one, so this is a presentation
  upgrade later, not a redesign.
- Environmental terrain effects (tree cover accuracy penalty, water accelerates cooling).
  The order/trigger system is designed so "hold fire until reaching the water" works the day
  terrain ships.
- Asynchronous PvP against other players' builds.
- Meta-progression unlocks, pilot characters, multi-mech squads.

## Glossary

| Term | Meaning |
|---|---|
| Chassis | The frame: a masked cell grid + locomotion type + directional speed profile |
| Cell | 0.5 m × 0.5 m grid unit; the atom of placement, damage, and heat |
| Conduit | 1×1 part that carries power; parts connect to reactors via conduit paths or direct adjacency |
| Brownout | Demand exceeds supply + capacitor discharge; parts shed power in player-set priority order |
| Envelope | A weapon's effective range band derived from its dispersion and damage falloff |
| Ideal range band | Intersection/weighting of all weapon envelopes; where the autopilot fights |
| Quirk | A permanent trait on a salvaged part (usually a flaw, sometimes a gift) |
| Doctrine | The autopilot's standing behavior, derived from the build, expressed via the four verbs |
