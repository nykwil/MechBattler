# Spec 04 — Salvage, Repair Economy & Run Structure

The frankenstein engine. Everything here is tuned to one goal: the economically correct mech
is a patchwork of half-repaired, quirky salvage — pristine builds should be unaffordable.

## 1. Currency

**Scrap** is the only currency. Sources: fight purse, scrapping parts. Sinks: repair,
scrapyard parts, milestone machinist services, and exceptional whole-wreck chassis
recovery. Scrap is run-only.

- Fight purse: 20 scrap base, +5 per ladder tier, elite ×1.5.
- Scrapping an intact part: tier × 8 × integrity (rounded); destroyed enemy parts
  auto-convert at tier × 4.

## 2. Salvage drops

After a win, the enemy wreck is presented as its actual chassis grid — you see where every
part sat and what state it's in (the wreck screen doubles as build-intel education).

- Parts **destroyed during the fight**: not lootable; auto-scrap at tier × 4.
- Parts **intact at victory**: lootable at integrity = 100% − damage taken, further reduced
  by uniform 0–20% "extraction wear". Typical loot lands at 40–85% integrity.
- **Victory type shapes the haul** (no targeting button — this is positioning skill paying
  out, per 03 §6): core kill leaves everything else lootable; mission-kill (shooting out all
  weapons) leaves the *non-weapon* systems pristine but the weapons scrapped — you hunt the
  parts you *don't* shoot.
- Carry limit: loot any number of parts, but unplaced parts ride in the **bench pool**
  capped at 8 slots (multi-cell parts still 1 slot). Excess must be scrapped on the spot.
  Pressure to commit, not hoard.
- Normal refit cannot change chassis. The one exception is **whole-wreck recovery** on the
  victory salvage screen (design revision, Jul 25 2026). Pay `20 + 2 × chassis cells`
  scrap, take the defeated frame with only its surviving equipment and inherited damage,
  and stow the old installed build into the 8-slot bench. Deterministic overflow is
  auto-scrapped. The two-step warning labels this as a risky, inefficient alternative:
  stripping selected parts into the current mech remains the intended growth path.
- Beating a mech riding a chassis you haven't unlocked still unlocks that chassis for
  future starting builds (§7 meta loop), independently of whether its wreck is recovered.

## 3. Integrity and repair

Integrity scales a part's HP only (a 60%-integrity W-AC has 27 of 45 HP). Function is
binary — a part works at 1% integrity. Risk, not weakness: half-broken parts die to hits
that healthy parts shrug off.

- Repair cost: **0.4 scrap × tier per integrity point** restored. Partial repair is allowed
  and is the economically correct move.
- Worked math: repairing a tier-2 autocannon 45% → 100% costs 44 scrap vs. a ~25–35 scrap
  fight purse. You cannot afford to keep everything topped up; triage is the game.
- Between fights there is no time pressure (v1). The pressure is purely scrap.
- The repair bay is available before every encounter, including retries after non-core
  losses and milestone/scrapyard stops. It repairs installed or benched equipment
  individually, or all damaged owned equipment when the wallet covers the full bill.

## 4. Variants and quirks — two layers of salvage randomness

Salvaged parts vary on two independent axes, both assigned at drop and permanent:

**Stat variants (common, small, numeric).** Every looted part rolls its headline stats within
a band (±10% on one or two stats: mass, HP, draw, damage, cycle, dispersion, arc width —
weighted so most rolls are near-baseline). A "Judge 12.8/0.7s" vs the stock "12/0.75s" is the
same part, slightly different metal. Shape can vary too (01 §1 — compact L-variants). The
part card always shows the delta vs. stock in green/red. This makes every wreck worth
reading without adding rules text.

**Quirks (uncommon, named, behavioral).** 30% of looted parts carry one permanent quirk
(never removable — quirks are the memoir of where your mech has been). Quirks are mostly
flaws, some gifts, all legible one-liners surfaced in every tooltip:

| Quirk | Effect |
|---|---|
| Leaky | +20% of the part's power draw is emitted as heat in its cells |
| Sticky | Weapon on/off toggle takes effect 0.8 s late |
| Overvolted | +12% damage (weapons) or +12% output (reactors); −25% max HP |
| Miswired | Ignores brownout priority — always sheds first |
| Hot-running | Idle heat +1.5 kW while powered |
| Cold-soaked | Thermal mass ×2 (heats and cools slowly) |
| Lucky | Dispersion ×0.9 (weapons) / incoming overkill penetration ×0.8 (others) |
| Frankensteined | Counts as 2 bench-pool slots, −10% mass |
| Heat-loose | Weapon cycle ×0.8 while its cells are > 100°C (worn tolerances free up when hot) — but 150°C damage threshold drops to 140°C |
| Cold-blooded | Part output/damage ×0.85 while its cells are < 60°C, ×1.0 above (wants a warm-up) |

