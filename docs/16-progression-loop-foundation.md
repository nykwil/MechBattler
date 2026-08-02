# Progression loop foundation

The balancing target is the experience after roughly one hour, represented by
eight resolved battles. A defeat still ends the current run; the headless loop
starts a new run with persistent profile unlocks until the cohort has observed
eight battle outcomes. This makes losses visible without letting a short run
truncate the progression measurement.

## Two profiles, two questions

- `fresh` starts with the Mule Skirmisher, the seven initial parts, and no
  challenge progress. It measures what the shipped unlock rules actually
  produce. It never grants the target fixture to make a report pass.
- `one-hour` is an explicit design fixture: Vulture, Mule, Bastion and the
  15-part target pool are unlocked. Its nine saved probe mechs cover three
  distinct directions for each chassis. It measures whether the intended pool
  can already support differentiated growth.

The target pool is `R-E25`, `W-MG`, `W-CB`, `U-CON`, `U-PIPE`, `U-RAD`,
`U-ARM`, `R-C40`, `W-AC`, `U-HS`, `U-TUR`, `U-SHELL`, `U-TC1`, `W-LAS`, and
`U-ACT`.

## Deterministic policies

`survival`, `range`, `thermal`, and `armor` policies rank opponents using only
the threat, headline, confirmed parts, and carried-mod facts visible before a
battle. They do not simulate every opponent and select the winning result.
After a victory they rank real salvage, pay for repairs and applicable mod
services, and attempt a legal refit using owned part instances. Scrapyard
decisions use the same policy score.

Every whole-build refit is atomic. The proposed regional placement and routes
must pass authoritative sim validation before run state changes. Integrity,
variants, modifiers, and provenance come from run inventory rather than from
the proposed build, so tooling cannot repair or duplicate an item accidentally.

## Build fingerprints and traces

Each battle records before/after fingerprints containing weapon family and
IDs, range band, burst DPS, power supply/demand/margin, heat input/cooling/
margin, mass/load/speed, armor and protected-payload counts, active location
effects, and installed modifiers. The trace also records the chosen opponent,
the visible facts used, unlock gains, reward decisions, and refits.

Run the default full audit with:

```bash
npm run game:loop -- --seeds 1 --battles 8
```

Useful focused forms:

```bash
npm run game:loop -- --profile fresh --policy survival --seeds 5
npm run game:loop -- --profile one-hour --policy range --seeds 73001,74001
npm run game:loop -- --json artifacts/progression-loop.json
```

The CLI exits nonzero for broken trace/loop invariants and reports target gaps
as data. On the first seed-73001 baseline, the full 128-battle audit made 45
reward decisions and 25 successful refits. The combined fresh cohort reached
all 15 target parts but not Bastion. That is the next unlock-curve balancing
question, not a reason to weaken the instrumentation.

## Iteration loop

1. Change content, economy, unlock criteria, chassis, parts, opponents, or sim
   rules as needed for the target experience.
2. Run focused fresh and one-hour cohorts and inspect battle traces, not only
   aggregate win rates.
3. Compare fingerprints to ensure a starting mech can branch and that different
   chassis do not converge on the same primary weapon, range, power, heat,
   protection, and location-effect profile.
4. Re-run `npm run verify`, the campaign smoke, production/mobile audits, and
   visual workshop inspection before accepting a player-facing pass.
