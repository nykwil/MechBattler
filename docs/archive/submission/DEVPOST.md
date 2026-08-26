# Devpost submission copy

## Project name

MechBattler Balance Lab

## Tagline

Codex turns deterministic game simulations into explainable, evidence-backed content tuning.

## Category

Developer Tools

## Links

- Live project: https://nykwil.github.io/MechBattler/
- Public repository: https://github.com/nykwil/MechBattler

## Inspiration

Game balance is often driven by intuition, spreadsheets, and expensive manual playtests. Even when a team has telemetry, a win-rate number rarely explains what should change—or whether the problem is a stat, a loadout, an AI behavior, or a foundational rule. We wanted Codex to work like a systems-design collaborator: run controlled experiments, read the failures, make constrained changes, and prove what improved.

## What it does

MechBattler Balance Lab runs every canonical game archetype against every other archetype through the same deterministic engine used by the playable game. It alternates spawn sides, repeats matchups over seeded cohorts, and turns the results into:

- Roster standings with content-budget context
- A 35–65% matchup health guardrail
- Global dominance warnings above 70%
- Ranked, explainable tuning findings
- A full matchup matrix
- Downloadable JSON evidence
- A deterministic perk/control stress harness for dead conditions, dominant combinations, copy loops, and chassis-specific abuse

The companion Workshop lets judges see the systems being measured: place physical components on a mech chassis, route their power, manage brownout priority and heat, test the build, then watch or command it in combat.

## How we built it

The project is a TypeScript monorepo. `packages/sim` is a pure deterministic simulation covering chassis geometry, physical power networks, thermal conduction, weapon cycles, terrain, AI doctrine, damage, salvage, seeded RNG, lockstep orders, and replay verification. `apps/web` is a React/Vite interface for the workshop, arena, run loop, and Balance Lab.

The UI, CLI, tests, and game all call the same simulation and analysis functions. A tuning result is therefore reproducible outside the demo and can become a CI gate.

## How we used Codex and GPT-5.6

We collaborated with Codex using GPT-5.6 throughout Build Week. The human role set product principles and made the high-level design calls: protect physical routing and brownout priority, preserve archetype identity, diagnose before tuning, and change content before global rules. Codex translated the specifications into a working simulation and product, built the batch harness and test suite, analyzed battle telemetry, implemented constrained experiments, and reran identical cohorts to validate each pass.

The frozen pre-final roster reproduced at 6 / 28 healthy matchups, a 40-point spread, and no build above 70%. Codex then diagnosed the 29% Mule Skirmisher from battle telemetry: it was not overheating or browning out; it was losing both short-range guns before completing its approach. One plate was too small, a radiator addressed the wrong failure, a rocket reduced matchup health, and plates plus cooling crossed a locomotion power threshold and fired zero shots. The accepted fitting-only change added two front plates without touching the twin-MG kernel or global rules. On the final identical 280-battle cohort, Mule reached 50%, healthy matchups rose to 8 / 28, and spread narrowed to 37 points. Bastion stayed an intentional 29% specialist with 100–0 wins over both sniper kernels.

We then reframed the final pass around build diversity instead of equalized damage. Each chassis now has at least two represented identities. Four costly conditional perk builds—Cold Bore Vulture, Fever Cycle Mule, gyrostabilized Widow gunship, and Hull-down Bastion bunker—joined the deterministic harness. The fixed 5-seed stress ran 12 builds through 330 battles, plus matched perk/control cohorts against every canonical opponent. No perk build exceeded 70%; all four perks improved at least one matchup by 20–40 points without becoming automatic aggregate upgrades. The harness rejected duplicate Fever stacking, an unreachable 60°C threshold, a cooling-strip overcorrection, and empty-frame Bastion silhouette abuse. The canonical 280-battle result remained unchanged.

The dated repository history distinguishes Build Week work, and the submission includes the `/feedback` session ID for the primary Codex task.

## Challenges

The hardest problem was keeping results explainable. A global stat change can make aggregate win rates look better while silently erasing an archetype. We therefore separated identity “kernels” (chassis, weapons, reactors) from cheaper fitting changes, kept deterministic seeds, compared each perk with its control across the complete opponent set, and recorded failed experiments instead of presenting only final numbers.

Another challenge was determinism across a complex simulation. We added seeded randomness, deterministic math, versioned content hashes, lockstep state hashing, replay sealing, and dispute verification, all covered by automated tests.

## Accomplishments

- A complete playable build → fight → diagnose → refit loop
- A web-based 56/140/280-battle balance audit
- Shared explainable analysis across UI and CLI
- Evidence export and CI-compatible dominance failure
- A real content-tuning pass with telemetry, fitting-only search, and recorded rejected iterations
- A 330-battle build-diversity stress with four representative perk/control pairs
- 153 passing tests across 19 files
- Deterministic lockstep and replay-verification foundation

## What we learned

Balance is not one number. Overall standings can hide hard counters, unequal content budgets, and specialist designs. The most useful agent is not one that declares a game balanced; it is one that makes each assumption and failure reproducible enough for a designer to make the next decision.

## What's next

- Expose fitting-only adaptation directly from each flagged matrix cell
- Compare saved tuning snapshots directly in the web UI
- Attribute outcome changes to power, heat, range access, terrain, and damage lanes
- Add budget-matched cohorts and confidence intervals
- Package the workflow so other deterministic games can provide their own content adapter
