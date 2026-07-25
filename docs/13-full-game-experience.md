# 13 — Full Game Experience

Status: implemented on `codex/full-game-experience` (Jul 25 2026). This document is the
authoritative application-level contract. The battle simulation remains governed by
specs 01–03.

## 1. Player flow

The default route is the game, not the tuning tool:

`Title → Garage → Load/create mech → Starting refit → Node intel → Battle → Report → Settlement → Salvage → Mod milestone → Refit`

The title screen also exposes Profile & Unlocks, the free-play Workshop Sandbox, and the
Balance Lab. `?view=workshop` and `?view=balance` remain direct links. Sandbox edits are
disabled while a persistent run build is loaded.

A run has 12 seeded nodes. A core kill ends it. Other losses retain player damage and
leave the current node available for another attempt. Chassis cannot change after launch.

## 2. State and transaction order

`@mechbattler/game` owns the headless, versioned application domain:

- `RunInstance`: seed/id, phase, node, wallet, wins/battles, mech, bench, pending salvage,
  pending mod service, generated node choices, earned progression, and a compact event log.
- `MatchInstance`: one immutable player/opponent build snapshot, battle seed, round depth,
  attempt, lifecycle (`ready → resolved → settled`), and its own `BattleReport`. Matches
  are stored and analyzed separately from the run that spawned them.
- `RunCheckpoint`: a versioned deep-cloned run/profile save at a stable between-round
  boundary. Its content version and round depth make it a reusable automation fixture.
- `MechInstance`: chassis plus installed `PartInstance` placements and power priority.
- `PartInstance`: stable id, catalog id, integrity, modifiers, variant, and provenance.
- `PlayerProfile`: starting-part/chassis unlocks, completed challenges, grandfathered
  legacy unlocks, reusable saved-mech blueprints, and memorial history.

React/localStorage are adapters. Battles receive a normal sim `Build`; their
`BattleReport` is settled back into the run. Settlement always happens before rewards:

1. Apply `partsFinalHp` to installed instances and remove destroyed parts.
2. On a core loss, end the run. On other losses, return to refit without rewards.
3. On a win, evaluate challenges/chassis discovery and show the enemy wreck.
4. Bank the purse, move selected intact parts to the bench, and scrap everything else.
5. After wins 3/6/9, resolve or skip one seeded machinist service.
6. Advance to the next node and persist schema v2.

Core/chassis damage resets between encounters unless the core was destroyed; equipment
integrity persists. Before every next fight—including after a non-core loss—the repair
bay can spend run scrap on installed or benched equipment, either one part at a time or
as a full repair. Reloading preserves active/prep/over runs, including an unresolved
wreck or mod service. Opponents and both versions of scrapyard stock are generated once
and saved verbatim, so later content-generator changes cannot rewrite an existing run.
Legacy run/profile/history records migrate forward, stable bench ids are synthesized
deterministically, and existing unlocks are never revoked.

### Garage and saved mechs

New Run opens the profile garage, not a starter-kit/chassis catalog. It shows only saved
mechs and owned chassis. Loading a saved mech enters the normal prep workshop before
launch; creating one starts from an empty owned chassis. Prep may add only unlocked
starting equipment and can save the current layout under a 40-character name. Saving
overwrites the loaded blueprint or creates a new stable profile entry.

Saved mechs are reusable blueprints rather than physical run inventory. Saving normalizes
every part to pristine integrity and removes run-only variants and modifications. Loading
therefore never carries damage, salvage, or mods between runs. A fresh/migrated profile is
seeded with the first legal data-driven starter as its initial saved mech. The former
duplicate starter/frame picker inside the Sandbox has been removed.

### Match and checkpoint invariants

A match never owns or mutates a `RunInstance`. Creating one snapshots both builds and the
scouted arena seed. Resolving it produces a report; settling it is a separate command that
accepts only the exact run id, node, event offset, and player build revision that created
the match. A resolved/settled match cannot award a purse twice.

Checkpoints can only be captured with no pending salvage or mod transaction. Restore
returns a deep clone, so branching hundreds of balance matches from one round-depth save
cannot mutate the fixture or each other. Pristine synthetic checkpoints isolate the
opponent difficulty curve; checkpoints captured from real runs include the actual
salvage, damage, scrap, and modifications at that depth.

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

Campaign equipment views never expose the unrestricted catalog. Prep lists only unlocked
starting equipment; an active run lists only equipment currently installed or on its
bench. A run may install only its current equipment, owned bench instances, or seeded
scrapyard purchases. Any enabled enemy part can be used as salvage even when it is locked
for future starting builds. The explicitly labeled Workshop Sandbox retains the complete
catalog for unrestricted testing.

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
battle summary. The initial saved-mech blueprint derives from the first starter whose
actual chassis and parts are owned; starter definitions remain balance/automation content
rather than a player-facing locked catalog. `U-AMMO` is explicitly disabled until
ammunition becomes a positive functional system.

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
npm run game:balance -- 1
npm run game:checkpoints -- 1
npm run game:match-balance -- 1
npm run web:test
```

`game:balance` advances deterministic runs with a documented baseline policy and reports
natural reach rate, scrap, integrity, part count, match win rate, core losses, duration,
and damage at configured round depths. `game:checkpoints` emits a reusable JSON corpus at
rounds 1/4/7/10/12. `game:match-balance` evaluates all single-match choices from that
corpus; pass a corpus filename instead of a seed count to analyze captured player states.
Both reports include stable digests and data-driven target-band warnings.

```bash
npm run game:checkpoints -- 4 > run-checkpoints.json
npm run game:match-balance -- run-checkpoints.json
```

The audit prints stable JSON containing the unlock graph, acquisition reachability,
starter/default-garage legality, economy/run dials, serialized challenge definitions, and
impossible or self-dependent diagnostics. It fails when content is missing, disabled
content leaks, an enabled part lacks exactly one starting unlock route, an acquisition
route is absent, a starter build is illegal, or a fresh profile cannot load a legal saved
mech. CI runs both game-level balance layers before the existing simulation, balance,
diversity, interaction-test, and production-build gates.
