# MechBattler

**A phone-first roguelike about building a mech, losing, and reading why.**

**[Play the live build](https://nykwil.github.io/MechBattler/)** · **[Repository](https://github.com/nykwil/MechBattler)**

You get one mech and twelve nodes. Every part you bolt on is a physical object in a
grid: it has a footprint, a height, a mass, a heat output and a place in a power
network you route by hand. Fights resolve in a deterministic simulation you can
watch, command live, or skip straight to the report. Then you read the wreck —
which lane got penetrated, which gun browned out, which radiator could not keep up —
and refit. A destroyed core ends the run; the profile keeps what it unlocked.

The payoff is the diagnosis, not the spectacle.

## Try it

1. The title screen opens the **garage**. Load a saved mech, or build one from the
   parts your profile has unlocked, then launch a run.
2. Pick a node from its intel card. **Fight · Live** gives you tactical pause and
   manual control over the autopilot; **Watch** resolves it headless and replays it.
3. Read the report: per-part damage both ways, the event timeline, and the replay
   with its cockpit HUD. Take salvage, repair, refit, next node.
4. **Workshop Sandbox** is free building against a test bench with the full catalog.
5. **Balance Lab** runs the tuning workflow below in the browser and exports JSON.

No account, API key, or installation is needed for the live build.

## What is underneath

- **One deterministic simulation.** The game, the test bench, the live battle, the
  replay and every balance harness share one pure TypeScript sim. Seeded PCG32, no
  wall-clock, no `Math.random`, deterministic transcendentals — a battle replays
  bit-identical on two JS engines, which is also the multiplayer foundation.
- **Physical construction, not a stat sheet.** Regional grids joined by ports, bus
  and heat-pipe routing layers, equipment stacking, sealed armour that traps heat,
  per-cell height ceilings, and forward clearance so a gun cannot fire through its
  own hull. Location zones give a shoulder mount its extra arc.
- **Power and heat are the real limits.** Cell-level power networks, brownout
  shedding against a priority list you set, per-cell heat conduction, radiators,
  ram-air cooling, cook-off, shutdown.
- **Stat-based shot resolution.** P(hit) from dispersion, range, target profile and
  lateral speed × (tracking lag + time of flight). No flight simulation; drawn
  tracers are presentation over the event log.
- **Nothing on screen is retyped.** Every figure the interface shows is read from
  the sim. Instruments that hardcoded a constant the sim computes are a documented,
  repeatedly-caught class of bug here.

## The Balance Lab

Content tuning is normally hunches and spreadsheets. Here it is reproducible
evidence: seeded cohorts, ranked findings, exported JSON.

```bash
npm run balance:collect    # both harnesses -> artifacts/*.json  (~4 min)
npm run balance:report     # artifacts/balance-report.md, diffed against the baseline
```

The harnesses are **report-only by design** — balance is worked on as its own pass
and does not gate feature work, so a swing shows up as a changed file in review
rather than a red build. `--strict` restores the gate when you are deliberately
balancing. `npm run game:audit` stays hard: it checks content *validity*
(impossible content, unreachable unlocks), not balance.

What they measure: `sim:balance` the roster round-robin from both spawn sides,
`sim:adapt` whether a bad matchup is recoverable by fitting alone, `sim:diversity`
whether coherent builds stay distinct (dead perks, dominant combinations, copy
loops), `game:balance` how deep a real run actually reaches and what it earns, and
`game:match-balance` isolated fight balance from pristine or captured checkpoints.

Balance is honestly mid-pass, and the record says so rather than the README
claiming a clean bill: `docs/17-balance-findings.md` F1 is an open regression with
a bisected cause, and `docs/19-watchlist.md` lists what is deliberately being
watched.

## Run locally

Node.js 20+ and npm.

```bash
npm install
npm run web:dev            # the app
npm run verify             # tests, builds, audits and the report-only balance rails
```

572 tests pass today: 336 simulation, 205 web, 24 game domain, 7 prototype.

Individual pieces:

```bash
npm run sim:test  game:test  web:test        # tests
npm run game:audit                            # content validity (hard gate)
npm run game:loop -- --seeds 1 --battles 8    # progression cohort
npm run sim:balance -- 10                     # roster round robin
npm run sim:diversity -- 5                    # build-diversity stress
```

The interface is a phone design. To look at it without a phone:

```bash
npm run web:shot -- 'http://localhost:5160/?view=workshop' /tmp/shot.png --w 390 --h 844
npm run web:audit          # seven screens against the invariants that have broken before
npm run web:campaign       # drives one whole campaign node end to end
```

`scripts/drive.mjs` drives Chrome over the DevTools Protocol: a true phone viewport
(which `--window-size` cannot give, having a 500px floor), repeatable
`--tap`/`--tapText`/`--key`, and `--eval` for measurements. `?view=` reaches any
surface directly — `workshop`, `battle`, `report`, `salvage`, `balance`.

## Repository map

```text
apps/web/                 React + Vite: shell, workshop, battle, replay, run, Balance Lab
apps/physics-prototype/   Standalone React Three Fiber IK and payload-physics lab
packages/sim/             The deterministic simulation and its analysis harnesses
packages/game/            Persistent run, match, profile and content domain
scripts/drive.mjs         CDP driver for screenshotting and driving the app
docs/                     Design specs, status, balance findings, watchlist
docs/prototypes/          The recovered mobile UX prototypes — the design source of truth
docs/archive/             Finished plans, historical records, Build Week submission
```

Start with `docs/07-status-and-handoff.md`; `CLAUDE.md` carries the working rules.

## Origins

The simulation, workshop and the Balance Lab workflow were built during the OpenAI
Build Week submission period (July 2026) with Codex, and the evidence from that
pass — including the 280-battle before/after tuning report — is preserved in
[`docs/archive/submission/`](docs/archive/submission/TUNING-REPORT.md). The game has
moved on considerably since: the run structure, the mobile port, spatial
construction and component height all came after.

## License

MIT. See [LICENSE](LICENSE).
