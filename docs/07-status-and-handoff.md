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
- No obstacles yet (walls exist; interior cover is the v1.5 arena milestone).
- Only spiders orbit, in a fixed direction; bipeds/quads still move purely radially, so
  armor skinning / radiator-side placement is exercised mainly by orbit matchups so far.
- Ballistic weapons don't consume ammo (U-AMMO is only a cook-off liability today).

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

## Tuning pass 1 — executed (Jul 2026)

1. **Spawn jitter**: seeded ±20 m lateral offsets + true initial facings; approach lanes now
   vary per battle. All prior tests still pass.
2. **Laser reprice** — a lesson in levers: the first attempt raised the charge *rate*
   (30→45 kW), which raised instantaneous demand past small reactors and the brownout rule
   shed the gun entirely — an energy "buff" that was a power-system nerf. The correct lever
   was **efficiency**: 30 kJ/shot at the same 30 kW (2.0 s cycle), heat 12→9 kJ, damage
   18→24. Now 12 dps at 30 kW — the hitscan+precision premium priced at ~25% below the AC.
3. **Vulture-skirmisher kernel**: carbine (60–180 m) + one MG instead of twin 30–90 m MGs.
   **14% → 60%** — the biggest single swing of the pass; kernel identity was the problem.
4. **Laser boat resurrection** (0% → 29%): three stacked causes, each found by reading
   battle logs — one gun can't carry a build (added a second laser); the *hybrid reactors
   were disconnected networks* (docs/01 §3) so one laser starved on the 25 kW Whisper alone
   (added a bridge conduit — the workshop would show this as two power networks); and
   default priority browned the guns out while closing (stop-and-pop: guns above
   locomotion). All three fixes are player-visible workshop moves, not engine changes.

Current standings (railgun 96%/budget 21, gunline 71%, vulture-skirmisher 60%, sniper 59%,
mule-skirmisher 44%, tank 33%, laser-boat 29%, orbiter 7%). Weakest kernels now:
**widow-orbiter** (7% — hitscan lasers and carbines ignore its evasion; likely wants more
guns or its own carbine) and the tank's generalist score (fine — it's a specialist).
Per-network CANNOT-SUSTAIN warnings (the laser-boat trap) are a good validation follow-up.

## Balance harness (docs/05 R4) — built, in use (Jul 2026)

`npm run sim:balance [seeds]` runs the template round-robin headless
(`src/templates.ts` — eight archetype builds validated for placement + connectivity;
`src/harness.ts`), reports win rates **with each build's tier-point budget** (docs/04 §5),
flags >70% (R4) and matchups outside the 35–65% band (R10). `npm run sim:adapt` runs the
fitting-only adaptation sweep; `npm run sim:demo` the tank-vs-sniper core-loop demo.

Standings after tuning pass 1 (20 seeds/pair; adapt sweep: 12 HARD, down from 19):

| Template | Win rate | Budget | Note |
|---|---|---|---|
| railgun-mule | **96% ⚠** | 21 | Outspends the field 2–3× — flag is mostly budget; needs brackets |
| mule-gunline | **71% ⚠** | 8 | Best value in the roster |
| vulture-skirmisher | 60% | 10 | Carbine kernel fix (was 14%) |
| vulture-sniper | 59% | 8 | Fast archetype, healthy |
| mule-skirmisher | 44% | 7 | Honest brawler |
| bastion-tank | 33% | 29 | Specialist: adapts into any matchup with armor (0%→90–100%) |
| mule-laser-boat | 29% | 14 | Resurrected from 0% (bridge conduit + stop-and-pop + retune) |
| widow-orbiter | **7%** | 6 | Weakest kernel: hitscan/carbines ignore its evasion |

**Before trusting the R4 flags**: budget-match the roster into brackets with elite
counterparts of each archetype. The known adaptation asymmetry: armor is a universal
fitting lever for heavies, but light mechs have no mobility equivalent (add a servo-booster
op to the adaptation catalog).