The last two are **temperature-conditioned** quirks: legal under rule R1 because temperature
is a simulated physical quantity, visible on the thermal overlay — the condition is read off
the same gauge everything else uses. They create the "run hot on purpose" build space
(deliberately under-cool a Heat-loose gun and ride the 100–140°C window); see
`06-synergy-design.md` §6f.

Distribution: 70% no quirk; of quirked drops, weighted 2:1 flaws:gifts. Enemy elites are
*built with* quirked parts, so intel (below) telegraphs what you'll inherit.

### 4b. Mods — the build-identity layer (implemented substrate; stress pass Jul 21 2026)

The third axis, above variants and quirks: **mods** are rare, named, deliberately
build-defining part modifications — the CCG/synergy layer (resolves the tabled
"rare/unique parts" discussion from 07). Two acquisition paths, both scarce:

1. **The machinist** (victory milestones): after wins 3/6/9, pay scrap to apply one mod
   to an installed or benched part you own, chosen from three seeded offers. This is the
   "upgrade what you have" path and makes round winnings feed build identity directly.
2. **Found on enemies**: elites carry modded parts, telegraphed on the intel card
   ("carries a Tidecooler Gill"). Kill the carrier without destroying the part to take
   it. The mod rides the part instance forever.

**First-match hook**: the first wreck of every run is guaranteed to contain one modded
part (seeded). The player doesn't pick their identity — they inherit it and build around
it. This is the run's opening prompt.

**What makes a good mod** (the design bar every candidate must clear):

- **R1: it is a parameter, not a rule.** A mod changes a number the sim already
  simulates (a conductivity, a cycle time, a profile height, a terrain multiplier).
  Never new rules text, never "when X happens, trigger Y".
- **It references a system, never another mod.** Synergies must *emerge* from shared
  physics (water is simulated once; two mods that both care about water combo without
  either knowing it). Scripted two-card combos are forbidden — discovery is the product.
- **It bends a trade-off, not a stat.** "+15% damage" is a variant, not a mod. A mod
  relocates where a cost is paid: heat becomes fire rate, stillness becomes armor,
  waste becomes charge. The build changes *shape* around it.
- **The cost stays simulated.** Fever cycle's downside isn't "−X"; it's proximity to
  the same 130 °C shutdown cliff everything else lives under. Real costs, same gauges.
- **It is legible on existing instruments** (R4): the effect must be visible on the
  thermal overlay, the range sandbox, the HUD gate labels, or the arena preview — a
  one-liner tooltip plus a place to *watch it work*.
- **It rewards a verb we have** (R2): picking fights (arena preview), positioning,
  throttle/heat management, facing. Never a new button.

**Catalog and stress status.** A part may carry quirks plus at most one mod. High-leverage
mods can also declare a per-build copy limit; the machinist UI and deterministic loadout
audit enforce both rules. Rarity/acquisition pricing remains Track C, but the representative
effects below have explicit mechanical costs:

| Mod | Effect (physical grounding) |
|---|---|
| Tidecooler (radiator) | Water-tile dissipation bonus doubled — camp wet arenas |
| Fever cycle (weapon) | Above 50°C, cycle time shrinks with mount temperature; draw ×1.25 always; max one per build |
| Cold bore (weapon) | Dispersion ×0.5 below 40°C; damage ×0.9 always; max one per build |
| Thermocouple skin (capacitor) | Trickle-charges from neighboring hot cells — wants the seat next to the reactor |
| Insulated mount (any) | No heat conduction to grid neighbors — local placement freedom |
| Gyrostabilized mount (weapon) | Own-motion jitter ×0.5; weapon mass ×1.25; max one per build |
| Hull-down suspension (Stride) | Below 1.5 m/s, target profile ×0.7; requires the powered two-cell servo and adds 25% servo mass; max one |
| Ram bore (weapon) | Overkill penetration carries 75% instead of 50% — gut interiors |
| Marsh pistons (Stride) | No water/forest speed penalty; servo draw rises from 4 to 6 kW; max one per build |
| Sacrificial casing (ammo) | Cook-off vents outward, no neighbor splash |
| Surge gate (weapon) | Fires from capacitor even while browned out — priority-immune |

