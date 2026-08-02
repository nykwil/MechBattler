# MechBattler Balance Lab

**An explainable, deterministic game-content tuning workflow built with Codex and GPT-5.6.**

**[Try the live Balance Lab](https://nykwil.github.io/MechBattler/)** · **[View the public repository](https://github.com/nykwil/MechBattler)**

Game balance is usually a loop of hunches, spreadsheets, slow playtests, and changes that are hard to explain. MechBattler Balance Lab turns that loop into reproducible evidence: it runs seeded combat cohorts, identifies dominant content and hard counters, produces a ranked tuning brief, and exports the underlying results.

The included mech-building game is the proving ground. Every weapon, chassis, power network, heat system, AI doctrine, and terrain interaction runs through the same pure TypeScript simulation used by the player-facing game.

## What judges can try

1. Open the web app to the game-first title screen; load a saved mech from the garage or continue an active run.
2. Run the 56-battle quick audit or increase the cohort to 140/280 battles.
3. Inspect roster standings, the 35–65% matchup guardrail, dominant-build warnings, and ranked tuning recommendations.
4. Export the complete report as JSON.
5. Use **Workshop Sandbox** for free building, or play the persistent salvage run with
   combat-challenge unlocks and milestone modifications.

No account, API key, installation, or sample data is required for the live demo.

## Measured diversity result

The current pass tests whether coherent builds create distinct choices across the
three active regional chassis. Four representative perk builds sit beside seven
canonical archetypes in a fixed 5-seed, 275-battle round robin. Each perk is also
compared with its unmodified control against every canonical opponent on the same seeds.

| Diversity guardrail | Final evidence |
|---|---:|
| Chassis with at least two coherent identities | 3 / 3 |
| Perks with a positive matchup niche | 4 / 4 |
| Perk builds above 70% overall | 0 |
| Dead perks in the representative cohort | 0 |
| Vulture free cells after coherent fittings | 5 |

The accepted perks are conditional trades, not flat upgrades: Cold Bore pays a
small always-on damage penalty for an overcooled opening; Fever Cycle pays 15%
more draw and needs a deliberate heat ramp; Gyrostabilized adds 15% weapon mass
to reduce movement jitter; Hull-down adds a powered two-cell Stride and 15% mass
for a smaller stationary profile. One Fever per build and one mod per part are
enforced to block automatic stacking loops.

The current 210-battle stock audit remains a separate safety rail: 0 builds above
70%, with Mule Gunline and Mule Laser Boat at 67%, and documented hard counters
still visible. Arbitrary legal layouts are not promised viability.

See [the complete tuning report](docs/submission/TUNING-REPORT.md).

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run web:dev
```

Open the printed local URL. For a production build:

```bash
npm run web:build
```

Run the standalone 3D locomotion and payload-physics experiment:

```bash
npm run prototype:dev
```

It is intentionally separate from the deployed game. The lab converts real mech builds,
part masses, placement, and weapon recoil into procedural biped/quad presentation without
changing the deterministic combat simulation.

Run the headless workflow directly:

```bash
npm run sim:balance -- 10
npm run sim:adapt -- 10
npm run sim:diversity -- 5
npm run game:loop -- --seeds 1 --battles 8
```

The balance command runs every canonical pair from both spawn sides. The
progression command runs real fight, salvage, repair, mod, scrapyard, and refit
decisions for fresh and one-hour profiles, with full JSON traces available via
`--json PATH`.

## Verification

```bash
npm run sim:test
npm run game:test
npm run game:audit
npm run game:balance -- 1
npm run game:match-balance -- 1
npm run game:loop -- --seeds 1 --battles 8
npm run sim:build
npm run sim:balance -- 10
npm run sim:diversity -- 5
npm run web:build
npm run web:test
npm run prototype:test
npm run prototype:build
```

Current verification covers **394 tests** (26 game, 199 simulation, 162 web, 7
prototype), deterministic run-depth and checkpoint-match reports, the canonical
210-battle balance rail, the 275-battle perk diversity gate, a 128-battle
progression cohort, production builds, mobile screen audit, and campaign smoke.

The workshop and battle interfaces are the mobile design, ported from the prototypes in
`docs/prototypes/`. To look at them:

```bash
npm run web:shot -- 'http://localhost:5160/?view=workshop' /tmp/shot.png --w 390 --h 844
```

`scripts/drive.mjs` drives Chrome over the DevTools Protocol: a true phone viewport (which
`--window-size` cannot give, having a 500px floor), repeatable `--tap`/`--tapText`/`--key`, and
`--eval` for measurements. `?view=` reaches any surface directly — `workshop`, `battle`,
`report`, `salvage`, `balance`.

## How it works

- **One deterministic engine:** the game, test bench, live battle, replay, balance harness, and adaptation search share a pure TypeScript simulation.
- **Seeded cohort testing:** every matchup runs from alternating spawn sides over the same seed set; rerunning identical content produces an identical verdict.
- **Build-diversity stress:** representative perk/control pairs expose dead conditions, dominant combinations, copy loops, and chassis-specific abuse before rare content ships.
- **Explainable guardrails:** the tool flags overall win rates above 70%, stock matchups outside 35–65%, weak archetype kernels, and budget context.
- **Actionable diagnosis:** findings point designers toward content/loadout changes or fitting-only adaptation before suggesting global rule changes.
- **Evidence export:** the web workflow exports the complete report and derived brief as JSON.
- **Deterministic multiplayer foundation:** state hashing, versioned simulation content, tick-stamped orders, sealed replays, and dispute verification are already tested.

## Codex + GPT-5.6 collaboration

This project was built during the OpenAI Build Week submission period with Codex using GPT-5.6. The collaboration was deliberately split between human product judgment and agentic execution.

The human-directed decisions included:

- Protect physical power/coolant routing and player-set brownout priority as the core mechanics.
- Treat diagnosis and refitting—not spectacle—as the payoff loop.
- Preserve archetype identity and tune content before rewriting global combat rules.
- Deliberately defer the broad tuning pass, then make that evidence-driven workflow the submission itself.
- Reject “perfect balance” as a misleading goal; surface remaining failures honestly.

Codex accelerated:

- Turning interconnected design documents into the deterministic simulation, React workshop, arena, run structure, and test suite.
- Building batch balance, adaptation-search, replay-verification, and content diagnostics tooling.
- Reading battle telemetry to isolate power starvation, heat collapse, range-access, and loadout-kernel failures.
- Implementing and testing constrained tuning changes, then rerunning identical cohorts for before/after evidence.
- Rejecting empty-frame silhouette abuse, unreachable heat thresholds, and cooling-strip overcorrections from battle-level telemetry.
- Building the judge-facing Balance Lab and preparing reproducible submission materials.

The dated Git history distinguishes work completed after the July 13 submission-period start. The `/feedback` Codex session ID for the primary build task is supplied in the Devpost entry.

## Repository map

```text
apps/web/                 React + Vite workshop, battles, and Balance Lab
docs/prototypes/          Recovered mobile UX prototypes; the design source of truth
scripts/drive.mjs         CDP driver for screenshotting and driving the app
apps/physics-prototype/   Standalone React Three Fiber IK and payload-physics lab
packages/game/            Persistent run, profile, saved-mech, and balance domain
packages/sim/src/         Deterministic simulation and analysis library
packages/sim/scripts/     Balance, adaptation, and matchup CLI workflows
packages/sim/test/        160 behavioral and determinism tests
docs/                     Product and simulation design specifications
docs/submission/          Tuning evidence, demo script, and Devpost copy
```

## License

MIT. See [LICENSE](LICENSE).