**Standings shifted (Jul 17 2026, motion-jitter + exchange-optimizing autopilot — table
above is pre-rewrite)**: gunline 77%⚑ · vulture-skirmisher 70% · sniper 62% · mule-skirm
51% · railgun-mule ~46% (was 96% — kiting now costs accuracy, and **bastion-tank walks
both snipers down 100-0**: backpedal jitter on a 1.2 mrad gun is crippling, exactly the
tank-counters-runaway-sniper dynamic we wanted) · laser-boat 32% · tank 29% (bimodal:
100% vs snipers, ~0% vs brawlers — armor adaptation is its lever) · orbiter 24% (up from
7%; orbiting is now chosen by exchange arithmetic). More 100/0 matchups than before —
the optimizing autopilot polarizes raw kernels; **tuning pass 2 + budget brackets**
(Track C2) should run before reading these as part-balance verdicts.

**Terrain shipped (Jul 18 2026, docs/03 §1a)**: arena is now a 240×240 square with a
seeded 20 m tile grid — forest (×0.65 silhouette cover), hill (×1.25 range envelope),
water (×1.6 radiator, the ram-air counterpart), each with a speed cost. The autopilot
prices tiles in its exchange scoring and shops neighboring tiles for better ground; the
replay draws the tiles and the HUD shows the current tile chip. Standings on terrain:
vulture-skirmisher 76%⚑ · gunline 76%⚑ · sniper 66% · laser-boat 44% (longer sightlines
suit it) · railgun 43% · mule-skirm 41% · tank 29% · orbiter 24%. Losing kernels now
rationally refuse engagements and run until cornered (walls end it) — the runaway rule
(Track C5) will want a look at this.

## Final Build Week balance pass — shipped Jul 21, 2026

The frozen tag `build-week-pre-final-tuning` reproduced exactly at 10 seeds per pair:
6 / 28 healthy matchups, 40-point roster spread, no build above 70%, Mule Skirmisher
29%, and Bastion Tank 29%. Fitting search plus fixed-seed battle telemetry isolated the
Mule's failure as range access: it lost both MGs before closing, with no heat shutdowns
or brownout sheds. Radiator, rocket, one-plate, and overweight combination experiments
were rejected.

The accepted content-only change added two tier-1 front plates to Mule Skirmisher while
preserving its twin-MG kernel. The identical 280-battle cohort finished at 8 / 28 healthy,
37-point spread, and these standings: Vulture Skirmisher 66%, Mule Gunline 64%, Vulture
Sniper 60%, Widow Orbiter 54%, Mule Skirmisher 50%, Railgun Mule 44%, Mule Laser Boat
33%, Bastion Tank 29%. Mule's former 0–100 losses to Vulture and Widow softened to 20–80
and 30–70; Gunline remains a documented 0–100 HARD counter. Bastion was deliberately
unchanged because it still beats both sniper kernels 100–0, validating its specialist
identity. No global simulation, autopilot, weapon, chassis, or terrain rules changed.

## Final Build Week diversity pass — shipped Jul 21, 2026

The final direction paused broad damage-number equalization and made coherent build
diversity the gate. `npm run sim:diversity -- 5` runs the eight stock archetypes plus
four representative perk builds through 330 deterministic battles, then compares every
perk with its unmodified control against all eight canonical opponents on the same seeds.
It exits non-zero for a >70% perk build, a dead representative perk, or a missed copy-loop
rejection. CI runs this alongside the unchanged 10-seed stock audit.

All four chassis now have at least two represented identities. The final stress found no
dominant perk build and no dead representative perk: Cold Bore, Fever Cycle,
Gyrostabilized, and Hull-down each gained 20–40 points in at least one matchup while their
aggregate control deltas stayed between −7 and +3 points. Duplicate Fever is rejected by
the one-copy rule; the editor also enforces one mod per part. Vulture's 16-cell grid leaves
8–10 fitting cells after weapon/reactor kernels and 2–4 free cells after coherent fits—
tight, but sufficient for multiple identities.

Rejected screens included 90–100% empty-frame Bastion anchors (silhouette/empty-cell
abuse), a Fever threshold above 60°C that activated only 2–3%, removing the Fever build's
radiator, and single-opponent activation attribution. The accepted Fever onset is 50°C
with a permanent 25% draw tax. Stride's previously dead documented +15% speed now applies
only while connected, powered, and functional and never stacks multiplicatively. Modifier
effects now feed both expected-DPS planning and shot resolution; no global damage, weapon,
chassis, terrain, or autopilot constants changed. Full evidence is in
`docs/submission/TUNING-REPORT.md`.

