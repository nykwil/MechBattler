# 07 — Project Status & Handoff

*Audited 25 Aug 2026. Read this first, then `CLAUDE.md`, which carries the working
rules this document explains the reasoning behind.*

*The Jul 2026 body of this file — the RPS/archetype work, the keystone-fitting
split, tuning pass 1, the week-by-week standings and the old three-track roadmap —
now lives in `archive/2026-07-status-record.md`. It is kept for the record of what
was tried; none of its numbers are current.*

## 1. What the game is today

A phone-first roguelike about building a mech and reading why it lost.

`Title → Garage → load or build a mech → prep → node intel → battle → report →
settlement → salvage → mod milestone → refit`, twelve seeded nodes to a run, one
persistent mech, permadeath on a core kill. The title screen also opens Profile &
Unlocks, the free-play Workshop Sandbox and the Balance Lab; `?view=workshop`,
`?view=battle`, `?view=balance` and `?view=salvage` reach surfaces directly.

Battles can be **watched** (headless + replay) or **fought live** with tactical
pause and manual four-verb control over the autopilot.

| Package | What it owns |
|---|---|
| `packages/sim` | The deterministic simulation: grid, spatial construction, power networks, thermal model, combat, modifiers, hit model, terrain, lockstep, and the balance/adaptation/diversity harnesses. Pure, headless, JSON-serializable. |
| `packages/game` | The application domain: `RunInstance`, `MatchInstance`, `RunCheckpoint`, `MechInstance`, `PartInstance`, `PlayerProfile`, content dials, the audit, and the run/match balance harnesses. Versioned and headless. |
| `apps/web` | React + Vite. The mobile shell, workshop, battle, replay, report, salvage, run panel, scrapyard, Balance Lab. An adapter over the two packages — it never computes a number the sim can compute. |
| `apps/physics-prototype` | A separate locomotion/payload-physics experiment. Out of bounds for game features. |

## 2. Where the truth lives

| Doc | Role |
|---|---|
| `00`–`06` | Living specs: core design, chassis grid, power/heat, combat, salvage/economy, risk review, synergy. Cross-referenced; still authoritative. |
| `mechbattler_spatial_construction_mechanics.md` | The spatial-construction contract — regions, ports, bus/heat-pipe routing, stacking, location zones, sealed armour. Its header records the implemented slice; the alternatives later in the capture are superseded. |
| `11-multiplayer-plan.md` | The shipped deterministic core, and **§3, the determinism contract** every future sim feature must hold. Read §3 before adding sim behaviour; `determinism.test.ts` greps for violations. |
| `12-multiplayer-backlog.md` | The parked server/client/ranked work. |
| `13-full-game-experience.md` | The application-level contract: flow, state, transaction order, migrations. |
| `14-mobile-design-system.md` + `prototypes/` | The mobile design. **The prototypes win** where the prose disagrees. |
| `15-mobile-port-status.md` | How the port was done and verified, and §9's gaps. §7's balance numbers are superseded by its own banner. |
| `16-progression-loop-foundation.md` | The progression model as it stands, the passes that produced it, and the remaining warnings. The active balance document. |
| `17-balance-findings.md` | Hand-written record of balance *causes*. Read F1 before touching a weapon curve. |
| `18-lore-and-world.md` | Lore and world foundation. |
| `19-watchlist.md` | Judgements we are deliberately keeping an eye on. Read before a balance pass or before touching placement. |
| `archive/` | Finished plans and historical records. Numbering is never reused. |

## 3. Direction decisions that still stand

- **Watching combat is presentation, not a pillar.** The payoff beat is the
  diagnosis — the battle report. The renderer is a playback layer over the sim's
  event log.
- **Shot resolution is purely stat-based (final).** P(hit) from dispersion, range,
  target projected width, and lateral speed × (tracking lag + time-of-flight),
  rolled on the seeded RNG; hits sample an impact point and run the entry-cell /
  penetration walk (03 §5). No flight simulation; drawn bullets are presentation.
- **Matchups should be fighting-game-flat, not RPS-sharp** (05 R10). One
  persistent mech per run means a bad matchup must be fixable by refitting.
- **No bosses and no mid-run chassis changes** (user call, Jul 19 2026). The ladder
  is the budget curve; chassis and parts are meta-unlocks. The single exception is
  the deliberately expensive whole-wreck recovery on a victory salvage screen.
- **Balance is its own pass and does not gate feature work** (user call). The
  harnesses are report-only; `balance:collect` / `balance:report` show what moved.
- **There is no desktop design.** Above 768px the shell centres a 560px column.

