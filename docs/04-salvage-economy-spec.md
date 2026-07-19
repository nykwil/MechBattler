# Spec 04 — Salvage, Repair Economy & Run Structure

The frankenstein engine. Everything here is tuned to one goal: the economically correct mech
is a patchwork of half-repaired, quirky salvage — pristine builds should be unaffordable.

## 1. Currency

**Scrap** is the only currency. Sources: fight purse, scrapping parts. Sinks: repair,
(rare) shop nodes.

- Fight purse: 20 scrap base, +5 per ladder tier, elite ×1.5.
- Scrapping a part: tier × 8 scrap (tiers in 01 §7). Destroyed enemy parts auto-convert to
  scrap at half value.

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
- Chassis are **not** salvage: a run is locked to its starting chassis (user call, Jul 19
  2026 — no mid-run frame swaps). Beating a mech riding a chassis you haven't unlocked
  **unlocks that chassis for future runs** (§7 meta loop) — the wreck screen announces the
  unlock instead of offering the frame.

## 3. Integrity and repair

Integrity scales a part's HP only (a 60%-integrity W-AC has 27 of 45 HP). Function is
binary — a part works at 1% integrity. Risk, not weakness: half-broken parts die to hits
that healthy parts shrug off.

- Repair cost: **0.4 scrap × tier per integrity point** restored. Partial repair is allowed
  and is the economically correct move.
- Worked math: repairing a tier-2 autocannon 45% → 100% costs 44 scrap vs. a ~25–35 scrap
  fight purse. You cannot afford to keep everything topped up; triage is the game.
- Between fights there is no time pressure (v1). The pressure is purely scrap.

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

## 5. Run structure

A run = **12 nodes**. At each node, choose 1 of 2–3 scouted opponents. No boss fights
(user call, Jul 19 2026): the ladder has no scripted landmarks, just the budget curve —
late-run opponents naturally ride bigger frames, and beating an unfamiliar frame is what
unlocks it (§2, §7). A mech on a bigger chassis than yours still gets the pre-fight
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
  CH-7/CH-9 late) — chassis variety comes from the curve, not special nodes.

## 6. Run start

Pick 1 of 3 starter kits (chassis + parts + 30 scrap), e.g.:

- **Vulture skirmisher**: CH-2, R-E25, 2× W-MG, U-RAD, 2× U-ARM — fast, cool, shallow.
- **Mule gunline**: CH-5, R-C40, W-AC, U-AMMO, U-RAD, U-CON, 3× U-ARM — the tutorial-shaped build.
- **Mule tinkerer**: CH-5, R-E25 + R-C40, W-LAS, U-PIPE, U-RAD, P-CAP — a heat puzzle from fight 1.

## 7. Death and meta

Core destroyed = run over, full stop. Within a run, knowledge and the wreck economy are
the whole game; across runs there is one carryover: **unlocks** (user call, Jul 19 2026,
superseding the earlier no-meta stance).

- **The general loop is unlocking chassis and parts.** Beating a mech that rides a
  locked chassis unlocks that chassis; encountering/beating locked parts unlocks them.
  Unlocks gate what future runs can *start with and buy* (starter kits, palette/shop
  stock) — never what salvage can drop, so a run can still loot anything it defeats.
- Profile is one serializable object (localStorage beside the run save), all thresholds
  config dials, tuning deferred. Which chassis/parts start locked is a balance question.
- A run-history screen (final mech portrait, cause of death, fights won) is cheap and
  satisfies the memorial urge.

## 8. Economy tuning dials (for the prototype's balance pass)

The three ratios that define the frankenstein pressure — expose all as config:

1. **Repair-to-purse ratio** (target: full repair of a mid mech ≈ 1.6× one purse).
2. **Loot integrity range** (40–85%): raises/lowers how janky "free" power feels.
3. **Quirk rate** (30%): below 20% quirks read as rare accidents; above 40% they read as noise.

## 9. Open questions for prototype

- Bench pool cap of 8: enough slack for chassis-transplant turns (01 §2) where everything
  comes off at once? May need a transplant-mode exemption.
- Should scrapping quirked *gift* parts pay a premium (a reason to sell your Lucky gun)?
- Judges'-decision losses (03 §1): should the loser still get reduced salvage to soften
  timeout frustration?
