# 10 — Run Structure & Economy Plan (Track A)

*Written Jul 18 2026, after the UX & diagnostics pass shipped (archive/09). Spec:
`04-salvage-economy-spec.md`. Stance for this thread (user call, Jul 18 2026): build for
**feature-completeness and user experience; balancing is deferred** — every economy number
lands as a named config constant (04 §8's dials), tuned later by measurement, not now by
argument.*

## 1. Goal and stance

Turn the one-off workshop-vs-roster loop into the actual game: a 12-node run where the
mech persists, scrap is the only currency, wrecks are the shop, and death ends the run.
The frankenstein thesis (04): the economically correct mech is patchwork salvage —
pristine is unaffordable.

Architecture: the **run is web-side state** (the sim stays pure and battle-scoped, R6);
sim changes are limited to physical hooks the economy needs (integrity scaling HP, later
quirk parameter mods). Run state lives in one serializable object, persisted to
localStorage so a run survives a reload — and that same serialization is the future
save-file / multiplayer build-lock format (00 backlog).

## 2. Milestones

### M1 — Run shell ✅ *shipped Jul 18 2026 — `useRun` (localStorage-persisted) +
`RunPanel` (kit picker / node screen / memorial); outcome settles when the run-fight
report closes; free-play arena remains available only outside a run.*

The state machine, with the existing roster as placeholder opponents:

- `RunState { nodeIndex (1..12), scrap, benchPool: PlacedPart[], build, seedStream, log }`
  — one reducer, localStorage-persisted, "abandon run" resets.
- **Start**: pick 1 of 3 starter kits (04 §6 — vulture-skirmisher / mule-gunline /
  mule-tinkerer), which seeds build + 30 scrap.
- **Node screen**: 2–3 scouted opponent cards (silhouette, 2 confirmed parts, purse,
  threat), pick one → the existing Fight·Live / Watch flow.
- **Defeat = run over** on core-kill: memorial screen (final mech, cause of death, fights
  won), then back to start. Non-core losses (mission-kill, judges) continue the run with
  no purse (04 §9's softening question stays open).
- Workshop stays reachable between fights (repair/refit comes in M3; until then it's the
  existing editor operating on the run's build).

### M2 — Purse & wreck salvage ✅ *shipped Jul 18 2026 — WreckScreen (the wreck as its
chassis grid, click to take, live totals), per-part loot integrity from real fight
damage + seeded extraction wear, bench pool with sell; all rates are runState.ts config
dials. Tabled for a design discussion before M5: rare/named unique parts ("unique
perks") — captured in 07 Loose ends.*

- Fight purse on victory: `20 + 5×tier`, elite ×1.5 (config).
- **Wreck screen**: the enemy's actual chassis grid, per-part state from the battle
  report (destroyed / damaged / intact). Destroyed parts auto-scrap at tier×4; intact
  parts lootable at `integrity = 1 − damageFrac − extractionWear(0–20%, seeded)`.
  Mission-kill leaving non-weapon systems pristine falls out of per-part damage for free.
- **Bench pool** cap 8 (multi-cell parts 1 slot): loot freely, scrap the overflow on the
  spot (tier×8).

### M3 — Repair, refit, integrity ✅ *shipped Jul 18 2026 — integrity-scaled HP pinned
in tests; `MechReport.partsFinalHp` feeds loot condition (now covers heat + cook-off
damage, closing the M2 review finding); inspector repair (+10% / full at
`REPAIR_COST_PER_POINT` × tier), sell (tier×8), unplace-to-bench; bench "fit" places at
salvage integrity; grid shows integrity badges. Added beyond plan: during a run the
palette is a placeholder shop — fresh parts and auto-wired conduits cost tier ×
`SCRAP_BUY_MULT` (12), priced on the part cards, so buy > sell and selling can't mint
scrap (superseded by M4 scrapyard nodes).*

- Sim: **integrity scales part HP** (04 §3 — function stays binary down to 1%). One-line
  hook in the combatant's HP table + a pinned test.
- Workshop: part cards show integrity; **partial repair** (0.4 scrap × tier per point,
  config) with a spend control; scrap-a-part button (tier×8). Placing from the bench pool
  and unplacing back to it respects the cap.

### M4 — Enemy ladder ✅ *shipped Jul 19 2026 — sim `generateOpponent` (seeded template
pick + budget fill + free auto-wiring, unreachable fill dropped, pinned tests); web
`lib/ladder.ts` (budget 8→30 dials, elite +4 budget / purse ×1.5, 2 seeded scrapyard
nodes with 4 offers + one reroll); intel cards show chassis, terrain/spawn arena preview
from the fixed battle seed (scouted arena = fought arena), and a heavier-frame headline
warning. Sell prices now scale with integrity (closes the buy-junk-sell-pristine mint).*

*Revised Jul 19 2026 (user call): **no bosses**, no mid-run chassis changes. The ladder
is the budget curve alone — late nodes naturally field bigger frames, and beating an
unfamiliar frame is what unlocks it for future runs (M6, 04 §7).*

- Budget-driven opponents: tier budget `f(node)` = 8 → 30 (config), hand-authored
  templates (the sim's `templates.ts` roster) with randomized fill, seeded per node.
  Bigger chassis enter as the budget allows (CH-5 mid-run, CH-7/CH-9 late).
- Node flavors: standard / **elite** (guaranteed quirked high-tier part once M5 lands;
  until then +budget) / **scrapyard** (scrap↔part conversion at poor rates, one reroll —
  supersedes M3's palette-as-shop placeholder).
- Intel cards gain the arena preview (spawn distance + terrain silhouette, 04 §5) and a
  headline-weapon warning when the opponent rides a bigger chassis than yours.

### M5 — Variants, quirks & mods ✅ *shipped Jul 19 2026 — the modifier substrate
(`sim/modifiers.ts`): variants, quirks and mods are all per-instance parameter
modifiers; one registry entry per modifier (`appliesTo` predicate + pure `apply` over
{temp, speed, terrain} context), every knob threaded through the sim once (cycle,
damage, dispersion, move-jitter, overkill carry, draw, output, radiator, extra heat,
conduction, cook-off splash, HP, target profile, shed order). Shipped: 7 quirks
(Overvolted, Hot-running, Heat-loose, Cold-blooded, Lucky, Miswired, Leaky) + 8 mods
(Fever cycle, Cold bore, Tidecooler, Gyrostabilized, Hull-down, Insulated mount, Ram
bore, Sacrificial casing); loot rolls variant + quirk seeded per wreck; first-wreck
guaranteed mod; elite mod carriers telegraphed on intel ("◆ carries a Tidecooler
Gill"); machinist at scrapyards (one mod per yard, `MACHINIST_MOD_COST`); ModChips UI
(chips + green/red variant deltas) on wreck rows, bench rows, inspector. Not yet (each
needs one new knob): Sticky (order latency), Cold-soaked (thermal mass), Frankensteined
(bench slots), Thermocouple skin (heat→charge), Surge gate (brownout immunity), Marsh
pistons (terrain speed). 9 pinned substrate tests.*

*(Design input, Jul 19 2026: the mods layer — 04 §4b — extends this milestone: machinist
upgrades at scrapyards, elite mod carriers, first-wreck guaranteed mod. Split into M5a
variants/quirks and M5b mods if it drags.)*

- **Stat variants**: looted parts roll ±10% on one or two headline stats (weighted
  near-baseline); part cards show green/red deltas vs stock. Sim: parts carry optional
  per-instance stat overrides (a physical-parameter change, R1-clean).
- **Quirks**: the 04 §4 table, 30% of drops (config), permanent. Each lands as a physical
  parameter mod in the sim (Leaky = extra heat emission, Sticky = order-latency,
  Overvolted = output/HP trade, Miswired = priority override, Hot-running / Cold-soaked /
  Heat-loose / Cold-blooded = thermal-model params, Lucky = dispersion/penetration,
  Frankensteined = bench-slot/mass). Tooltip one-liners everywhere the part appears.
  Elites get built *with* quirked parts so intel telegraphs the inheritance.

### M6 — Meta unlocks & run polish ✅ *shipped Jul 19 2026 — persistent profile
(`profileState.ts`, localStorage beside the run save): fresh profiles start with the
starter kits' chassis (CH-2/CH-5) and parts + wiring; beating a mech unlocks whatever
it rode or carried, announced on the wreck screen ("★ UNLOCKED: …"). **Custom-frame
start**: pick an unlocked chassis → prep phase (palette shows 🔒 on locked parts,
placements free within `START_BUDGET` tier, wiring exempt, prep survives reload) →
launch. Run-history memorial (last `HISTORY_MAX` runs) on the start screen. Plus three
more modifiers on the substrate: Sticky (weapon-toggle latency, new commandWeapons
write path), Cold-soaked (thermal mass), Marsh pistons (terrain-slow immunity while
functional). Still open: Frankensteined / Thermocouple skin / Surge gate modifiers,
judges-loss reduced salvage, transplant-mode question, starter-kit rotation.*

- **Unlock loop (04 §7, user call Jul 19 2026)**: a persistent profile (localStorage
  beside the run save) tracks unlocked chassis and **starting parts**. Beating a mech
  riding a locked chassis unlocks the chassis; beating locked parts unlocks them for
  starting loadouts. Unlocks shape run start only (pick an unlocked chassis, outfit it
  from the unlocked starting-part pool; preset kits stay as suggestions) — in-run
  salvage is never gated. Wreck screen announces unlocks. All thresholds config dials.
  **Horizontal only**: unlocks add build diversity, not power — bigger chassis are
  balanced sidegrades (mass / target profile / speed / plumbing costs offset the room),
  so a veteran profile has more *kinds* of runs, not easier ones.
- Run-history memorial persistence (last N runs), judges-loss reduced salvage (04 §9),
  bench-pool transplant-mode question (04 §9), starter-kit rotation.

## 3. Order and effort

M1 → M2 → M3 are the playable core loop (each independently shippable; after M3 the
frankenstein pressure exists). M4 makes the ladder real; M5 is the identity layer (the
biggest sim surface — split variants from quirks if it drags); M6 mops up.

## 4. Explicitly out of scope

Balancing pass on any number (Track C, after this ships — the 04 §8 dials exist as
config), ammo system, turret mounts, multiplayer (00 backlog),
docs/08 M5 stretch items.