The fixed diversity stress accepted Cold Bore, Fever Cycle, Gyrostabilized, Hull-down,
and Marsh pistons as costly identity levers and rejected duplicate Fever stacking. The
remaining open questions are whether mods survive the part's destruction in any form;
machinist pricing; whether "uniques" are just a mod +
extreme variant + quirk pre-rolled under a proper name (current lean: yes — legendary
metal, not new rules).

## 5. Run structure

A run = **12 nodes**. At each node, choose 1 of 2–3 scouted opponents. No boss fights
(user call, Jul 19 2026): the ladder has no scripted landmarks, just the budget curve —
late-run opponents naturally ride bigger frames, and beating an unfamiliar frame is what
unlocks it (§2, §7). A recovered frame is an expensive salvage exception, not a node or
free refit action. A mech on a bigger chassis than yours still gets the pre-fight
headline-weapon warning on its intel card.

- **Intel is the draft**: each opponent card shows chassis silhouette (type + cell count),
  2 confirmed parts, purse, and a threat rating. Picking a fight *is* picking the parts
  you're hunting — the salvage economy's version of a card shop.
- **Arena preview on the card**: map silhouette, both spawn positions, and terrain features
  (once terrain ships). A long-range build reads spawn distance and sightlines; a
  water-cooled build (backlog) hunts pond maps. Picking the fight is picking the
  battlefield *and* the loot — build-vs-terrain matchups become part of the draft.
- Node flavors: standard; **elite** (+1 quirked high-tier part guaranteed, harder);
  **scrapyard** (no fight: convert scrap ↔ parts at poor rates, one reroll).
- Enemy scaling: opponents are built with the same part catalog and rules as the player
  (budget = f(node): total part-tier budget 8 at node 1 → 30 at node 12). Enemies are
  hand-authored templates with randomized fill, not fully procedural, so fights stay
  readable and salvage stays deliberate.
- The budget curve fields bigger chassis as the run deepens (roughly CH-5 by mid-run,
  CH-9 late) — chassis variety comes from the curve, not special nodes.

## 6. Run start

Fresh accounts start with the flexible Mule Skirmisher and 30 scrap. By the
eight-battle one-hour target, all three chassis and a 15-part pool support at
least three authored build directions per chassis, including:

- **Vulture range scout**: R-E25, W-CB plus close defense — fast, exposed, shallow.
- **Mule gunline**: R-C40, W-AC, U-RAD and routing — the middle-frame firing line.
- **Bastion casemate**: R-C40, W-AC, U-TC1 and front armor — slow, protected, heat efficient.

## 7. Death and meta

Core destroyed = run over, full stop. Within a run, knowledge and the wreck economy are
the whole game; across runs there is one carryover: **unlocks** (user call, Jul 19 2026,
superseding the earlier no-meta stance).

- **The general loop is unlocking starting options.** Beating a mech that rides a locked
  chassis unlocks that chassis; locked parts unlock through the combat challenges in
  `13-full-game-experience.md` as **starting parts**. Unlocks shape how a run *begins* — the starting chassis and
  the pool of parts a starting loadout can draw from — and nothing else: in-run
  acquisition stays pure salvage economy, and a run can always loot anything it defeats.
  End state: run start is "pick an unlocked chassis, outfit it from your unlocked
  starting-part pool" (preset kits remain as suggested loadouts for new profiles).
- **Unlocks are horizontal, not vertical** (user call, Jul 19 2026): an unlock widens
  the option space — new archetypes, new build puzzles — it must not be a power reward.
  In particular **bigger chassis are balanced sidegrades**: more grid room buys more
  mass, a bigger target profile, slower base speeds, longer conduit runs and deeper
  heat plumbing. Playing more earns more *diversity*, never a stronger default.
- Profile and run are versioned serializable objects. All thresholds and challenge rules
  are config data in `@mechbattler/game`; legacy unlocks migrate without being revoked.
- The shipped memorial records the final mech, cause of death, fights won, and progression
  earned during the run.

## 8. Economy tuning dials (for the prototype's balance pass)

The three ratios that define the frankenstein pressure — expose all as config:

1. **Repair-to-purse ratio** (target: full repair of a mid mech ≈ 1.6× one purse).
2. **Loot integrity range** (40–85%): raises/lowers how janky "free" power feels.
3. **Quirk rate** (30%): below 20% quirks read as rare accidents; above 40% they read as noise.

## 9. Open questions for prototype

- Whole-wreck recovery intentionally has no bench-cap exemption: current installed parts
  fill free slots in stable build order and overflow auto-scraps, with the exact counts
  previewed before confirmation.
- Should scrapping quirked *gift* parts pay a premium (a reason to sell your Lucky gun)?
- Judges'-decision losses (03 §1): should the loser still get reduced salvage to soften
  timeout frustration?
