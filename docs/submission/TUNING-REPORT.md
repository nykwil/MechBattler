# Build Week tuning report

## Experiment

- Cohort: 8 canonical archetypes, every unordered pair, 10 deterministic seeds per pair.
- Total: 280 battles per pass.
- Controls: base seed 1, alternating spawn sides, identical engine and global combat rules.
- Guardrails: no build above 70% overall; stock matchup target 35–65%.
- Scope: roster content only. No global combat constants were changed for this pass.

## Baseline

Recorded before the content changes on July 21, 2026.

| Standing | Win rate | Tier budget |
|---|---:|---:|
| Vulture Skirmisher | 76% | 10 |
| Mule Gunline | 69% | 8 |
| Vulture Sniper | 69% | 8 |
| Mule Laser Boat | 47% | 14 |
| Railgun Mule | 44% | 21 |
| Mule Skirmisher | 43% | 7 |
| Bastion Tank | 29% | 29 |
| Widow Orbiter | 24% | 6 |

The baseline fired one global dominance flag, had four matchups inside the target band, and a 52-point roster spread. The clearest content problems were a scout that won both at range and up close, plus an orbiter with no way to establish its game plan before entering machine-gun range.

## Iteration 1: deliberately too large

Codex first tested the strength of the levers:

- Removed the Vulture Skirmisher's close-range machine gun.
- Added a carbine to the Widow while retaining both machine guns.

At five seeds per pair, those changes inverted the problem: Vulture fell to 20% while Widow rose to 71%. The workflow rejected the pass. This failed iteration was useful evidence that the selected levers were causal, but too coarse.

## Accepted pass

- **Vulture Skirmisher:** restored the machine gun and removed one armor plate. It keeps its hybrid range identity but is punishable after losing its spacing advantage. Budget 10 → 9.
- **Widow Orbiter:** replaced one machine gun with a carbine and added the conduit needed to route power. It can establish an orbiting game plan without stacking a third weapon. Budget 6 → 8.

## Result

| Guardrail | Baseline | Accepted pass | Delta |
|---|---:|---:|---:|
| Global dominance flags | 1 | 0 | −1 |
| Healthy matchups | 4 / 28 | 6 / 28 | +2 |
| Roster spread | 52 points | 40 points | −12 |
| Vulture Skirmisher | 76% | 69% | −7 |
| Widow Orbiter | 24% | 64% | +40 |

Accepted-pass standings:

| Standing | Win rate | Tier budget |
|---|---:|---:|
| Vulture Skirmisher | 69% | 9 |
| Mule Gunline | 64% | 8 |
| Widow Orbiter | 64% | 8 |
| Vulture Sniper | 63% | 8 |
| Railgun Mule | 47% | 21 |
| Mule Laser Boat | 36% | 14 |
| Mule Skirmisher | 29% | 7 |
| Bastion Tank | 29% | 29 |

## Remaining findings

The pass clears roster-level dominance but does not hide matchup polarization. Bastion remains a deliberate specialist; Mule Skirmisher now needs a kernel/adaptation investigation; and several 0–100 matchups remain outside the 35–65% band. The next workflow step is fitting-only adaptation search: if legal refits cannot recover those matchups, tune the losing kernel rather than flattening global combat rules.

## Reproduce

```bash
npm install
npm run sim:balance -- 10
```

Expected headline: 280 battles, no `>70%` flag, Vulture Skirmisher 69%, Widow Orbiter 64%.
