# 07 — Project Status & Handoff Notes

Snapshot as of mid-Jul 2026 (design + workshop prototype + headless combat skeleton).
Read this first when resuming work.

## Direction decisions (Jul 2026 thread)

- **Watching combat is presentation, not a pillar.** The game should work even if combat
  were text and resolved instantly; the payoff beat is the *diagnosis* (battle report),
  which makes risk-05 R2 mostly a presentation concern. We still want to draw battles —
  the renderer is a playback layer over the sim's event log.
- **Shot resolution is purely stat-based (final)**: P(hit) computed from dispersion,
  range, target projected width, and lateral speed × (tracking lag + time-of-flight);
  rolled on the seeded RNG; hits sample an impact point and run the normal entry-cell /
  penetration walk (03 §5). Muzzle velocity matters statistically — slow projectiles are
  dodgeable by crossing targets with **zero flight simulation**. Dead reckoning and the
  wiggle-war machinery (03 §8, 05 R3) are retired/moot. Drawn bullets are presentation.
- The four-verb order system survives as the autopilot's internal vocabulary; the *manual
  order UI* is not a near-term priority.

## What exists and works

**Design docs 00–06** — core design, chassis grid, power/heat, combat, salvage/economy,
risk review, synergy design. Specs 00–04 are internally cross-referenced; 05 defines the
prototype's acceptance tests; 06 catalogs the emergent synergy space.

**Working prototype** (commit `ecea467` + doc updates after):

- `packages/sim` — pure-TS deterministic sim: part catalog, 4 chassis, polyomino placement
  + legality, cell-level Union-Find power networks (multi-hop conduits), 20 Hz tick engine
  (reactors, capacitors, weapon cycles, brownout shedding with hysteresis, per-cell heat
  conduction, radiators, thermal thresholds), derived stats + test bench.
  **25/25 vitest tests pass.**
- `apps/web` — React+Vite workshop: chassis switcher, part palette, SVG grid editor
  (click-to-place, R to rotate, hover legality preview), parts/power/thermal overlays,
  live stats panel, brownout priority reorder list, test bench with charts.
  Verified end-to-end in the browser; `npm run web:build` clean.
- **Headless combat skeleton** (`packages/sim/src/combat.ts`, this thread): seeded PCG32
  (`rng.ts`), `Battle`/`Combatant` — 2D kinematics (directional speed ellipse, accel, turn
  rate, load/CoG derating, recoil, stagger), four-verb autopilot at 4 Hz (band-seeking
  destination, speed setting, face-target, arc/range/temp-gated weapons), sampled-bearing
  hitscan shot resolution (all dispersion multipliers), ray → entry cell → locational
  damage with 50% overkill penetration and 25% wreck absorption, core HP, mid-fight
  network splits (`Simulation.destroyPart`), cook-off splash, heat-damage part loss, and
  victory by core-kill / mission-kill surrender / 120 s judges' decision. Emits a full
  `BattleReport` event log (shots, sheds, shutdowns, part losses, victory) — the renderer
  and post-battle report both read this. Sanity fights land at 13–30 s. **40/40 tests.**
- **Stat-based hit model + orbiting** (03 §5): `computeHitModel` is pure and exported (the
  workshop can chart hit% curves); strafe-capable chassis (spiders) orbit inside their
  band. Measured at 40 m vs an orbiting Widow: AC 64% hits (87% with TC, ~100% vs head-on
  targets); rocket pod ~83% at its closer band but pays 5× the railgun's escape time at
  range. Speed is a defensive stat, muzzle velocity a real balance dial, and the targeting
  computer their purchasable counter — all live today. Cycle weapons enter battle loaded
  (first volley immediate).
- **The core loop is playable**: the workshop's Arena panel (`ArenaPanel.tsx`) offers a
  3-opponent intel-card roster (`lib/opponents.ts`, per docs/04 §5), runs `runBattle`
  against the editor's current build, and shows a post-battle report screen
  (`BattleReportScreen.tsx`): victory banner + reason, per-mech stats, damage-by-part
  both directions with destroyed markers, and the event timeline (sheds, shutdowns,
  part losses, heavy hits). Rematch reruns with a new seed. Build → fight → diagnose →
  refit works end-to-end in the browser (verified via headless Chromium).
- Run: `npm install`, then `npm run web:dev` (port 5174) and `npm run sim:test`.

### Combat-skeleton simplifications (extend, don't silently inherit)

- Mount arcs always centered on chassis forward; muzzle-perimeter placement not enforced.
- Autopilot weapon-enable skips the one-tick brownout preview (03 §7 item 4).
- Locomotion power draw uses the straight-line derated speed, not instantaneous arena
  velocity; a shed locomotion halts the mech instead of throttling it.
- No obstacles/arena walls; spawn distance is the only geometry.
- Only spiders orbit, in a fixed direction; bipeds/quads still move purely radially, so
  armor skinning / radiator-side placement is exercised mainly by orbit matchups so far.

