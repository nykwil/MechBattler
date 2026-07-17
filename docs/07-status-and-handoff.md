# 07 — Project Status & Handoff Notes

Snapshot at the close of the design + first-prototype thread (Jul 2026). Read this first
when resuming work.

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
- Run: `npm install`, then `npm run web:dev` (port 5174) and `npm run sim:test`.

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

- **Combat arena** (spec 03): PixiJS 2D arena, projectiles/dispersion/dead-reckoning,
  four-verb autopilot, locational damage vs. moving mechs, readability effects,
  post-battle report. **This is the recommended next milestone** — it unlocks the risk-R2
  ("watching is boring") and R3/R4 (balance) kill-criterion tests in 05.
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

1. Combat arena walking skeleton: two autopilot mechs, projectiles, locational damage,
   battle report (no player orders yet) — validates fight length + readability.
2. Four-verb order UI + auto-flag/trigger system on top.
3. Batch-sim harness + the 05 kill-criterion tests (weave-vs-straight, round-robin).
4. Salvage screen + economy loop (variants, quirks, ladder).
5. Workshop polish pass from the gap list above (items 1–4 can be slotted anytime).