## Workshop: done vs. remaining (01 §9 checklist)

**Done**: illegal-placement feedback (rejected clicks flash + name the reason), build
validation (FAULT/WARN/HINT panel: physical impossibilities, CANNOT SUSTAIN FIRE with
time-to-empty, heat capacity, overload, disjoint envelopes), **balance meters** (energy +
heat bullet gauges with capacity ticks and red overflow), **inventory hover preview**
(meter + mass deltas from a phantom part), always-live thermal prediction, **prescriptive
heat advice** ("run a Sweat pipe path to your Gill" — hints resolve when followed, verified),
part selection/inspector with deliberate removal, **unified part silhouettes** on the grid.

**Remaining**: per-conduit load display, auto-route suggestion (05 R1), drag-and-drop,
undo, build save/load (everything resets on reload), per-network peak-demand validation
(the "laser trap": average margin passes while charge-peak demand can never fit).

## Roadmap (reviewed Jul 17 2026)

Three parallel tracks; A is the recommended next milestone.

**Track A — Run structure & economy (spec 04; the missing pillar).** This is what turns
the toy into the roguelike: fight purse → wreck screen (loot at integrity, victory type
shapes the haul) → scrap/repair triage → 12-node ladder with intel-card opponent choice →
starter kits → permadeath. Prerequisite first step: the **per-instance part-state
refactor** (parts carry stat modifiers; integrity exists, variants ±10%, quirks, and
location affinity all land on the same hook). The template roster doubles as the enemy
pool; budget = f(node) is already the harness currency.

**Track B — Combat presentation.** ✅ **v1 shipped (Jul 17 2026).** The battle is now
order-driven end to end: the four verbs are a typed `MechOrder` union, the autopilot is
just a `Controller` that emits them at 4 Hz through `Battle.issueOrders` (the exact
channel a future player-controlled mode will use — pass a custom controller or step the
battle manually), order *changes* are logged as `order` events, and reports carry
per-tick `frames` (pose, throttle, core HP, functional mass; `recordFrames: false` for
harness runs). The web report screen gained a Replay tab: SVG arena playback with
oriented true-footprint mechs (magnified 5×), tracers/impact rings/destruction flashes
from the event log, status meters, play/pause/speed/scrub, and a ticker narrating orders
and consequences. **v2: cockpit HUD** (LoL-style, prepping the playable mode): frames
now carry per-weapon fire-control state (`WeaponFrame`: readiness fill toward the next
shot across all three feed types — cycle / charge / capacitor — enabled, shed/shutdown/
destroyed status, temp), hottest-cell heat, pooled capacitor kJ, supply/demand kW, and
the standing orders (intent, face mode, destination). The replay renders your gun bar
along the bottom (ability-square slots with ready-fill, muzzle flash, HOLD/shutdown/✕
states, hover blurbs), HEAT/CAP/PWR gauges with threshold marks, verb chips
(throttle / move intent / face toggle), destination waypoints in the arena, and a
compact mirrored enemy strip. These readouts become the click targets when the verbs go
player-controlled. Remaining polish (later): part-damage charring on the mech glyphs,
heat glow, projectile-flight theater for slow rounds.

**The playable (live verb control) mode SHIPPED Jul 18 2026** — milestones M1–M4 of
`archive/08-playable-battle-plan.md` (live stepping with tactical pause, manual move/throttle/
weapons/face over the autopilot via `withManualOrders`, keybindings, report parity).
The Fight button offers **Fight · Live** (command) and **Watch** (headless + replay).
Still open from that plan: M5 stretch (enemy-intel limits on the live strip, waypoint
queues, region triggers) and the "scripted player beats the autopilot in a matchup it
loses" showcase test.