## 4. Shipped

Each entry names where its plan went.

- **Playable battle, M1–M4** — live stepping, tactical pause, manual orders over
  the autopilot, keybindings, report parity. Jul 18 2026 · `archive/08-playable-battle-plan.md`
- **UX & diagnostics pass, all five milestones** — arc wedges, range sandbox,
  playable friction fixes, per-slot not-firing legibility (RANGE/ARC/HOT vs HOLD),
  the network-starved audit, ⚡ Auto-wire, sandbox uptime attribution.
  Jul 18 2026 · `archive/09-ux-diagnostics-plan.md`
- **Run structure & economy, M1–M6** — run shell, wreck salvage, repair/refit/
  integrity, budget-driven enemy ladder with elites and scrapyards, variants/
  quirks/mods on one modifier substrate, meta unlocks and the run memorial.
  Jul 18–19 2026 · `archive/10-run-structure-plan.md`
- **Multiplayer foundation, M0–M2** — zero global sim state, `SIM_VERSION` +
  content hash, deterministic transcendentals, `Battle.stateHash`, lockstep orders
  and replay verification, cross-verified bit-identical on two engines. Then
  **paused** (user call). Jul 19–20 2026 · `11-multiplayer-plan.md`, backlog in `12`
- **Full game experience** — title/garage/run route, versioned headless run and
  profile contracts, persistent equipment damage, bounded shop, challenge unlocks,
  seeded machinist services after wins 3/6/9, save migration. Jul 25 2026 · `13`
- **Run-balance automation** — `MatchInstance` separate from `RunInstance`,
  branchable `RunCheckpoint` fixtures, `game:balance` and `game:match-balance`.
  Jul 25 2026
- **Garage and equipment visibility** — profiles store reusable pristine
  blueprints; prep shows unlocked equipment, runs show installed/benched, the full
  catalog is Sandbox-only. Jul 25 2026
- **Mobile port** — the whole interface re-done as a port of the recovered
  prototypes' own CSS and markup, plus the CDP driver, screen audit and campaign
  smoke that keep it honest. Jul 30 2026 · `15-mobile-port-status.md`
- **Spatial construction slice** — regional grids, immutable shoulder ports, bus
  and heat-pipe routing layers, damageable coupler/manifold equipment, equipment
  stacking, sealed armour, authored location zones.
  Aug 2026 · `mechbattler_spatial_construction_mechanics.md`
- **Progression loop foundation** — the twelve-node ladder, opponent doctrines,
  purse/repair economy, unlock reachability, and the cohort harness that measures
  the one-hour experience. Aug 2026 · `16-progression-loop-foundation.md`
- **Component height** — every part has a height, every gun a forward clearance;
  chassis can author a low roof; placement refuses from either end; risers and the
  gimbal lift what they mount. Aug 25 2026 · `502cb0f`,
  `archive/2026-08-24-component-height-design.md` + `-25-component-height-plan.md`
- **Report-only balance with a diff** — `balance:collect` writes artifacts,
  `balance:report` diffs them against `artifacts/balance-baseline.json` and names
  any build that moved 5+ points. Aug 2026

Weapon content since the specs: **Scald (W-SC)** deposits heat into the struck
cell and **Static (W-ION)** drains stored charge — the two system-attacking guns —
plus **Reservoir (P-CAP2)**, the big-alpha capacitor. Shipped Jul 22 2026; not yet
folded into templates, elites or the balance cohort.

## 5. What is open

### Balance and progression

`16-progression-loop-foundation.md` § *Remaining warnings* is the live list. In
short: both profiles sit at or above the 0.8 win-rate ceiling with a flat per-node
curve (settled in favour of build diversity, and improved by doctrines to 0.783);
part usage is concentrated and `U-TUR` is never fielded; heat discriminates but is
not yet a decision builds make, so `redline`, `R-C90` and `W-SC` stay effectively
unreachable; armour is the largest share of parts fielded; accuracy is not a live
build axis at 91.8% hits; `railgun-mule` is the weakest template and sits at
−28.2 kW margin; the Vulture's 13-tier carrying cap is unpaid for.

`19-watchlist.md` holds what we are watching rather than fixing: the baseline
predating component height, the height swing being geometry rather than budget,
the two standing report-only findings (`mule-fever-cycle` dominant combination,
`gyrostabilized` reading dead), and five judgements from the height work.

`17-balance-findings.md` F1 is the current regression and its cause.

### Workshop (01 §9 checklist)