## Archetype-balancing mechanics + the RPS triangle (Jul 2026)

Added to widen the viable-archetype space (docs/06 §8 target: ≥3 per tier), all R1-physical:
- **Ram-air cooling** (02 §3): radiator output scales with speed → speed is a cooling stat,
  enabling fast hot-running builds. Slow tanks can't use it.
- **Mass-scaled stagger** (03 §5): stagger = damage ÷ mass ≥ 3.3 → heavy mechs are stable
  gun platforms; light mechs stagger easily. The tank-identity lever.
- **Arena walls** (03 §1): bound movement, cap runaway kiting (safety rail; the chassis grid
  already blocks the worst runaway build, so not yet binding — see 03 §5).
- **Two weapons**: W-CB Needle (light long-range carbine, scout-sniper enabler) and W-BR Maul
  (heavy short-range siege gun, cliff falloff past 45 m — the tank's payoff weapon).
- **Two templates**: `vulture-sniper` (fast carbine kiter) and `bastion-tank` (armored siege).

**Result — no dominant archetype** (`npm run sim:demo`, 60 seeds each): fast-sniper beats
gunline **65%**, gunline beats tank **73%**, tank beats sniper **73%** — three viable
playstyles. **Design direction (decided): this must be fighting-game-flat, not RPS-sharp** —
see 05 R10. One persistent mech per run means matchups must sit in a 35–65% band and bad
ones must be fixable by refitting, never rebuilding.

## Keystone/fitting split + adaptation search (05 R10, Jul 2026)

`sim/src/adaptation.ts`: keystones (chassis + weapons + reactors) vs fitting (everything
else); a fitting-only op catalog (armor plating front-first, strip armor, TC, heat sinks,
radiator, capacitor, priority reorder); `npm run sim:adapt` sweeps every sub-35% matchup and
labels it SOFT (fitting recovers it) or HARD. First sweep (20 seeds/eval): **8 SOFT, 19 HARD**.

What the sweep taught us (all legible, all physical):

- **SOFT wins are dramatic and readable**: skirmisher vs gunline 0%→50% by adding two heat
  sinks (its MGs were thermal-shutting down mid-fight — no radiator in the build); tank vs
  railgun 0%→95% by plating the two free center-lane cells (the railgun was coring it down
  one penetration lane). "Read the loss, plate the lane" is the core loop working.
- **The two kernel-level failures are correctly isolated**: mule-laser-boat is HARD vs
  everything (part mispricing — no fitting saves a bad keystone) and vulture-skirmisher is
  HARD vs nearly everything (an MG-band fast chassis must cross 60+ m of fire with 16 cells;
  the kernel, not the fitting, is wrong).
- **Kiting is bounded by reverse speed, not forward** — a biped that retreats while facing
  (to keep its gun arc) moves at rev speed (Vulture 2.5 m/s < Bastion fwd 4.0), which is why
  the tank catches the "faster" sniper. Orbit-kiting at strafe speed is the spider's
  privilege. Real depth, but the autopilot never chooses turn-tail flight; worth a verb-3
  behavior when we want true runaway.
- **Matchups are knife-edge deterministic**: 0%→85-100% swings from two plates mean the
  autopilot takes identical approach lanes every battle (only dispersion varies). Add spawn
  position/bearing jitter to decorrelate before trusting exact percentages.

Next tuning pass, in order: (1) spawn jitter, (2) reprice the laser (energy-lever first:
maxChargeKw 30→45), (3) fix the vulture-skirmisher kernel (its identity likely wants the
carbine, making stock MGs the brawler's sidearm), (4) re-run balance + adapt sweeps.

## Balance harness (docs/05 R4) — built, first results (Jul 2026)

`npm run sim:balance [seeds]` runs the template round-robin headless
(`src/templates.ts` — eight archetype builds validated for placement + connectivity;
`src/harness.ts`), reports win rates **with each build's tier-point budget** (docs/04 §5),
and exits non-zero if any template breaches the 70% win-rate kill criterion. Current
(20 seeds/pair, 560 battles, ~8 s):

| Template | Win rate | Budget | Note |
|---|---|---|---|
| railgun-mule | **96% ⚠** | 21 | Outspends the field 2–3× — the flag is mostly budget, not brokenness |
| mule-gunline | **78% ⚠** | 8 | The best value in the roster; anchors the RPS triangle |
| vulture-sniper | 65% | 8 | The new fast archetype — successful, not degenerate |
| mule-skirmisher | 59% | 7 | Mission-kills the orbiter (shoots its MGs off) |
| bastion-tank | 54% | 29 | Specialist counter, over-costed for a generalist score |
| widow-orbiter | 34% | 6 | Evasion works vs precision, loses the DPS race |
| vulture-skirmisher | 14% | 9 | Short MG band; dies crossing to anything |
| mule-laser-boat | **0%** | 11 | Laser is mispriced: 4.8 kW heat for 7.2 DPS |

**Still to do before trusting the R4 flags**: budget-match the roster into brackets (the
railgun/tank flags are partly budget artifacts — a 21-budget build *should* beat 6–8 budget
starters). The laser's 0% at budget 11 is a genuine part-mispricing signal regardless — the
efficiency-table lever (dps per kW-heat, per kW-draw, per cell) is the next harness addition.

## Spec-vs-prototype gap (specced this thread, not yet implemented)

Ordered roughly by how much they'd improve the existing workshop:

1. **Illegal-placement feedback** — clicks on illegal cells are rejected *silently* (hover
   preview shows red, but a click gives no toast/shake). Violates rule R5 spirit; observed
   directly during browser verification. Cheapest, highest-value fix.
2. **Balance bars** (01 §9) — energy net-flow (negative = draining caps + time-to-empty)
   and heat net-flow gauges, always visible.
3. **Inventory hover preview** (01 §9) — hovering a palette part previews its stat deltas
   before placement.
4. **Location affinity** (01 §7 table) — rear/side-gun dispersion penalties, ammo-adjacency
   cycle bonus, heat-sink/reactor pairing, perimeter-reactor fragility. Not in sim yet.
5. **Stat variants on salvage** (04 §4) — ±10% rolls with green/red deltas vs. stock.
   No salvage system exists yet at all, so this lands with the economy pass.
6. **Quirks** (04 §4) — including the new temperature-conditioned pair (Heat-loose,
   Cold-blooded). Sim hooks needed: per-part conditional stat curves keyed to cell T.
7. **Mount-arc fire gating** (03 §5) — sim has arcs in the catalog but no combat, so
   nothing enforces them yet.
8. **Mount-minimum warning states** (02 §2, open question) — decided warn-only for now;
   needs the loud "CANNOT SUSTAIN FIRE" treatment when built.
9. **Irregular part shapes** (01 §1) — grid code already supports arbitrary polyominoes;
   the catalog just needs L/T/S entries.
10. **Turret mounts** (01 §10) — post-v1 sketch only; grid rules must not preclude it.
11. **Auto-route suggestion button** (05 R1 mitigation) — not started.
12. Workshop conveniences: drag-and-drop (currently click-only), undo, build save/load
    (everything resets on reload), per-conduit load display (01 §9).

## Not started (the other pillars)

- **Combat presentation** (spec 03): PixiJS playback of the battle event log, readability
  effects (03 §9), post-battle report UI. The sim side now exists (see above) — this became
  a rendering task, not a systems task.
- **Salvage/economy/run structure** (spec 04): wreck screen, scrap, repair, variants,
  quirks, 12-node ladder, intel cards (now incl. arena preview), starter kits.
- **Batch-sim balance harness** (05 R4): headless round-robin of template builds — cheap
  once the arena sim exists; also serves the wiggle-war test (03 §8).

## Loose ends & ideas worth mining (captured, undecided)

- **RogueTech heat-escalation ladder**: before hard shutdown at 130°C, soft penalties could
  ramp (dispersion/speed degradation as cells heat). Our thresholds (02 §3) are cliff-edged;
  RogueTech's escalating-penalty scale reads well in play. Candidate 02 change — weigh
  against sim readability before adopting.
- **"The workshop never lies"** — positioning/marketing angle vs. RogueTech's infamous
  refit-screen "LIES"; our stats are measurements from the real sim. Keep for store page.
- **Quirked-part identity on enemies**: elites built *with* quirked parts so intel
  telegraphs inherited quirks (already in 04 §4/§5) — make sure enemy templates encode this
  when the economy pass lands.
- Open questions already tracked in specs: 01 §11 (cell counts, conduit ratio, penetration
  pacing), 02 §7 (hysteresis, conduction k, waste-heat tax, laser knife-edge), 03 §10
  (fight length, 4 Hz autopilot, timeout judging, arc-edge penalty), 04 §9 (bench-pool cap,
  gift-scrap premium, timeout salvage), plus mount minimums (02 §2).

## Suggested next-thread order

1. ~~Combat walking skeleton~~ — **done this thread** (headless; see above).
2. Batch-sim balance harness on top of `runBattle` + the 05 R4 round-robin kill-criterion
   test (weave-vs-straight is deferred with projectile travel time).
3. Battle playback renderer (PixiJS or simple SVG/canvas first) + post-battle report UI —
   reads the `BattleReport` event log.
4. Salvage screen + economy loop (variants, quirks, ladder). Consider the per-instance
   part-state refactor first (integrity already exists; quirks/variants/affinities all
   need per-instance stat modifiers in the sim).
5. Workshop polish pass from the gap list above (items 1–4 can be slotted anytime).
6. Four-verb manual order UI (demoted — see direction decisions).
