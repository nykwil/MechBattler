# MechBattler Balance Lab

**An explainable, deterministic game-content tuning workflow built with Codex and GPT-5.6.**

**[Try the live Balance Lab](https://nykwil.github.io/MechBattler/)** · **[View the public repository](https://github.com/nykwil/MechBattler)**

Game balance is usually a loop of hunches, spreadsheets, slow playtests, and changes that are hard to explain. MechBattler Balance Lab turns that loop into reproducible evidence: it runs seeded combat cohorts, identifies dominant content and hard counters, produces a ranked tuning brief, and exports the underlying results.

The included mech-building game is the proving ground. Every weapon, chassis, power network, heat system, AI doctrine, and terrain interaction runs through the same pure TypeScript simulation used by the player-facing game.

## What judges can try

1. Open the web app and choose **Balance Lab**.
2. Run the 56-battle quick audit or increase the cohort to 140/280 battles.
3. Inspect roster standings, the 35–65% matchup guardrail, dominant-build warnings, and ranked tuning recommendations.
4. Export the complete report as JSON.
5. Return to **Workshop** to build a mech, test its power and thermal behavior, then watch or command it in the arena.

No account, API key, installation, or sample data is required for the live demo.

## Measured diversity result

The final pass stopped chasing equal damage numbers and tested whether coherent builds create distinct choices. Four representative perk builds were added beside the eight canonical archetypes and run through a fixed 5-seed, 330-battle round robin. Each perk was also compared with its unmodified control against every canonical opponent on the same seeds.

| Diversity guardrail | Final evidence |
|---|---:|
| Chassis with at least two coherent identities | 4 / 4 |
| Perks with a positive matchup niche | 4 / 4 |
| Perk builds above 70% overall | 0 |
| Dead perks in the representative cohort | 0 |
| Vulture free cells after coherent fittings | 2–4 |

The accepted perks are conditional trades, not flat upgrades: Cold Bore exchanges 10% damage for overcooled accuracy; Fever Cycle pays 25% more draw to accelerate above 50°C; Gyrostabilized adds 25% weapon mass to reduce movement jitter; Hull-down adds a powered two-cell Stride and mass for a smaller stationary profile. Their aggregate control deltas range from −7 to +3 points, but each earns a +20 or +40 point matchup niche. One Fever per build and one mod per part are enforced to block automatic stacking loops.

The original 280-battle stock audit remains a safety rail and reproduces unchanged: 0 builds above 70%, 8 / 28 healthy matchups, 37-point spread, Mule Skirmisher 50%, and specialist Bastion 29%. Arbitrary legal layouts are not promised viability.

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

Run the headless workflow directly:

```bash
npm run sim:balance -- 10
npm run sim:adapt -- 10
npm run sim:diversity -- 5
```

The balance command runs every pair from both spawn sides. It exits non-zero when the 70% dominance guardrail fires, making the same workflow usable in CI.

## Verification

```bash
npm run sim:test
npm run sim:build
npm run sim:balance -- 10
npm run sim:diversity -- 5
npm run web:build
```

Current verified state: **153 tests passing across 19 files**, clean simulation build, unchanged canonical 280-battle safety rail, passing 330-battle diversity stress, and clean Vite production build.

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
packages/sim/src/         Deterministic simulation and analysis library
packages/sim/scripts/     Balance, adaptation, and matchup CLI workflows
packages/sim/test/        153 behavioral and determinism tests
docs/                     Product and simulation design specifications
docs/submission/          Tuning evidence, demo script, and Devpost copy
```

## License

MIT. See [LICENSE](LICENSE).