**The UX & diagnostics pass SHIPPED Jul 18 2026** (`archive/09-ux-diagnostics-plan.md`, all five
milestones): arc wedges + range sandbox + waypoint-facing fix, playable friction fixes
(no stale report after abort, live 4×, same-seed rematch), not-firing legibility
(per-slot RANGE/ARC/HOT vs player HOLD), the network-starved audit, the ⚡ Auto-wire
baseline, and sandbox uptime attribution. Balancing explicitly deferred — building for
feature-completeness and user experience first (user call, Jul 18 2026).
**Track A — run structure & economy** (plan: `archive/10-run-structure-plan.md`; economy numbers
are config dials, balancing deferred): M1 run shell, M2 wreck salvage and M3
repair/refit/integrity **shipped Jul 18 2026**. M3 landed: integrity-scaled part HP
pinned in tests, `partsFinalHp` on MechReport (loot condition now includes heat and
cook-off damage), partial/full repair (0.4 × tier per point), sell-a-placed-part,
bench-pool → grid placement ("fit") and unplace-back, grid integrity badges — plus a
placeholder shop: during a run, catalog parts (and auto-wired conduits) are bought at
tier × `SCRAP_BUY_MULT` (12 > sell 8, so the palette can't mint scrap; M4's scrapyard
nodes supersede this). Design revision (user call, Jul 19 2026): **no bosses and no
mid-run chassis changes** — the ladder is the budget curve alone, and chassis/parts are
**meta-unlocks** earned by beating them, gating future runs' starter kits and shop stock
(04 §7, 10 M4/M6). M4 enemy ladder **shipped Jul 19 2026**: budget-driven seeded
opponents (sim `generateOpponent`), elites, scrapyard nodes, arena-preview intel cards
with heavier-frame warnings; integrity-scaled sell prices. M5 variants/quirks/mods
**shipped Jul 19 2026** on one extensible substrate (`sim/modifiers.ts`, see 10 M5):
loot rolls, first-wreck guaranteed mod, elite carriers, scrapyard machinist, ModChips
UI. M6 meta unlocks & polish **shipped Jul 19 2026**: persistent profile, unlock-on-
victory with wreck-screen announcements, custom-frame prep starts (START_BUDGET,
locked-part palette), run-history memorial, + Sticky/Cold-soaked/Marsh-pistons
modifiers. **Track A (docs/10) is complete, M1–M6.** Remaining threads: three
modifiers (Frankensteined, Thermocouple skin, Surge gate), 04 §9 open questions,
starter-kit rotation — then Track C balancing (deferred, user call) and the 00
backlog (ammo, turrets). **Track B — multiplayer** planned Jul 19 2026 in
`11-multiplayer-plan.md` (user call: deterministic lockstep; audit found the sim
already pure/headless/JSON-serializable). **M0+M1 shipped Jul 19 2026**: zero global
sim state, SIM_VERSION + content hash, dmath deterministic transcendentals,
Battle.stateHash, golden battle cross-verified bit-identical on V8 and SpiderMonkey.
**M2 shipped Jul 20 2026**: `lockstep.ts` (TickOrder/MatchReplay/LockstepBattle/
replayMatch), 20 Hz manual orders via opt-in Battle lockstep mode + shared
mergeManualOrders, tamper-catch via replay re-verification, order-driven match
cross-verified engine-identical. **Track B paused after the foundation (M0–M2, user call
Jul 20 2026)** — the deterministic core is in the codebase and the **determinism contract
that keeps future features multiplayer-safe lives in `11-multiplayer-plan.md` §3**
(enforced by the grep guard in `determinism.test.ts`: no engine transcendentals, no
wall-clock/entropy in the sim). The remaining server + client + ranked work is parked in
**`12-multiplayer-backlog.md`**. A Jul 20 2026 audit confirmed the whole sim satisfies
the contract today.

**Full game experience pass shipped Jul 25 2026** (`13-full-game-experience.md`):
the default route is now a title/new-run/profile flow; run/profile data have versioned
headless contracts in `@mechbattler/game`; player equipment damage persists after every
battle; destroyed player parts are removed; the active catalog is no longer an unlimited
shop; intact wreck scrap scales with integrity; combat challenges unlock future starting
parts; chassis remain defeat unlocks; and seeded machinist services occur after wins
3/6/9. `game:audit` validates acquisition/unlock reachability and excludes the dead
`U-AMMO` placeholder. Existing saves and unlocks migrate forward.

