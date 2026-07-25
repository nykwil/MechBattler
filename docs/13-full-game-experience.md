# 13 — Full Game Experience

Status: implemented on `codex/full-game-experience` (Jul 25 2026). This document is the
authoritative application-level contract. The battle simulation remains governed by
specs 01–03.

## 1. Player flow

The default route is the game, not the tuning tool:

`Title → New/Continue → Starting loadout → Node intel → Battle → Report → Settlement → Salvage → Mod milestone → Refit`

The title screen also exposes Profile & Unlocks, the free-play Workshop Sandbox, and the
Balance Lab. `?view=workshop` and `?view=balance` remain direct links. Sandbox edits are
disabled while a persistent run build is loaded.

A run has 12 seeded nodes. A core kill ends it. Other losses retain player damage and
leave the current node available for another attempt. Chassis cannot change after launch.

## 2. State and transaction order

`@mechbattler/game` owns the headless, versioned application domain:

- `RunInstance`: seed/id, phase, node, wallet, wins/battles, mech, bench, pending salvage,
  pending mod service, generated node choices, earned progression, and a compact event log.
- `MechInstance`: chassis plus installed `PartInstance` placements and power priority.
- `PartInstance`: stable id, catalog id, integrity, modifiers, variant, and provenance.
- `PlayerProfile`: starting-part/chassis unlocks, completed challenges, grandfathered
  legacy unlocks, and memorial history.

React/localStorage are adapters. Battles receive a normal sim `Build`; their
`BattleReport` is settled back into the run. Settlement always happens before rewards:

1. Apply `partsFinalHp` to installed instances and remove destroyed parts.
2. On a core loss, end the run. On other losses, return to refit without rewards.
3. On a win, evaluate challenges/chassis discovery and show the enemy wreck.
4. Bank the purse, move selected intact parts to the bench, and scrap everything else.
5. After wins 3/6/9, resolve or skip one seeded machinist service.
6. Advance to the next node and persist schema v2.

Core/chassis damage resets between encounters unless the core was destroyed; equipment
integrity persists. Reloading preserves active/prep/over runs, including an unresolved
wreck or mod service. Opponents and both versions of scrapyard stock are generated once
and saved verbatim, so later content-generator changes cannot rewrite an existing run.
Legacy run/profile/history records migrate forward, stable bench ids are synthesized
deterministically, and existing unlocks are never revoked.

## 3. Economy and acquisition

Scrap is run-only. Defaults live in `GAME_CONTENT`, not UI components:

| Rule | Default |
|---|---:|
| Starting scrap | 30 |
| Victory purse | `20 + 5 × node` |
| Elite purse | `×1.5` |
| Destroyed wreck scrap | `tier × 4` |
| Intact unselected wreck scrap | `round(tier × 8 × integrity)` |
| Owned-part scrap | `round(tier × 8 × integrity)` |
| Scrapyard price | `ceil(tier × 12 × integrity)` |
| Repair | `ceil(points × tier × 0.4)` |
| Machinist application | 25 |
| Bench cap | 8 instances |

The active-run catalog is reference-only. A run may install only its current equipment,
owned bench instances, or seeded scrapyard purchases. Any enabled enemy part can be used
as salvage even when it is locked for future starting builds.

Machinist services occur every three victories, currently wins 3, 6, and 9. Each contains
three seeded offers, permits one permanent mod on an applicable installed or benched
instance, and may be skipped. Mods never become profile unlocks.

## 4. Progression

Fresh profiles start with CH-2 and:
`R-E25`, `W-MG`, `W-CB`, `U-CON`, `U-PIPE`, `U-RAD`, `U-ARM`.

Chassis unlock by defeating that frame. Part blueprints unlock through declarative combat
challenges and affect starting loadouts only:

| Challenge | Requirement | Unlocks |
|---|---|---|
| First Blood | Win | `R-C40`, `W-AC`, `U-HS` |
| Clean Machine | Win with no installed part lost | `U-TC1`, `W-LAS` |
| Blitz | Win in ≤30 s with no part lost | `U-ACT` |
| Dismantler | Destroy ≥4 non-wiring enemy parts in a win | `W-RKT`, `W-BR` |
| Redline | Win after reaching ≥115 °C | `R-C90`, `W-SC` |
| Brownout Survivor | Win after ≥3 player shed transitions | `R-E60`, `P-CAP` |
| Heavy Hitter | Deal ≥150 damage in a win | `P-CAP2`, `W-RG` |
| Counterbattery | Win vs. a capacitor build and destroy a capacitor | `W-ION` |

Every challenge is an `all`/`any` tree of serializable predicates evaluated from the
battle summary. Starter-kit availability derives from the kit's actual chassis and parts.
`U-AMMO` is explicitly disabled until ammunition becomes a positive functional system.

## 5. Data-driven iteration and verification

`GAME_CONTENT` is the single iteration surface for economy, run length, enabled content,
starting access, enemy fill/shop eligibility, starter kits, challenge criteria/rewards,
and mod cadence. The canonical simulation generator keeps its original cohort defaults;
game runs inject the tagged game-content pool. Seed-derived opponent, scrapyard, salvage,
and mod choices remain deterministic.

Run:

```bash
npm run game:audit
npm run game:test
npm run web:test
```

The audit prints stable JSON containing the unlock graph, acquisition reachability,
starter legality, economy/run dials, serialized challenge definitions, and impossible or
self-dependent diagnostics. It fails when content is missing, disabled content leaks, an
enabled part lacks exactly one starting unlock route, an acquisition route is absent, or
a starter build is illegal. CI runs these checks before the existing simulation, balance,
diversity, interaction-test, and production-build gates.