Done: illegal-placement feedback, the FAULT/WARN/HINT build audit, per-network
starvation and cap-starved-weapon checks (the "laser trap"), balance meters,
inventory hover preview, live thermal prediction, prescriptive heat advice, part
inspector, unified silhouettes, ⚡ Auto-wire, arc wedges.

Open: per-conduit load display, auto-route *suggestion* (05 R1, distinct from the
auto-wire baseline), drag-and-drop, undo. In-workshop save/load is superseded by
the garage's saved blueprints.

### Mobile (`15` §9)

Target part temperature in the diagnostics passes ambient; `foeBuild` is wired
only in the live battle, so a diagnostics overlay opened during replay would read a
neutral profile; the desktop arena letterboxes; the run panel and scrapyard are
harmonised with the shell's tokens but were never designed (14 §15).

### Track C — sim/balance backlog

*Numbering preserved: `simulation.ts` cites "docs/07 Track C §4".*

1. **Ammo system** — **deliberately deferred, not forgotten.** See §6.
2. Retired-orbiter kernel investigation, budget brackets with elite templates, and
   the weapon efficiency table (dps per tier-point / kW-draw / kW-heat / cell / kg).
3. Servo-booster adaptation op — the light-mech fitting lever, the counterpart to
   armour for heavies.
4. System-attacking weapons ✅ shipped Jul 22 2026 (see §4); still to be folded
   into templates, elites and the balance cohort.
5. Turn-tail flight behaviour and the runaway/comeback rule for residual bad
   matchups. Losing kernels already refuse engagements and run until cornered.

### Multiplayer

Everything past the deterministic core is parked in `12-multiplayer-backlog.md`.
The contract that keeps it possible is `11` §3 and is enforced by a test.

## 6. Deliberately deferred

These are decisions, not gaps. Do not re-propose them without new evidence.

- **Ammo.** `U-AMMO` stays a disabled placeholder: `ENABLED_PART_IDS` excludes it,
  `game:audit` fails if it is enabled, `sim:diversity` reports it as a dead
  placeholder by design, and the mobile gun chip deliberately shows no ammo count.
  Ballistic, missile and chemical guns are already distinct from energy and
  cap-fed guns without it (`4e0dd06`, `3ff16a6`), which is why the system is not
  urgent. **User call, 25 Aug 2026: no decision on ammo for now.** The one entry
  worth keeping is `19-watchlist.md`; the cook-off liability at 180°C and the
  `sacrificial-casing` modifier are live today and stay.
- **Manual four-verb order UI** beyond the live-battle controls, **turret mounts**,
  irregular L/T/S part shapes, the RogueTech-style soft heat-penalty ramp,
  physics/IK presentation, async PvP.
- **The retry economy** (`15` §7). Whether a lost fight strips parts permanently,
  whether a node should be re-attemptable in that state, and whether the retry
  should face a fresh opponent are three separable calls, still unmade.
  `scripts/starter-odds.mjs` re-measures a first fight in isolation.

## 7. Ideas worth mining (captured, undecided)

- **RogueTech heat-escalation ladder** — soft penalties ramping before the 130°C
  cliff. Candidate 02 change; weigh against sim readability.
- **"The workshop never lies"** — positioning line: our stats are measurements from
  the real sim, not a refit screen's guesses. Keep for a store page.
- **Quirked-part identity on enemies** — elites built *with* quirked parts so intel
  telegraphs inherited quirks (04 §4/§5).
- Open questions tracked in the specs themselves: 01 §11, 02 §7, 03 §10, 04 §9,
  plus mount minimums (02 §2).

## 8. Commands

```bash
npm install
npm run web:dev            # or use the pm2 service: mechbattler-dev on :5160
npm run verify             # tests, builds, audits, and the report-only balance rails
```

| Command | What it does |
|---|---|
| `npm run sim:test` / `game:test` / `web:test` | Unit and behaviour tests |
| `npm run game:audit` | Content validity — impossible content, unreachable unlocks. **Hard gate.** |
| `npm run game:balance` / `game:match-balance` | Run reach and economy / isolated fight balance. Report-only; `--strict` to gate. |
| `npm run game:loop` / `game:loop-report` | The one-hour progression cohort and its report |
| `npm run sim:balance` / `sim:adapt` / `sim:diversity` / `sim:hitrate` | Roster round-robin, fitting-only adaptation search, build-diversity stress, hit-rate calibration. Report-only. |
| `npm run balance:collect` then `balance:report` | Artifacts, then the diff against the baseline |
| `npm run web:shot` / `web:audit` / `web:campaign` | Drive a screen, audit seven screens, drive a whole campaign node |

Balance harnesses do not fail a build. `game:audit` does.