**Run-balance automation follow-up (Jul 25 2026):** a single fight is now a versioned
`MatchInstance`, separate from `RunInstance`; stable `RunCheckpoint` fixtures can branch
at configured round depths without cross-test mutation. `game:balance` measures natural
run reach/economy, while `game:match-balance` measures isolated fight balance from
pristine or captured checkpoint corpora. Both emit deterministic JSON and target-band
warnings, and both run in CI.

**Garage/equipment-visibility follow-up (Jul 25 2026):** New Run is now a persistent
saved-mech garage instead of a locked starter/frame catalog. Profiles store reusable
pristine loadout blueprints; loading enters editable prep and saving creates or overwrites
a stable design. Campaign prep shows only unlocked equipment, active runs show only
installed/benched equipment, and the full catalog remains exclusive to the explicitly
labeled Sandbox. The duplicate run picker formerly embedded in Sandbox was removed.

**Design-notes intake (Jul 18 2026)**: `mech_builder_prototype_design_notes.md` reviewed
against the specs. Already covered: per-verb automation (03 §2, shipped), arcs as
mechanics (03 §5), heat/power as the real limits (02), support-part identities (06),
determinism/serialization (R6). Newly captured: build audit / auto-wire / arc overlay
(01 §9), bench diagnostics (02 §6), not-firing legibility (03 §9), conditional-fire
stance (03 §2 post-v1 note), wall-corner flight watch item (03 §10), multiplayer
lock-in concept (00 backlog).

**Track C — Sim/balance thread (slots in anytime, feeds tuning pass 2):**
1. **Ammo system** — the weapon-identity move (specced in 01 §7, biggest unimplemented
   system): bins hold finite shots, feed adjacent/conduit-connected ballistic weapons;
   ballistics become power-cheap but cell/ammo-hungry vs. energy (watts+heat) vs. railgun
   (capacitor infrastructure). Also an economy hook (reloads cost scrap).
2. Widow-orbiter kernel fix (7%) + budget brackets with elite templates + the weapon
   efficiency table (dps per tier-point / kW-draw / kW-heat / cell / kg).
3. Servo-booster adaptation op (the light-mech fitting lever).
4. System-attacking weapons ✅ *shipped Jul 22 2026 (content pass)* — **Scald (W-SC)**
   flamer deposits `enemyHeatKj` into the struck cell (attacks the thermal sim → cooks
   builds into shutdown/burn-down); **Static (W-ION)** ion cannon `capDrainKj` bleeds the
   enemy's stored charge (attacks the power sim → starves railgun/Surge/Thermocouple
   builds). Both are new `WeaponSpec` fields applied on hit via `Simulation.depositHeatAt
   Cell` / `drainCapacitorChargeKj` — R1-clean (watts + joules), lockstep-deterministic
   (modify already-hashed state), legible on the existing HEAT/CAP gauges (R4, no new UI).
   Also added **Reservoir (P-CAP2)**, a big-alpha capacitor (200 kJ, slow charge) opposite
   the small/snappy Jolt — the choice cap-fed builds never had. Starter weapons stay simple
   scalars (R5); these are tier-3. 7 tests; `SIM_VERSION` → 1.3.0. Not yet folded into
   templates/elites or the balance cohort — tuning is a later pass.
5. Turn-tail flight behavior + the runaway/comeback rule for residual bad matchups.

**Deferred/backlog** (unchanged): manual four-verb order UI, turret mounts, terrain +
obstacles (v1.5 — the big fast-mech buff), irregular L/T/S part shapes, RogueTech-style
heat-penalty ramp, physics/IK presentation, async PvP.

## Loose ends & ideas worth mining (captured, undecided)

- **Rare/unique salvage — `04 §4b Mods`**: the modifier substrate, machinist offers,
  one-mod-per-part rule, copy limits, and four representative stress builds are now
  implemented. Five costly identity levers passed the final stress; acquisition rarity,
  machinist pricing, elite carriers, and whether uniques = named pre-rolled
  mod+variant+quirk remain Track A M5 work.

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

(Next-thread order superseded by the Roadmap section above.)
