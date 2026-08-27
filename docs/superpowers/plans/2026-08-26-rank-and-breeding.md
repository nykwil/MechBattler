# Rank and Breeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rank a single number that counts mods as well as parts, then build a tool that breeds the strongest mech at each rank on each chassis so the three content invariants (rank monotonicity, chassis parity, no dead gear) can pass or fail with numbers.

**Architecture:** `computeRank` becomes the one rank function in `packages/sim/src/rank.ts`, and `ModifierDef.tier` becomes the one authored number on a mod (draw weight, machinist price and rank contribution all derive from it). A tier-laddered search evolves *wishes* — the input `assembleBuild` already takes — so `assembleBuild` is the developmental step and illegal genomes cannot exist. Rank `R` warm-starts from rank `R−1`'s archive; the archive is a 3×3 range×weight grid per chassis, two elites per cell. Fitness is a win rate against a frozen reference panel, rationed in two tiers (screen on 3 opponents × 1 seed, confirm elites on the full panel).

**Tech Stack:** TypeScript ESM, vitest, `node --import tsx` for scripts, `node:worker_threads` for parallelism, the existing seeded `Pcg32`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-26-rank-and-breeding-design.md` — read it before Task 1. Every task below argues from a numbered section of it.

## Global Constraints

- **Determinism (`docs/11` §3) is a hard contract.** Seeded `Pcg32` only. No `Math.random`, no `Date.now` inside anything the sim reaches. Deterministic transcendentals via `dmath.ts`. Every battle seed derives from the candidate itself, never from the order it was evaluated (spec §3e).
- **Never copy sim constants into UI or instrument code** (CLAUDE.md). Every number a report prints is read from the sim or derived from frames and events.
- **`packages/sim` may not import `packages/game`.** The dependency runs one way (`@mechbattler/game` depends on `@mechbattler/sim`). Two spec details move because of this; see Deviations below.
- **Balance harnesses are report-only.** Nothing added here may fail a build. `game:audit` stays the hard gate and checks content validity, not balance.
- **Thresholds are provisional** (spec §2): I1 ≥ **0.75** at +2 ranks and ≥ **0.60** at +1; I2 ≤ **8** percentage points; the k-measurement threshold is a win rate of **0.5 or below**. Every one of these is a named exported constant so the first sweep can argue with it.
- **Descriptor buckets** (spec §3c), verbatim: range close **< 45 m**, mid **45–100 m**, long **> 100 m**, off the midpoint of `computeIdealRangeBand`'s `bandStart..bandEnd`; weight light **≤ 0.5**, medium **≤ 0.8**, heavy **> 0.8**, off `computeSpeedProfile().massT ÷ chassis.ratedMassT`; heat redliner **< 0**, cold **≥ 0**, off `computeHeatBalance().marginKw`.
- **Lock size** (spec §4): **8 part types plus 3 mods**, uniform random from `MIDGAME_POOL`, seeded. Every chassis runs the same lock.
- **Mod tier migration** (spec §1a): `common → 1`, `uncommon → 2`, `rare → 3`. Draw weight `2 ^ (1 − tier)`. Machinist price `tier × machinistTierCost` where `machinistTierCost = 15`.
- **Every report records `simContentHash()`** (spec §3d). A report without it is a report that cannot be compared.
- **Reports say "best found", never "the best".** A search finds *a* ceiling, not *the* ceiling (spec §7); I1 failing is stronger evidence than I1 passing, and the report must say so in words.

## Deviations from the spec, and why

Three places where the spec's letter cannot be followed. Each is a deliberate, recorded choice — do not silently re-decide them.

1. **`MIDGAME_POOL` lives in `packages/sim/src/breeding.ts`, not "beside `ONE_HOUR_PART_IDS`"** (spec §4). `ONE_HOUR_PART_IDS` is in `packages/game/src/content.ts` and the search is sim-side; sim cannot import game. It is still a declared design statement, not a harvest.
2. **`LADDER_SPAWN_DISTANCES_M` moves from `packages/game/src/nodes.ts` to `packages/sim/src/ladder.ts`**, and game re-exports it so no game or web call site changes. Spec §2a requires measuring I1 across every spawn distance in it, and I1 is sim-side.
3. **`UniqueDef.rarity` becomes `UniqueDef.tier`.** The spec only names `ModifierDef`, but `UniqueDef.rarity` is typed `ModifierRarity` and deleting the type breaks it. Uniques migrate on the same `common → 1 / uncommon → 2 / rare → 3` mapping and draw on the same `2 ^ (1 − tier)` weight.

Plus one judgement call the spec left open, flagged rather than buried:

4. **The player-facing start-budget gate keeps counting parts only.** `buildTierBudget` today drives `launchGate.ts`, `placementPermission.ts` and `RunPanel.tsx` against `START_BUDGET`. If mods started counting there, fitting a mod would push a legal build over its budget and the workshop would begin refusing placements and launches — a gameplay change the spec never asked for. So Task 2 splits the two: `buildPartTier` (parts only, excluding routing) keeps the player-facing gate exactly as it is, and `computeRank` (parts + mods) drives opponent generation, the harness and the breeding tool. Spec §1c's "player rank includes mods" is still honoured — it is the *measured* rank, not the workshop's placement allowance. **If the owner wants mods to eat the player's build budget too, that is a one-line switch in `launchGate.ts`; do not make it without asking.**

## Sizing

Measured on this machine, 26 Aug 2026, before any of this was built:

| Operation | Cost |
|---|---|
| `assembleBuild` (one wish, CH-5, 2 × W-AC) | ~22 ms warm, 37 ms cold |
| All three descriptors (`computeIdealRangeBand` + `computeSpeedProfile` + `computeHeatBalance`) | ~3.3 ms |
| One battle | ~212 ms |
| One screen (3 opponents × 1 seed) | ~445 ms |

So cost is *number of battles*, exactly as spec §3b says. Budget the sweep against that: a **default evaluation budget of 600 screens per (chassis, rank)** is ~4.5 minutes single-threaded, and Task 11's workers divide it. A single-lock sweep over 3 chassis × 12 ranks at that budget is hours single-threaded and roughly 20–30 minutes on 8 workers — which is why Task 11 is in this plan and not deferred. `--budget` on the script exists so a smoke run is seconds.

## File structure

| File | Responsibility |
|---|---|
| `packages/sim/src/rank.ts` (create) | `computeRank`, `modifierTier`, `modDrawWeight`, `buildPartTier`. The one place rank is defined. |
| `packages/sim/src/archive.ts` (create) | Descriptors, bucketing, the 3×3×2 cell grid, insertion. No battles. |
| `packages/sim/src/panel.ts` (create) | The frozen reference panel: screen panel, full panel, and the content-hash stamp. |
| `packages/sim/src/breeding.ts` (create) | `MIDGAME_POOL`, lock drawing, genome type and operators, the tier-laddered search. |
| `packages/sim/src/invariants.ts` (create) | I1, I2 + saturation rank, I3, and the k-measurement. Reads an archive, runs no search. |
| `packages/sim/scripts/breed.ts` (create) | `npm run sim:breed` — the sweep and its five reports. |
| `packages/sim/scripts/compare.ts` (create) | `npm run sim:compare` — two builds side by side. |
| `packages/sim/src/breedWorker.ts` (create) | Worker-thread entry: screens a batch of genomes. |
| `packages/sim/src/modifiers.ts` (modify) | `tier` replaces `rarity` and `scrapCost`; `ModifierRarity` and `RARITY_WEIGHT` deleted. |
| `packages/sim/src/uniques.ts` (modify) | `UniqueDef.tier` replaces `UniqueDef.rarity`. |
| `packages/sim/src/workbench.ts` (modify) | `pool` restricts completion; `fillArmour` gains an explicit plate count. |
| `packages/sim/src/ladder.ts` (modify) | `buildTierBudget` delegates to `buildPartTier`; opponent generation reads `computeRank`; `LADDER_SPAWN_DISTANCES_M` moves here. |
| `packages/sim/src/harness.ts` (modify) | `computeBudget` delegates to `computeRank`. |
| `packages/game/src/domain.ts` (modify) | `modScrapCost` and `modOffers` read `tier`. |
| `packages/game/src/nodes.ts` (modify) | Elite-carrier and unique rolls read `tier`; re-export `LADDER_SPAWN_DISTANCES_M`. |
| `packages/game/src/audit.ts` (modify) | The rarity/scrapCost warnings become one tier warning. |
| `packages/game/src/content.ts` (modify) | `machinistBaseCost` → `machinistTierCost: 15`. |

---

### Task 1: `ModifierDef.tier` replaces rarity and scrapCost

Spec §1a. Today a mod carries two hand-authored acquisition numbers that always move together. One number does all three jobs.

**Files:**
- Modify: `packages/sim/src/modifiers.ts:315-352` (the type and its doc block), and all 14 `kind: 'mod'` entries at `:454-596`
- Modify: `packages/sim/src/uniques.ts:20,37` and the 5 `UNIQUES` entries
- Modify: `packages/game/src/domain.ts:284-298`
- Modify: `packages/game/src/nodes.ts:4,12,255,265`
- Modify: `packages/game/src/audit.ts:285-286`
- Modify: `packages/game/src/content.ts:111` and `packages/game/src/types.ts:245`
- Test: `packages/sim/test/modifiers.test.ts`, `packages/game/test/game.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ModifierDef.tier: number` (required on `kind: 'mod'`, absent on quirks and variants); `UniqueDef.tier: number`; `GAME_CONTENT.economy.machinistTierCost: number`. Task 2 consumes `ModifierDef.tier`.

- [ ] **Step 1: Write the failing test**

Add to `packages/sim/test/modifiers.test.ts`:

```ts
import { MODIFIERS } from '../src/modifiers.js';
import { UNIQUES } from '../src/uniques.js';

describe('tier is the one authored number on a mod', () => {
  it('every mod declares a tier, and nothing else declares scarcity', () => {
    for (const def of Object.values(MODIFIERS)) {
      if (def.kind !== 'mod') {
        // Quirks and variants are not acquired, so they carry no tier.
        expect(def, def.id).not.toHaveProperty('tier');
        continue;
      }
      expect(def.tier, def.id).toBeGreaterThanOrEqual(1);
      expect(def.tier, def.id).toBeLessThanOrEqual(3);
      expect(def, def.id).not.toHaveProperty('rarity');
      expect(def, def.id).not.toHaveProperty('scrapCost');
    }
  });

  it('every unique declares a tier', () => {
    for (const unique of Object.values(UNIQUES)) {
      expect(unique.tier, unique.id).toBeGreaterThanOrEqual(1);
      expect(unique, unique.id).not.toHaveProperty('rarity');
    }
  });
});
```

Add to `packages/game/test/game.test.ts`:

```ts
import { modScrapCost } from '../src/domain.js';

describe('the machinist prices a mod off its tier', () => {
  it('charges tier x 15', () => {
    // insulated-mount is tier 1, marsh-pistons tier 2, fever-cycle tier 3.
    expect(modScrapCost('insulated-mount')).toBe(15);
    expect(modScrapCost('marsh-pistons')).toBe(30);
    expect(modScrapCost('fever-cycle')).toBe(45);
  });

  it('falls back to tier 1 for a modifier that is not a mod', () => {
    expect(modScrapCost('lucky')).toBe(15);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run sim:test -- modifiers` and `npm run game:test`
Expected: FAIL — `def.tier` is undefined, and `modScrapCost` still returns the flat 25.

- [ ] **Step 3: Make the change**

In `packages/sim/src/modifiers.ts`, delete `ModifierRarity` and `RARITY_WEIGHT` (`:319-326`) and replace the `rarity` and `scrapCost` fields on `ModifierDef` with:

```ts
  /**
   * How much of a mech's rank this mod costs, and — because everything derives
   * from it — how scarce it is and what the machinist charges (spec §1a):
   *
   *   draw weight     2 ^ (1 - tier)     see modDrawWeight() in rank.ts
   *   machinist price tier x machinistTierCost
   *   rank            tier               see computeRank() in rank.ts
   *
   * Required on `kind: 'mod'`; quirks and variants are not acquired and carry
   * none. `game:audit` warns about a mod that declares no tier.
   *
   * Known cost of the simplification (spec §1a): tier does three jobs, so a
   * scarcer mod necessarily costs more rank AND more scrap. "Rare but weak" is
   * not expressible. Parts already live with exactly this coupling.
   */
  tier?: number;
```

Migrate all 14 mods `common → tier: 1`, `uncommon → tier: 2`, `rare → tier: 3`, deleting both old fields. Four hand-authored prices move by a few scrap and that is expected: `tidecooler` 25 → 30, `gyrostabilized` 40 → 45, `coil-sprung` 40 → 45, `thermocouple-skin` 35 → 30.

In `packages/sim/src/uniques.ts`, replace the `import { MODIFIERS, type ModifierRarity }` with `import { MODIFIERS }`, change the field to `tier: number` with the doc line `/** How scarce it is where uniques are handed out, on the same scale as a mod's tier. */`, and migrate the five entries: `assize` 3, `fell-ford-widow` 3, `kiln-sister` 2, `tidewarden` 2, `long-argument` 3 (map each from the rarity it had).

In `packages/game/src/content.ts:111`, replace `machinistBaseCost: 25,` with:

```ts
    // Price per tier of mod (spec §1a). A tier-1 convenience is 15 scrap, a
    // tier-3 build-definer 45 — within a few scrap of every price that was
    // authored by hand before tier replaced them.
    machinistTierCost: 15,
```

and in `packages/game/src/types.ts:245` rename the field on the economy type to `machinistTierCost: number`.

In `packages/game/src/domain.ts`:

```ts
export function modScrapCost(modifierId: string): number {
  const tier = MODIFIERS[modifierId]?.tier ?? 1;
  return tier * GAME_CONTENT.economy.machinistTierCost;
}
```

and in `modOffers` (`:297`) replace the rarity weight with `modDrawWeight(modifier.tier)`, importing it from `@mechbattler/sim`. Do the same at both roll sites in `packages/game/src/nodes.ts` (`:255` for the elite carrier, `:265` for uniques — the latter reads `u.tier`). `modDrawWeight` does not exist yet, so **for this task only** inline `(t?: number) => 2 ** (1 - (t ?? 1))` as a local helper in each file; Task 2 replaces both with the shared export.

In `packages/game/src/audit.ts`, replace the two warnings at `:285-286` with:

```ts
    if (modifier.kind === 'mod' && modifier.tier === undefined) {
      warnings.push(`Mod ${modifier.id} declares no tier — it draws at the commonest weight, costs no rank and is priced as a tier 1`);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run sim:test && npm run game:test && npm run game:audit && npm run web:build`
Expected: PASS, and `game:audit` reports `ok: true` with an **empty** `warnings` array. `web:build` catches any web call site still reading `machinistBaseCost`.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/modifiers.ts packages/sim/src/uniques.ts packages/game/src packages/sim/test packages/game/test
git commit -m "Let a mod's tier be the only number anyone authors"
```

---

### Task 2: `computeRank` — one rank function, and the call-site split

Spec §1, §1c, §6. Rank is `Σ tier(part) + Σ tier(modifier)`, excluding conduits and heat pipes. Today mods contribute zero, so an elite gets `eliteBudgetBonus` *plus* a free mod.

**Files:**
- Create: `packages/sim/src/rank.ts`
- Modify: `packages/sim/src/index.ts` (export it)
- Modify: `packages/sim/src/harness.ts:12-15`
- Modify: `packages/sim/src/ladder.ts:32-38`
- Modify: `packages/game/src/domain.ts`, `packages/game/src/nodes.ts` (replace Task 1's inlined helper with the shared export)
- Test: `packages/sim/test/rank.test.ts` (create)

**Interfaces:**
- Consumes: `ModifierDef.tier` (Task 1).
- Produces:
  - `computeRank(build: Build): number`
  - `buildPartTier(build: Build): number`
  - `modifierTier(modifierId: string): number`
  - `modDrawWeight(tier: number | undefined): number`
  Tasks 4, 6, 7, 8, 9 all consume `computeRank`.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/test/rank.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildPartTier, computeRank, modDrawWeight, modifierTier } from '../src/rank.js';
import { assembleBuild } from '../src/workbench.js';

describe('rank is the sum of every tier a mech carries', () => {
  it('counts a mod, where the old budget counted nothing', () => {
    const plain = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 2 }] });
    const modded = assembleBuild({
      chassisId: 'CH-5',
      parts: [{ partId: 'W-AC', count: 2, modifiers: ['cold-bore'] }],
    });
    // Same metal either way: the difference is exactly the mods' tiers.
    expect(buildPartTier(modded.build)).toBe(buildPartTier(plain.build));
    const modCount = modded.build.parts.filter((p) => p.modifiers?.includes('cold-bore')).length;
    expect(modCount).toBeGreaterThan(0);
    expect(computeRank(modded.build) - computeRank(plain.build)).toBe(modCount * 3);
  });

  it('does not charge rank for routing', () => {
    // Wiring is structure tax, laid free by auto-wire (ladder.ts's rule).
    const report = assembleBuild({ chassisId: 'CH-9', parts: [{ partId: 'W-BR', count: 2 }] });
    const withConduit = {
      ...report.build,
      parts: [...report.build.parts, { ...report.build.parts[0]!, instanceId: 'x', partId: 'U-CON' }],
    };
    expect(computeRank(withConduit)).toBe(computeRank(report.build));
  });

  it('charges nothing for a quirk, which is not acquired', () => {
    expect(modifierTier('lucky')).toBe(0);
    expect(modifierTier('cold-bore')).toBe(3);
    expect(modifierTier('not-a-real-modifier')).toBe(0);
  });

  it('makes a tier-3 mod a quarter as likely as a tier-1', () => {
    expect(modDrawWeight(1)).toBe(1);
    expect(modDrawWeight(2)).toBe(0.5);
    expect(modDrawWeight(3)).toBe(0.25);
    expect(modDrawWeight(undefined)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:test -- rank`
Expected: FAIL — `Cannot find module '../src/rank.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/sim/src/rank.ts`:

```ts
/**
 * Rank: one number for how much mech a build is (spec §1).
 *
 *   rank(build) = Σ tier(part) + Σ tier(modifier)
 *                 excluding conduits and heat pipes, which are free routing
 *
 * Half of this is old — `computeBudget` and `buildTierBudget` both summed part
 * tiers, and the ladder has always generated opponents from that sum. What is
 * new is that **mods count**. Before this, a build carrying Fever cycle, Cold
 * bore and Gyrostabilized had the same budget as the same build with none, and
 * an elite received `eliteBudgetBonus` *plus* a free mod that cost nothing.
 *
 * Rank is a HYPOTHESIS, not a fact (spec §1b). An armour plate is tier 1, the
 * same as a machine gun, so "high rank" can mean "heavily plated and weak" —
 * a plausible mechanism for docs/17 F2's -0.637 budget-to-win-rate
 * correlation. The breeding sweep reports the ceiling at each rank precisely so
 * that this function can be found wrong. Do not weight it pre-emptively.
 */
import type { Build } from './types.js';
import { getPart } from './catalog.js';
import { MODIFIERS } from './modifiers.js';

/** Rank a single modifier contributes. Quirks and variants are not acquired: zero. */
export function modifierTier(modifierId: string): number {
  const def = MODIFIERS[modifierId];
  return def?.kind === 'mod' ? def.tier ?? 1 : 0;
}

/**
 * Relative draw weight for a mod or unique of this tier, at every roll site.
 * `2 ^ (1 - tier)` gives 1 / 0.5 / 0.25, roughly the 4:2:1 spread the named
 * rarities had before tier replaced them.
 */
export function modDrawWeight(tier: number | undefined): number {
  return 2 ** (1 - (tier ?? 1));
}

/**
 * Tier of the metal alone, ignoring mods. This is what the WORKSHOP's start
 * budget gate spends (launchGate, placementPermission, RunPanel): fitting a mod
 * must not push a legal build over its placement allowance and start refusing
 * launches. The player's *measured* rank still includes mods — that is
 * `computeRank` — but the two are deliberately different questions.
 */
export function buildPartTier(build: Build): number {
  return build.parts.reduce((sum, part) => {
    const def = getPart(part.partId);
    return def.isConduit || def.isHeatPipe ? sum : sum + def.tier;
  }, 0);
}

/** The full rank: metal plus mods. */
export function computeRank(build: Build): number {
  return build.parts.reduce((sum, part) => {
    const def = getPart(part.partId);
    const metal = def.isConduit || def.isHeatPipe ? 0 : def.tier;
    const mods = (part.modifiers ?? []).reduce((acc, id) => acc + modifierTier(id), 0);
    return sum + metal + mods;
  }, 0);
}
```

Add `export * from './rank.js';` to `packages/sim/src/index.ts`.

In `packages/sim/src/harness.ts`, replace the body of `computeBudget` with `return computeRank(build);` and update its doc comment to `/** @deprecated Use computeRank (rank.ts). Kept so harness reports keep their field name. */`.

In `packages/sim/src/ladder.ts`, replace the body of `buildTierBudget` with `return buildPartTier(build);` and add above it:

```ts
/**
 * @deprecated Use `buildPartTier` (rank.ts) for the workshop's placement
 * allowance, or `computeRank` for how much mech a build actually is. This alias
 * keeps the player-facing gate's call sites unchanged.
 */
```

Then, at `ladder.ts:101` and `:104-115`, switch opponent generation from `buildTierBudget` to `computeRank` — an opponent's budget must price the mods it carries. Import both from `./rank.js`.

Finally, in `packages/game/src/domain.ts` and `packages/game/src/nodes.ts`, delete Task 1's inlined weight helper and import `modDrawWeight` from `@mechbattler/sim`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run sim:test && npm run game:test && npm run web:build`
Expected: PASS. `packages/sim/test/ladder.test.ts:22` asserts a generated opponent stays inside its budget — it must still hold now that fill mods count, and if it does not, `generateOpponent` is overspending and that is a real bug to fix here, not a test to relax.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/rank.ts packages/sim/src/index.ts packages/sim/src/harness.ts packages/sim/src/ladder.ts packages/game/src packages/sim/test/rank.test.ts
git commit -m "Make rank count the mods a mech carries"
```

---

### Task 3: The workbench builds from a locked pool, and armour is a gene

Spec §3a. Two changes, both required before a search means anything: completion that reaches into the whole catalog would hand every search the same reactor and make the lock a lie, and automatic armour fill flattens weight — an archive axis — to one value.

**Files:**
- Modify: `packages/sim/src/workbench.ts:44-58` (`BuildWish`), `:113-127` (reactor seed), `:150-175` (power loop), `:178-195` (heat loop), `:197-240` (armour fill)
- Test: `packages/sim/test/workbench.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `BuildWish.pool?: readonly string[]` and `BuildWish.armourPlates?: number`. Tasks 6 and 7 consume both.

- [ ] **Step 1: Write the failing test**

Add to `packages/sim/test/workbench.test.ts`:

```ts
describe('the workbench honours a locked pool', () => {
  it('completes only from the pool it was given', () => {
    // R-E25 is the only reactor in the pool, so a build that needs power must
    // reach for that one — not the whole catalog's cheapest.
    const pool = ['W-MG', 'R-E25', 'U-RAD', 'U-ARM'];
    const report = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-MG', count: 2 }], pool });
    for (const part of report.build.parts) {
      const def = getPart(part.partId);
      if (def.isConduit || def.isHeatPipe) continue; // routing is free structure
      expect(pool, `${part.partId} came from outside the lock`).toContain(part.partId);
    }
  });

  it('says so when the pool cannot power the wish, instead of reaching outside it', () => {
    // No reactor in the pool at all: the honest outcome is a blocked report,
    // not a build silently completed from the catalog.
    const report = assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 2 }], pool: ['W-AC', 'U-ARM'] });
    expect(report.build.parts.every((p) => !getPart(p.partId).reactor)).toBe(true);
    expect(report.blocked.length).toBeGreaterThan(0);
  });
});

describe('armour is a gene, not an automatic fill', () => {
  it('fits exactly the plate count it was asked for', () => {
    const report = assembleBuild({
      chassisId: 'CH-9',
      parts: [{ partId: 'W-AC', count: 2 }],
      armourPlates: 3,
    });
    const plates = report.build.parts.filter((p) => p.partId === 'U-ARM').length;
    expect(plates).toBeLessThanOrEqual(3);
    expect(report.energyMarginKw).toBeGreaterThanOrEqual(0);
  });

  it('fits none when asked for none', () => {
    const report = assembleBuild({
      chassisId: 'CH-9',
      parts: [{ partId: 'W-AC', count: 2 }],
      armourPlates: 0,
    });
    expect(report.build.parts.some((p) => p.partId === 'U-ARM')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:test -- workbench`
Expected: FAIL — `pool` and `armourPlates` are not options, so the pool test finds a catalog reactor and `armourPlates: 0` still fills.

- [ ] **Step 3: Write the implementation**

Add to `BuildWish`:

```ts
  /**
   * Restrict completion to this set of part ids (spec §3a). Without it,
   * completion reaches into the whole catalog for a reactor or a radiator,
   * which would hand every locked search the same reactor and make the lock
   * meaningless. Conduits and heat pipes are exempt — routing is structure tax
   * laid by auto-wire, and a lock that omitted a conduit would forbid wiring.
   * Omission preserves the whole-catalog behaviour `sim:try` relies on.
   */
  pool?: readonly string[];
  /**
   * Exact number of armour plates to fit, instead of filling every spare cell.
   * Weight is an archive axis (spec §3c) and the automatic fill flattens it to
   * one value, so the search evolves plate count instead. Fewer may be fitted
   * than asked for — the trim below still takes plates back off when their own
   * mass browns the build out, and there may be no cell left. `fillArmour`
   * still governs when this is omitted.
   */
  armourPlates?: number;
```

Add a pool gate near the top of `assembleBuild`, beside `withinBudget`:

```ts
  const allowed = wish.pool ? new Set(wish.pool) : undefined;
  const inPool = (partId: string): boolean => {
    if (!allowed) return true;
    const def = getPart(partId);
    return def.isConduit || def.isHeatPipe || allowed.has(partId);
  };
```

Then apply it at each of the three completion sites, keeping every existing `blocked` message so a stall still explains itself:

- The reactor seed (`:120`): change `const smallest = REACTORS()[0];` to `const smallest = REACTORS().filter(inPool)[0];`.
- The power loop (`:167`): change `const options = REACTORS();` to `const options = REACTORS().filter(inPool);`, and before `if (!pick) break;` add
  ```ts
      if (options.length === 0) {
        blocked.push({ partId: '(reactor)', why: `${shortfall}, but the lock has no reactor in it` });
        break;
      }
  ```
- The heat loop (`:181`): guard the whole loop with `if (inPool('U-RAD'))`, and when it is not in the pool push one `blocked` entry saying `heat balance ${heat.marginKw.toFixed(1)} kW, but the lock has no radiator in it` if the balance is negative.

Replace the armour block's `while` condition so an explicit count wins:

```ts
    const wantPlates = wish.armourPlates;
    const armourAllowed = inPool('U-ARM') && wantPlates !== 0 && (wantPlates !== undefined || wish.fillArmour !== false);
    if (armourAllowed) {
      // ... existing route-stripping and plate loop, with the loop condition:
      while ((wantPlates === undefined || plateIds.length < wantPlates) && withinBudget(build, 'U-ARM', wish.budget)) {
```

Everything downstream — the brownout trim and its `added` message — is unchanged. The trim is what makes `armourPlates` a *request*: it still takes plates back off when their mass browns the build out, which is why the test asserts `toBeLessThanOrEqual`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run sim:test -- workbench`
Expected: PASS, including the seven pre-existing workbench tests — `sim:try` with no `pool` and no `armourPlates` must behave exactly as it does today.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/workbench.ts packages/sim/test/workbench.test.ts
git commit -m "Let the workbench build inside a lock, and evolve its own armour"
```

---

### Task 4: Descriptors and the archive

Spec §3c. Descriptors cost ~3.3 ms and no battles, so they are free. The archive is the anti-convergence measurement: a cell filling with one build means the lock supports one mech.

**Files:**
- Create: `packages/sim/src/archive.ts`
- Modify: `packages/sim/src/index.ts`
- Test: `packages/sim/test/archive.test.ts` (create)

**Interfaces:**
- Consumes: `computeRank` (Task 2).
- Produces:
  - `describeBuild(build: Build): BuildDescriptors` where
    `BuildDescriptors = { rangeM: number; range: 'close'|'mid'|'long'; loadFactor: number; weight: 'light'|'medium'|'heavy'; heatMarginKw: number; heat: 'cold'|'redliner'; kill: 'heat'|'power'|'damage'; rank: number }`
  - `cellKey(d: BuildDescriptors): string` — `` `${d.range}/${d.weight}/${d.heat}` ``
  - `class BuildArchive` with `insert(entry: ArchiveEntry): boolean`, `entries(): ArchiveEntry[]`, `best(): ArchiveEntry | undefined`, `cells(): Map<string, ArchiveEntry>`, `emptyCells(): string[]`
  - `ArchiveEntry = { build: Build; descriptors: BuildDescriptors; fitness: number; genome: Genome }` — `Genome` is imported as a type from `./breeding.js` in Task 6; until then declare it in `archive.ts` as `unknown` and tighten it in Task 6. **Do not leave it `unknown`** — Task 6 has an explicit step to fix it.
  - `RANGE_CLOSE_M = 45`, `RANGE_LONG_M = 100`, `WEIGHT_LIGHT = 0.5`, `WEIGHT_MEDIUM = 0.8`
  Tasks 7, 8, 9, 10 consume all of it.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/test/archive.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BuildArchive, cellKey, describeBuild } from '../src/archive.js';
import { assembleBuild } from '../src/workbench.js';
import { computeIdealRangeBand } from '../src/derivedStats.js';

const build = (chassisId: string, partId: string, count: number) =>
  assembleBuild({ chassisId, parts: [{ partId, count }], armourPlates: 0 }).build;

describe('descriptors are read off the sim, never typed', () => {
  it('buckets range on the midpoint of the sim\'s own ideal band', () => {
    const b = build('CH-2', 'W-MG', 2);
    const band = computeIdealRangeBand(b);
    const d = describeBuild(b);
    expect(d.rangeM).toBeCloseTo((band.bandStart + band.bandEnd) / 2, 5);
    expect(d.range).toBe(d.rangeM < 45 ? 'close' : d.rangeM > 100 ? 'long' : 'mid');
  });

  it('reads the kill method off the weapon fields', () => {
    // W-SC carries enemyHeatKj; W-ION carries capDrainKj; W-MG neither.
    expect(describeBuild(build('CH-5', 'W-SC', 1)).kill).toBe('heat');
    expect(describeBuild(build('CH-5', 'W-ION', 1)).kill).toBe('power');
    expect(describeBuild(build('CH-5', 'W-MG', 2)).kill).toBe('damage');
  });

  it('names a cell by range, weight and heat only', () => {
    const d = describeBuild(build('CH-9', 'W-AC', 2));
    expect(cellKey(d)).toBe(`${d.range}/${d.weight}/${d.heat}`);
    // Kill method is a label, not a dimension (spec §3c).
    expect(cellKey(d)).not.toContain(d.kill);
  });
});

describe('the archive keeps the best per cell', () => {
  it('replaces a weaker occupant and rejects a weaker challenger', () => {
    const b = build('CH-9', 'W-AC', 2);
    const d = describeBuild(b);
    const archive = new BuildArchive();
    expect(archive.insert({ build: b, descriptors: d, fitness: 0.4, genome: null })).toBe(true);
    expect(archive.insert({ build: b, descriptors: d, fitness: 0.6, genome: null })).toBe(true);
    expect(archive.insert({ build: b, descriptors: d, fitness: 0.5, genome: null })).toBe(false);
    expect(archive.cells().get(cellKey(d))?.fitness).toBe(0.6);
    expect(archive.best()?.fitness).toBe(0.6);
  });

  it('reports the cells nobody filled, because an empty cell is the finding', () => {
    const archive = new BuildArchive();
    const b = build('CH-9', 'W-AC', 2);
    archive.insert({ build: b, descriptors: describeBuild(b), fitness: 0.5, genome: null });
    // 3 ranges x 3 weights x 2 heats = 18 slots; one is filled.
    expect(archive.emptyCells()).toHaveLength(17);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:test -- archive`
Expected: FAIL — `Cannot find module '../src/archive.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/sim/src/archive.ts`:

```ts
/**
 * The archive: what variety a lock actually supports (spec §3c).
 *
 * Not for finding the ceiling — that is a max, and the search tracks it
 * directly. This is the anti-convergence measurement. A cell filling with one
 * build means the lock supports one mech; six cells at comparable fitness means
 * it supports six. No separate diversity metric is needed.
 *
 * Every descriptor is READ FROM THE SIM. An instrument must not hardcode what
 * the sim computes (CLAUDE.md) — the battle diagnostics substituted constants
 * for fire-control lag, weapon modifiers, terrain cover, target profile and
 * target speed in turn, each found only while reviewing the fix for the last.
 */
import type { Build } from './types.js';
import { getChassis } from './chassis.js';
import { getPart } from './catalog.js';
import { computeHeatBalance, computeIdealRangeBand, computeSpeedProfile } from './derivedStats.js';
import { computeRank } from './rank.js';

/** Bucket edges (spec §3c). Provisional in the same way the invariant thresholds are. */
export const RANGE_CLOSE_M = 45;
export const RANGE_LONG_M = 100;
export const WEIGHT_LIGHT = 0.5;
export const WEIGHT_MEDIUM = 0.8;

export type RangeBucket = 'close' | 'mid' | 'long';
export type WeightBucket = 'light' | 'medium' | 'heavy';
export type HeatBucket = 'cold' | 'redliner';
export type KillMethod = 'heat' | 'power' | 'damage';

export interface BuildDescriptors {
  /** Midpoint of the sim's own ideal band, metres. */
  rangeM: number;
  range: RangeBucket;
  /** massT / chassis.ratedMassT — how much of the frame's rating is spent. */
  loadFactor: number;
  weight: WeightBucket;
  heatMarginKw: number;
  heat: HeatBucket;
  kill: KillMethod;
  rank: number;
}

export function describeBuild(build: Build): BuildDescriptors {
  const chassis = getChassis(build.chassisId);
  const band = computeIdealRangeBand(build);
  const rangeM = (band.bandStart + band.bandEnd) / 2;
  const speed = computeSpeedProfile(chassis, build);
  const loadFactor = speed.massT / chassis.ratedMassT;
  const heatMarginKw = computeHeatBalance(chassis, build).marginKw;

  // Kill method reads the weapon fields the sim actually consults: a soaker
  // that cooks the enemy (enemyHeatKj), a gun that drains their capacitors
  // (capDrainKj), or plain damage. Whichever the guns mostly do.
  let heatKj = 0;
  let drainKj = 0;
  for (const part of build.parts) {
    const weapon = getPart(part.partId).weapon;
    if (!weapon) continue;
    heatKj += weapon.enemyHeatKj ?? 0;
    drainKj += weapon.capDrainKj ?? 0;
  }

  return {
    rangeM,
    range: rangeM < RANGE_CLOSE_M ? 'close' : rangeM > RANGE_LONG_M ? 'long' : 'mid',
    loadFactor,
    weight: loadFactor <= WEIGHT_LIGHT ? 'light' : loadFactor <= WEIGHT_MEDIUM ? 'medium' : 'heavy',
    heatMarginKw,
    heat: heatMarginKw < 0 ? 'redliner' : 'cold',
    kill: heatKj > drainKj && heatKj > 0 ? 'heat' : drainKj > 0 ? 'power' : 'damage',
    rank: computeRank(build),
  };
}

/**
 * Cell identity: range x weight, each split cold/redliner. Eighteen slots,
 * readable as a 3x3. Kill method and the exact heat number are LABELS, shown on
 * a gallery entry — the search does not have to fill a cell for each.
 */
export function cellKey(d: BuildDescriptors): string {
  return `${d.range}/${d.weight}/${d.heat}`;
}

export const ALL_CELL_KEYS: string[] = (['close', 'mid', 'long'] as RangeBucket[]).flatMap((range) =>
  (['light', 'medium', 'heavy'] as WeightBucket[]).flatMap((weight) =>
    (['cold', 'redliner'] as HeatBucket[]).map((heat) => `${range}/${weight}/${heat}`)));

export interface ArchiveEntry<G = unknown> {
  build: Build;
  descriptors: BuildDescriptors;
  /** Win rate against the panel it was measured on. */
  fitness: number;
  genome: G;
}

export class BuildArchive<G = unknown> {
  private readonly grid = new Map<string, ArchiveEntry<G>>();

  /** Returns true when the entry claimed or improved a cell. Ties do not displace. */
  insert(entry: ArchiveEntry<G>): boolean {
    const key = cellKey(entry.descriptors);
    const held = this.grid.get(key);
    if (held && held.fitness >= entry.fitness) return false;
    this.grid.set(key, entry);
    return true;
  }

  cells(): Map<string, ArchiveEntry<G>> { return new Map(this.grid); }
  entries(): ArchiveEntry<G>[] { return [...this.grid.values()]; }
  best(): ArchiveEntry<G> | undefined {
    return this.entries().reduce<ArchiveEntry<G> | undefined>(
      (top, e) => (!top || e.fitness > top.fitness ? e : top), undefined);
  }
  /** Cells nobody filled. "No hot heavy brawler exists" is the finding. */
  emptyCells(): string[] { return ALL_CELL_KEYS.filter((key) => !this.grid.has(key)); }
}
```

Add `export * from './archive.js';` to `packages/sim/src/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run sim:test -- archive`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/archive.ts packages/sim/src/index.ts packages/sim/test/archive.test.ts
git commit -m "Describe a build the way the sim already measures it"
```

---

### Task 5: The frozen reference panel

Spec §3d. Fitness is measured against opponents built from the catalog being edited. That circularity cannot be removed; it can be *stamped*, so a report says when the yardstick moved.

**Files:**
- Create: `packages/sim/src/panel.ts`
- Modify: `packages/sim/src/index.ts`
- Test: `packages/sim/test/panel.test.ts` (create)

**Interfaces:**
- Consumes: `TEMPLATES` (`templates.ts`), `simContentHash` (`version.ts`), `evaluateMatchup` (`adaptation.ts`), `LADDER_SPAWN_DISTANCES_M` (moved here in this task).
- Produces:
  - `SCREEN_PANEL_IDS: readonly string[]` — 3 template ids
  - `FULL_PANEL_IDS: readonly string[]` — all 7 canonical template ids
  - `panelBuilds(ids: readonly string[]): { id: string; build: Build }[]`
  - `screenFitness(build: Build, seed: number): number`
  - `confirmFitness(build: Build, seed: number, seeds?: number): { overall: number; perOpponent: { id: string; winRate: number }[] }`
  - `panelStamp(): { contentHash: string; screenPanel: readonly string[]; fullPanel: readonly string[]; spawnDistancesM: readonly number[] }`
  Tasks 7, 8, 9 consume all of it.
- Also moves `LADDER_SPAWN_DISTANCES_M` into `packages/sim/src/ladder.ts` (Deviation 2).

- [ ] **Step 1: Write the failing test**

Create `packages/sim/test/panel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FULL_PANEL_IDS, SCREEN_PANEL_IDS, confirmFitness, panelStamp, screenFitness } from '../src/panel.js';
import { LADDER_SPAWN_DISTANCES_M } from '../src/ladder.js';
import { simContentHash } from '../src/version.js';
import { assembleBuild } from '../src/workbench.js';
import { TEMPLATES } from '../src/templates.js';

const subject = () => assembleBuild({ chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 2 }] }).build;

describe('the panel is frozen, and says which catalog it froze against', () => {
  it('names templates that exist', () => {
    const known = new Set(TEMPLATES.map((t) => t.id));
    for (const id of [...SCREEN_PANEL_IDS, ...FULL_PANEL_IDS]) expect(known, id).toContain(id);
    expect(SCREEN_PANEL_IDS).toHaveLength(3);
  });

  it('stamps the content hash, so a moved catalog is visible in the report', () => {
    const stamp = panelStamp();
    expect(stamp.contentHash).toBe(simContentHash());
    expect(stamp.spawnDistancesM).toEqual(LADDER_SPAWN_DISTANCES_M);
  });

  it('scores the same build the same way twice', () => {
    const b = subject();
    expect(screenFitness(b, 7)).toBe(screenFitness(b, 7));
    expect(confirmFitness(b, 7, 2).overall).toBe(confirmFitness(b, 7, 2).overall);
  });

  it('derives its seeds from the seed it is given, not from call order', () => {
    const b = subject();
    const a = screenFitness(b, 1);
    screenFitness(subject(), 999); // an unrelated evaluation in between
    expect(screenFitness(b, 1)).toBe(a);
  });

  it('measures a win rate in [0, 1]', () => {
    const score = screenFitness(subject(), 3);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:test -- panel`
Expected: FAIL — `Cannot find module '../src/panel.js'`, and `LADDER_SPAWN_DISTANCES_M` is not exported from `ladder.ts`.

- [ ] **Step 3: Write the implementation**

First move the constant. Cut `export const LADDER_SPAWN_DISTANCES_M = [40, 60, 100, 160];` from `packages/game/src/nodes.ts:33` into `packages/sim/src/ladder.ts` (just below `buildTierBudget`), with the comment:

```ts
/**
 * Spawn separations the ladder draws from. Sim-side because the invariant
 * sweep measures across all of them (spec §2a) and the sim may not import the
 * game package. `packages/game` re-exports it, so no game or web call site
 * changes.
 */
```

In `packages/game/src/nodes.ts`, import it from `@mechbattler/sim` and add `export { LADDER_SPAWN_DISTANCES_M };` so `packages/game/src/index.ts` keeps exporting it.

Then create `packages/sim/src/panel.ts`:

```ts
/**
 * The frozen reference panel (spec §3d).
 *
 * THIS IS THE ONE THING THAT CANNOT BE MADE FULLY HONEST. Fitness is a win rate
 * against opponents built from the catalog being edited, so when a gun changes
 * the yardstick changes with it. The mitigation is not a fix: the panel is a
 * fixed set of template ids, and every report records `simContentHash()`.
 * Results are comparable while the catalog holds still; when it moves, the
 * report says so. Cross-content-version comparisons are indicative, not
 * measurements — and anything that prints these numbers must say that.
 */
import type { Build } from './types.js';
import { TEMPLATES } from './templates.js';
import { evaluateMatchup } from './adaptation.js';
import { simContentHash } from './version.js';
import { LADDER_SPAWN_DISTANCES_M } from './ladder.js';

/**
 * Three opponents for the screen, chosen to span the range game rather than to
 * be representative: a fast light kiter, a mid-range gunline, and a slow heavy
 * that deletes things up close. A candidate that beats all three is worth the
 * full panel; most candidates never cost more than this.
 */
export const SCREEN_PANEL_IDS = ['vulture-skirmisher', 'mule-gunline', 'bastion-tank'] as const;

/** The confirm panel: the whole canonical roster. */
export const FULL_PANEL_IDS = TEMPLATES.map((t) => t.id);

export function panelBuilds(ids: readonly string[]): { id: string; build: Build }[] {
  return ids.map((id) => {
    const template = TEMPLATES.find((t) => t.id === id);
    if (!template) throw new Error(`Panel names an unknown template: ${id}`);
    return { id, build: template.build };
  });
}

/**
 * Base seed for a candidate's battles. Derived from the caller's seed alone —
 * never from evaluation order — so a sweep reproduces exactly and parallelises
 * across workers (spec §3e, docs/11 §3).
 */
const baseSeedFor = (seed: number): number => 9_000_000 + (seed >>> 0) * 97;

/** Screen: 3 opponents x 1 seed, about 0.45 s. */
export function screenFitness(build: Build, seed: number): number {
  const opponents = panelBuilds(SCREEN_PANEL_IDS);
  const total = opponents.reduce(
    (sum, o) => sum + evaluateMatchup(build, o.build, 1, baseSeedFor(seed)), 0);
  return total / opponents.length;
}

/** Confirm: the full panel at high seeds, for anything that claimed a cell. */
export function confirmFitness(
  build: Build, seed: number, seeds = 6,
): { overall: number; perOpponent: { id: string; winRate: number }[] } {
  const perOpponent = panelBuilds(FULL_PANEL_IDS).map((o) => ({
    id: o.id,
    winRate: evaluateMatchup(build, o.build, seeds, baseSeedFor(seed)),
  }));
  const overall = perOpponent.reduce((sum, o) => sum + o.winRate, 0) / Math.max(1, perOpponent.length);
  return { overall, perOpponent };
}

/** Goes at the top of every report. A report without it cannot be compared. */
export function panelStamp() {
  return {
    contentHash: simContentHash(),
    screenPanel: SCREEN_PANEL_IDS,
    fullPanel: FULL_PANEL_IDS,
    spawnDistancesM: LADDER_SPAWN_DISTANCES_M,
  };
}
```

Add `export * from './panel.js';` to `packages/sim/src/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run sim:test -- panel && npm run game:test && npm run web:build`
Expected: PASS. `game:test` and `web:build` prove the `LADDER_SPAWN_DISTANCES_M` move broke no call site.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/panel.ts packages/sim/src/ladder.ts packages/sim/src/index.ts packages/game/src/nodes.ts packages/sim/test/panel.test.ts
git commit -m "Freeze a reference panel, and stamp what catalog it froze against"
```

---

### Task 6: Locks, the genome, and its operators

Spec §3a, §4. A lock is a randomly drawn subset of gear standing in for the fact that a run hands you a fraction of the catalog.

**Files:**
- Create: `packages/sim/src/breeding.ts`
- Modify: `packages/sim/src/archive.ts` (tighten `ArchiveEntry`'s genome type)
- Modify: `packages/sim/src/index.ts`
- Test: `packages/sim/test/breeding.test.ts` (create)

**Interfaces:**
- Consumes: `computeRank`, `modDrawWeight` (Task 2); `assembleBuild`, `BuildWish` (Task 3); `Pcg32`, `pickWeighted` (`rng.ts`).
- Produces:
  - `MIDGAME_POOL: { parts: readonly string[]; mods: readonly string[] }`
  - `Lock = { seed: number; parts: readonly string[]; mods: readonly string[] }`
  - `drawLock(seed: number, opts?: { partCount?: number; modCount?: number }): Lock`
  - `Genome = { chassisId: string; parts: { partId: string; count: number; modifiers?: string[] }[]; armourPlates: number }`
  - `develop(genome: Genome, lock: Lock, rankCap: number): AssemblyReport`
  - `mutate(genome: Genome, lock: Lock, rng: Pcg32): Genome`
  - `crossover(a: Genome, b: Genome, rng: Pcg32): Genome`
  - `genomeKey(genome: Genome): string` — the dedupe key
  - `LOCK_PART_COUNT = 8`, `LOCK_MOD_COUNT = 3`
  Task 7 consumes all of it.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/test/breeding.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  LOCK_MOD_COUNT, LOCK_PART_COUNT, MIDGAME_POOL,
  crossover, develop, drawLock, genomeKey, mutate, type Genome,
} from '../src/breeding.js';
import { computeRank } from '../src/rank.js';
import { getPart } from '../src/catalog.js';
import { Pcg32 } from '../src/rng.js';

describe('a lock is a seeded slice of the midgame pool', () => {
  it('draws the declared size, without duplicates, from the pool', () => {
    const lock = drawLock(42);
    expect(lock.parts).toHaveLength(LOCK_PART_COUNT);
    expect(lock.mods).toHaveLength(LOCK_MOD_COUNT);
    expect(new Set(lock.parts).size).toBe(LOCK_PART_COUNT);
    expect(new Set(lock.mods).size).toBe(LOCK_MOD_COUNT);
    for (const id of lock.parts) expect(MIDGAME_POOL.parts).toContain(id);
    for (const id of lock.mods) expect(MIDGAME_POOL.mods).toContain(id);
  });

  it('draws the same lock from the same seed, and a different one otherwise', () => {
    expect(drawLock(42)).toEqual(drawLock(42));
    expect(drawLock(42)).not.toEqual(drawLock(43));
  });
});

describe('development cannot produce an illegal mech', () => {
  it('keeps every genome inside its lock and its rank cap', () => {
    const lock = drawLock(7);
    const rng = new Pcg32(7);
    let genome: Genome = { chassisId: 'CH-5', parts: [], armourPlates: 0 };
    for (let i = 0; i < 40; i++) {
      genome = mutate(genome, lock, rng);
      const report = develop(genome, lock, 20);
      expect(computeRank(report.build)).toBeLessThanOrEqual(20);
      for (const part of report.build.parts) {
        const def = getPart(part.partId);
        if (def.isConduit || def.isHeatPipe) continue;
        expect(lock.parts, `${part.partId} escaped the lock`).toContain(part.partId);
        for (const modId of part.modifiers ?? []) expect(lock.mods).toContain(modId);
      }
    }
  });

  it('develops the same genome into the same build twice', () => {
    const lock = drawLock(7);
    const genome: Genome = { chassisId: 'CH-9', parts: [{ partId: lock.parts[0]!, count: 1 }], armourPlates: 2 };
    expect(JSON.stringify(develop(genome, lock, 30).build))
      .toBe(JSON.stringify(develop(genome, lock, 30).build));
  });
});

describe('operators', () => {
  it('mutation changes something', () => {
    const lock = drawLock(11);
    const rng = new Pcg32(11);
    const genome: Genome = { chassisId: 'CH-5', parts: [{ partId: lock.parts[0]!, count: 1 }], armourPlates: 1 };
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(genomeKey(mutate(genome, lock, rng)));
    expect(seen.size).toBeGreaterThan(1);
  });

  it('crossover keeps the chassis of the first parent and draws parts from both', () => {
    const lock = drawLock(11);
    const rng = new Pcg32(3);
    const a: Genome = { chassisId: 'CH-5', parts: [{ partId: lock.parts[0]!, count: 2 }], armourPlates: 0 };
    const b: Genome = { chassisId: 'CH-9', parts: [{ partId: lock.parts[1]!, count: 1 }], armourPlates: 4 };
    const child = crossover(a, b, rng);
    expect(child.chassisId).toBe('CH-5');
    for (const part of child.parts) expect([lock.parts[0], lock.parts[1]]).toContain(part.partId);
  });

  it('gives two identical genomes the same key regardless of part order', () => {
    const one: Genome = { chassisId: 'CH-5', parts: [{ partId: 'W-AC', count: 1 }, { partId: 'W-MG', count: 2 }], armourPlates: 1 };
    const two: Genome = { chassisId: 'CH-5', parts: [{ partId: 'W-MG', count: 2 }, { partId: 'W-AC', count: 1 }], armourPlates: 1 };
    expect(genomeKey(one)).toBe(genomeKey(two));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:test -- breeding`
Expected: FAIL — `Cannot find module '../src/breeding.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/sim/src/breeding.ts`:

```ts
/**
 * Breeding: locks, genomes and the operators that move between them
 * (spec §3a, §4).
 *
 * The genome is a WISH — the input `assembleBuild` already takes — and
 * `assembleBuild` is the developmental step: it places parts by the workshop's
 * own rules, wires the build, and reports what would not fit. So an illegal
 * genome cannot exist, and no evaluation is ever spent on something the game
 * would reject.
 */
import type { AssemblyReport } from './workbench.js';
import { assembleBuild } from './workbench.js';
import { MODIFIERS } from './modifiers.js';
import { getPart } from './catalog.js';
import { modDrawWeight } from './rank.js';
import { Pcg32, pickWeighted } from './rng.js';

/**
 * What "midgame" is meant to contain. DECLARED, not harvested: there is no
 * meta-endgame yet, so this is a design statement in the same spirit as
 * `ONE_HOUR_PART_IDS`. It lives here rather than beside that constant because
 * `packages/sim` may not import `packages/game` (spec §4, Deviation 1).
 *
 * Routing (U-CON, U-PIPE) is deliberately absent: auto-wire lays it free and a
 * lock without a conduit would forbid wiring. U-AMMO is absent by declaration —
 * a deliberate placeholder (docs/19).
 */
export const MIDGAME_POOL = {
  parts: [
    'R-C40', 'R-C90', 'R-E25', 'R-E60',
    'W-MG', 'W-AC', 'W-LAS', 'W-RKT', 'W-CB', 'W-BR', 'W-SC', 'W-ION', 'W-RG',
    'U-RAD', 'U-HS', 'U-ARM', 'U-TC1', 'U-ACT', 'U-TUR', 'U-SHELL',
    'U-RISE2', 'U-RISE3', 'U-RISEL',
    'P-CAP', 'P-CAP2',
  ],
  mods: Object.values(MODIFIERS).filter((m) => m.kind === 'mod').map((m) => m.id),
} as const satisfies { parts: readonly string[]; mods: readonly string[] };

export const LOCK_PART_COUNT = 8;
export const LOCK_MOD_COUNT = 3;

export interface Lock {
  seed: number;
  parts: readonly string[];
  mods: readonly string[];
}

/** Draw without replacement, consuming one nextFloat per pick. */
function drawSome<T>(pool: readonly T[], count: number, weightOf: (item: T) => number, rng: Pcg32): T[] {
  const remaining = [...pool];
  const taken: T[] = [];
  while (taken.length < count && remaining.length > 0) {
    const pick = pickWeighted(remaining, weightOf, rng)!;
    taken.push(pick);
    remaining.splice(remaining.indexOf(pick), 1);
  }
  return taken;
}

/**
 * Uniform over parts on purpose (spec §4): this measures whether any GEAR is
 * bad, not whether the loot tables are bad. Mods are drawn on their tier
 * weight, because tier is what scarcity means now and three mods is what a run
 * actually grants — one machinist service after each of wins 3, 6 and 9.
 */
export function drawLock(seed: number, opts: { partCount?: number; modCount?: number } = {}): Lock {
  const rng = new Pcg32(seed);
  const parts = drawSome(MIDGAME_POOL.parts, opts.partCount ?? LOCK_PART_COUNT, () => 1, rng);
  const mods = drawSome(MIDGAME_POOL.mods, opts.modCount ?? LOCK_MOD_COUNT,
    (id) => modDrawWeight(MODIFIERS[id]?.tier), rng);
  return { seed, parts, mods };
}

export interface Genome {
  chassisId: string;
  parts: { partId: string; count: number; modifiers?: string[] }[];
  armourPlates: number;
}

/** Order-independent identity, so the search never re-evaluates the same mech. */
export function genomeKey(genome: Genome): string {
  const parts = genome.parts
    .map((p) => `${p.partId}:${p.count}:${[...(p.modifiers ?? [])].sort().join('+')}`)
    .sort()
    .join(',');
  return `${genome.chassisId}|${parts}|a${genome.armourPlates}`;
}

/**
 * Develop a genome into a mech. The lock restricts BOTH the wish and what
 * completion may reach for, and `rankCap` caps what completion may spend —
 * without it a rank-6 candidate would be quietly completed into a rank-14 one.
 */
export function develop(genome: Genome, lock: Lock, rankCap: number): AssemblyReport {
  return assembleBuild({
    chassisId: genome.chassisId,
    parts: genome.parts.map((p) => ({ partId: p.partId, count: p.count, modifiers: p.modifiers })),
    pool: lock.parts,
    armourPlates: genome.armourPlates,
    budget: rankCap,
  });
}

const clone = (g: Genome): Genome => ({
  chassisId: g.chassisId,
  parts: g.parts.map((p) => ({ ...p, modifiers: p.modifiers ? [...p.modifiers] : undefined })),
  armourPlates: g.armourPlates,
});

/** Mods this part can legally carry, out of the lock. One mod per part is the rule. */
function legalModsFor(partId: string, lock: Lock): string[] {
  const def = getPart(partId);
  return lock.mods.filter((id) => MODIFIERS[id]?.appliesTo(def));
}

/**
 * One change: add, drop or swap a part; nudge a count; add, move or remove a
 * mod; or nudge the armour. Legality is left to `develop` — the operators only
 * respect the two rules the substrate will not resolve for them (one mod per
 * part, and a mod must apply to its part).
 */
export function mutate(genome: Genome, lock: Lock, rng: Pcg32): Genome {
  const next = clone(genome);
  const roll = Math.floor(rng.nextFloat() * 6);
  const pickPart = () => (next.parts.length === 0 ? undefined
    : next.parts[Math.floor(rng.nextFloat() * next.parts.length)]);

  if (roll === 0 || next.parts.length === 0) {
    const partId = lock.parts[Math.floor(rng.nextFloat() * lock.parts.length)]!;
    const existing = next.parts.find((p) => p.partId === partId);
    if (existing) existing.count += 1;
    else next.parts.push({ partId, count: 1 });
  } else if (roll === 1) {
    next.parts.splice(Math.floor(rng.nextFloat() * next.parts.length), 1);
  } else if (roll === 2) {
    const target = pickPart()!;
    target.partId = lock.parts[Math.floor(rng.nextFloat() * lock.parts.length)]!;
    // A swapped part keeps only mods that still apply to what it now is.
    const legal = new Set(legalModsFor(target.partId, lock));
    target.modifiers = target.modifiers?.filter((id) => legal.has(id));
  } else if (roll === 3) {
    const target = pickPart()!;
    target.count = Math.max(1, target.count + (rng.nextFloat() < 0.5 ? -1 : 1));
  } else if (roll === 4) {
    const target = pickPart()!;
    const legal = legalModsFor(target.partId, lock);
    if (legal.length === 0 || (target.modifiers?.length && rng.nextFloat() < 0.4)) {
      target.modifiers = undefined;
    } else {
      target.modifiers = [legal[Math.floor(rng.nextFloat() * legal.length)]!];
    }
  } else {
    next.armourPlates = Math.max(0, next.armourPlates + (rng.nextFloat() < 0.5 ? -1 : 1));
  }
  return next;
}

/** Splice two part lists. The chassis is `a`'s: a chassis is not a gene here. */
export function crossover(a: Genome, b: Genome, rng: Pcg32): Genome {
  const pool = [...a.parts, ...b.parts];
  const parts: Genome['parts'] = [];
  for (const part of pool) {
    if (rng.nextFloat() < 0.5) continue;
    const existing = parts.find((p) => p.partId === part.partId);
    if (existing) existing.count += part.count;
    else parts.push({ ...part, modifiers: part.modifiers ? [...part.modifiers] : undefined });
  }
  return {
    chassisId: a.chassisId,
    parts,
    armourPlates: rng.nextFloat() < 0.5 ? a.armourPlates : b.armourPlates,
  };
}
```

Then tighten `archive.ts`: change `ArchiveEntry<G = unknown>` to import the genome type properly —

```ts
import type { Genome } from './breeding.js';
export interface ArchiveEntry { build: Build; descriptors: BuildDescriptors; fitness: number; genome: Genome | null; }
export class BuildArchive { /* drop the <G> parameter throughout */ }
```

(`breeding.ts` does not import `archive.ts`, so this is a type-only edge with no cycle.) Update `archive.test.ts`'s three `genome: null` literals — they already pass `null`, so no test change is needed.

Add `export * from './breeding.js';` to `packages/sim/src/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run sim:test -- breeding archive && npm run sim:build`
Expected: PASS. `sim:build` proves the `archive.ts` ↔ `breeding.ts` type edge is not a cycle.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/breeding.ts packages/sim/src/archive.ts packages/sim/src/index.ts packages/sim/test/breeding.test.ts
git commit -m "Draw a lock, and let a wish be the thing that evolves"
```

---

### Task 7: The tier-laddered search

Spec §3b, §3d. Cost is the number of battles, so the largest saving is a warm start, not a cleverer algorithm.

**Files:**
- Modify: `packages/sim/src/breeding.ts` (append)
- Test: `packages/sim/test/breeding.test.ts` (append)

**Interfaces:**
- Consumes: `Genome`, `Lock`, `develop`, `mutate`, `crossover`, `genomeKey` (Task 6); `BuildArchive`, `describeBuild` (Task 4); `screenFitness`, `confirmFitness` (Task 5); `computeRank` (Task 2).
- Produces:
  - `RankResult = { rank: number; chassisId: string; archive: BuildArchive; ceiling: number; best: ArchiveEntry | null; evaluations: number; legalFound: number }`
  - `searchRank(opts: { lock: Lock; chassisId: string; rank: number; seed: number; budget?: number; warmStart?: Genome[]; score?: (g: Genome, r: number) => number | null }): RankResult`
  - `searchLadder(opts: { lock: Lock; chassisId: string; ranks: number[]; seed: number; budget?: number; onRank?: (r: RankResult) => void }): RankResult[]`
  - `DEFAULT_SCREEN_BUDGET = 600`
  Tasks 8, 9, 11 consume these.

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/test/breeding.test.ts`:

```ts
import { searchLadder, searchRank, DEFAULT_SCREEN_BUDGET } from '../src/breeding.js';
import { computeRank } from '../src/rank.js';

describe('the search climbs a tier ladder', () => {
  // A stub scorer: no battles, so these run in milliseconds and test the
  // SEARCH rather than the sim. It rewards rank, which makes the ceiling
  // predictable without asserting anything about combat.
  const scorerFor = (lock: ReturnType<typeof drawLock>) =>
    (genome: Genome, rank: number): number | null => {
      const report = develop(genome, lock, rank);
      return report.legal ? Math.min(1, computeRank(report.build) / 40) : null;
    };

  it('never returns a build over its rank cap', () => {
    const lock = drawLock(5);
    const result = searchRank({ lock, chassisId: 'CH-5', rank: 12, seed: 1, budget: 60, score: scorerFor(lock) });
    for (const entry of result.archive.entries()) {
      expect(computeRank(entry.build)).toBeLessThanOrEqual(12);
    }
    expect(result.ceiling).toBeGreaterThanOrEqual(0);
  });

  it('spends no more than its budget', () => {
    const lock = drawLock(5);
    const result = searchRank({ lock, chassisId: 'CH-5', rank: 12, seed: 1, budget: 40, score: scorerFor(lock) });
    expect(result.evaluations).toBeLessThanOrEqual(40);
  });

  it('reproduces exactly from the same seed', () => {
    const lock = drawLock(5);
    const opts = { lock, chassisId: 'CH-9', rank: 14, seed: 3, budget: 50, score: scorerFor(lock) };
    const a = searchRank({ ...opts });
    const b = searchRank({ ...opts });
    expect(a.ceiling).toBe(b.ceiling);
    expect(a.best && genomeKey(a.best.genome!)).toBe(b.best && genomeKey(b.best.genome!));
  });

  // The ONLY test here that runs real battles — `searchLadder` has no `score`
  // injection point, because the warm start is the thing being tested and the
  // archive it hands forward only exists on the production path. Budget 12 x 3
  // ranks is ~35 screens, about 16 s. Keep it small; do not raise the budget to
  // make it more convincing.
  it('warm-starts each rank from the one below it', { timeout: 120_000 }, () => {
    const lock = drawLock(5);
    const seen: number[] = [];
    const results = searchLadder({
      lock, chassisId: 'CH-5', ranks: [8, 10, 12], seed: 2, budget: 12,
      onRank: (r) => seen.push(r.rank),
    });
    expect(seen).toEqual([8, 10, 12]);
    expect(results).toHaveLength(3);
    // Rank 10 was seeded from rank 8's archive, so it cannot do worse than the
    // rank-8 ceiling: a rank-8 build is a legal rank-10 build.
    expect(results[1]!.ceiling).toBeGreaterThanOrEqual(results[0]!.ceiling);
  });

  it('records that a lock produced nothing legal, rather than throwing', () => {
    // A lock of pure armour on a tiny rank: no weapon, no reactor, no mech.
    const barren = { seed: 0, parts: ['U-ARM'], mods: [] };
    const result = searchRank({ lock: barren, chassisId: 'CH-2', rank: 3, seed: 1, budget: 20, score: scorerFor(barren) });
    expect(result.legalFound).toBe(0);
    expect(result.best).toBeNull();
    expect(result.ceiling).toBe(0);
  });

  it('has a default budget worth stating', () => {
    expect(DEFAULT_SCREEN_BUDGET).toBe(600);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:test -- breeding`
Expected: FAIL — `searchRank is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/sim/src/breeding.ts`:

```ts
import { BuildArchive, describeBuild, type ArchiveEntry } from './archive.js';
import { confirmFitness, screenFitness } from './panel.js';
import { computeRank } from './rank.js';

/**
 * Screens per (chassis, rank). One screen is ~0.45 s (3 opponents x 1 seed),
 * so 600 is ~4.5 minutes single-threaded — see the plan's Sizing table. The
 * script exposes `--budget` so a smoke run costs seconds.
 */
export const DEFAULT_SCREEN_BUDGET = 600;

/** Below this rank the space is small enough to enumerate, which gives a GUARANTEED ceiling. */
const EXHAUSTIVE_RANK = 8;

export interface RankResult {
  rank: number;
  chassisId: string;
  archive: BuildArchive;
  /** Best win rate FOUND. Not the best that exists — see spec §7. */
  ceiling: number;
  best: ArchiveEntry | null;
  evaluations: number;
  legalFound: number;
}

/**
 * Every one-part and two-part wish the lock allows. At low ranks this is small
 * enough to walk completely, and that is exactly where I1 is anchored, so the
 * anchor is a guarantee rather than a lucky draw.
 */
function enumerateGenomes(lock: Lock, chassisId: string): Genome[] {
  const out: Genome[] = [];
  for (const a of lock.parts) {
    for (const count of [1, 2]) {
      for (const modifiers of [undefined, ...legalModsFor(a, lock).map((id) => [id])]) {
        for (const armourPlates of [0, 2]) {
          out.push({ chassisId, parts: [{ partId: a, count, modifiers }], armourPlates });
        }
      }
    }
  }
  for (const a of lock.parts) {
    for (const b of lock.parts) {
      if (a >= b) continue;
      for (const armourPlates of [0, 2]) {
        out.push({ chassisId, parts: [{ partId: a, count: 1 }, { partId: b, count: 1 }], armourPlates });
      }
    }
  }
  return out;
}

/**
 * Find the best build at one rank on one chassis.
 *
 * `score` exists so tests can drive the search without battles; production
 * leaves it out and pays for `screenFitness`. It returns null for a genome that
 * did not develop into a legal mech.
 */
export function searchRank(opts: {
  lock: Lock;
  chassisId: string;
  rank: number;
  seed: number;
  budget?: number;
  warmStart?: Genome[];
  score?: (genome: Genome, rank: number) => number | null;
}): RankResult {
  const budget = opts.budget ?? DEFAULT_SCREEN_BUDGET;
  const rng = new Pcg32(opts.seed * 1000 + opts.rank);
  const archive = new BuildArchive();
  const seen = new Set<string>();
  const scored: { genome: Genome; fitness: number }[] = [];
  let evaluations = 0;
  let legalFound = 0;

  const evaluate = (genome: Genome): void => {
    const key = genomeKey(genome);
    if (seen.has(key) || evaluations >= budget) return;
    seen.add(key);
    evaluations++;
    if (opts.score) {
      const fitness = opts.score(genome, opts.rank);
      if (fitness === null) return;
      legalFound++;
      scored.push({ genome, fitness });
      // With a stub scorer there is no build to describe, so nothing is
      // archived; the ceiling still tracks. Production always takes the branch
      // below, which does archive.
      return;
    }
    const report = develop(genome, opts.lock, opts.rank);
    if (!report.legal) return;
    if (computeRank(report.build) > opts.rank) return;
    legalFound++;
    // The battle seed derives from the candidate, never from the order it was
    // evaluated (spec §3e): a parallel sweep must reproduce a serial one.
    const fitness = screenFitness(report.build, hashKey(key));
    scored.push({ genome, fitness });
    archive.insert({ build: report.build, descriptors: describeBuild(report.build), fitness, genome });
  };

  // Warm start first: rank R-1's elites are the best guesses rank R has.
  for (const genome of opts.warmStart ?? []) evaluate(genome);
  if (opts.rank <= EXHAUSTIVE_RANK) {
    for (const genome of enumerateGenomes(opts.lock, opts.chassisId)) evaluate(genome);
  }
  // Then hill-climb from whatever is best so far.
  while (evaluations < budget) {
    const before = evaluations;
    if (scored.length === 0) {
      evaluate(mutate({ chassisId: opts.chassisId, parts: [], armourPlates: 0 }, opts.lock, rng));
    } else {
      const elites = [...scored].sort((a, b) => b.fitness - a.fitness).slice(0, 8);
      const parent = elites[Math.floor(rng.nextFloat() * elites.length)]!.genome;
      if (elites.length > 1 && rng.nextFloat() < 0.3) {
        const other = elites[Math.floor(rng.nextFloat() * elites.length)]!.genome;
        evaluate(crossover(parent, other, rng));
      } else {
        evaluate(mutate(parent, opts.lock, rng));
      }
    }
    // A run of duplicate genomes would spin forever without this.
    if (evaluations === before) { evaluations++; }
  }

  const best = archive.best() ?? null;
  const ceiling = best?.fitness ?? (scored.length > 0 ? Math.max(...scored.map((s) => s.fitness)) : 0);
  return { rank: opts.rank, chassisId: opts.chassisId, archive, ceiling, best, evaluations, legalFound };
}

/** FNV-1a over the genome key: a stable, order-independent battle seed. */
function hashKey(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Walk the ladder. Rank R seeds from rank R-1's archive, which is both the
 * cheapest warm start available (a rank-6 build is usually a rank-5 build plus
 * a part) and a mirror of the invariant being tested: the ladder is
 * constructed, then checked.
 */
export function searchLadder(opts: {
  lock: Lock;
  chassisId: string;
  ranks: number[];
  seed: number;
  budget?: number;
  onRank?: (result: RankResult) => void;
}): RankResult[] {
  const results: RankResult[] = [];
  let warmStart: Genome[] = [];
  for (const rank of [...opts.ranks].sort((a, b) => a - b)) {
    const result = searchRank({
      lock: opts.lock, chassisId: opts.chassisId, rank, seed: opts.seed,
      budget: opts.budget, warmStart,
    });
    results.push(result);
    opts.onRank?.(result);
    warmStart = result.archive.entries()
      .map((entry) => entry.genome)
      .filter((genome): genome is Genome => genome !== null);
  }
  return results;
}
```

Note the test passes `score`, so `searchLadder`'s production path (no `score`) is exercised by Task 9's smoke run, not here — that is deliberate, because a real ladder costs minutes and a unit test must not.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run sim:test -- breeding`
Expected: PASS in about 20 s. Every test but one uses the stub scorer and runs
no battles; the warm-start test exercises the production path and is the whole
of that time.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/breeding.ts packages/sim/test/breeding.test.ts
git commit -m "Climb the rank ladder instead of searching each rung cold"
```

---

### Task 8: The invariants, saturation, and what correct building is worth

Spec §2. These are the deliverable — three falsifiable statements and one headline number.

**Files:**
- Create: `packages/sim/src/invariants.ts`
- Modify: `packages/sim/src/index.ts`
- Test: `packages/sim/test/invariants.test.ts` (create)

**Interfaces:**
- Consumes: `RankResult` (Task 7), `BuildArchive` (Task 4), `evaluateMatchup` (`adaptation.ts`), `LADDER_SPAWN_DISTANCES_M` (Task 5), `computeRank`, `MODIFIERS`, `PARTS`.
- Produces:
  - `I1_THRESHOLD_PLUS2 = 0.75`, `I1_THRESHOLD_PLUS1 = 0.6`, `I2_MAX_SPREAD = 0.08`, `K_COIN_FLIP = 0.5`
  - `bestVsBest(a: Build, b: Build, seeds?: number): number` — across every spawn distance and both sides
  - `checkRankMonotonicity(results: RankResult[], seeds?: number): I1Finding[]` where `I1Finding = { chassisId: string; lowRank: number; highRank: number; gap: 1|2; winRate: number; threshold: number; pass: boolean }`
  - `saturationRank(results: RankResult[]): number | null`
  - `checkChassisParity(byChassis: Map<string, RankResult[]>): I2Finding[]` where `I2Finding = { rank: number; spread: number; best: string; worst: string; pass: boolean; aboveSaturation: string[] }`
  - `checkCoverage(archives: BuildArchive[]): { deadParts: string[]; deadMods: string[]; usage: Map<string, number> }`
  - `ranksOfCorrectBuilding(results: RankResult[], fromRank: number, seeds?: number): { k: number | null; ladder: { rank: number; winRate: number }[] }`
  Task 9 consumes all of it.

- [ ] **Step 1: Write the failing test**

Create `packages/sim/test/invariants.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  I1_THRESHOLD_PLUS1, I1_THRESHOLD_PLUS2, I2_MAX_SPREAD,
  bestVsBest, checkChassisParity, checkCoverage, checkRankMonotonicity,
  ranksOfCorrectBuilding, saturationRank,
} from '../src/invariants.js';
import { BuildArchive, describeBuild } from '../src/archive.js';
import { assembleBuild } from '../src/workbench.js';
import type { RankResult } from '../src/breeding.js';

const buildOf = (chassisId: string, partId: string, count: number) =>
  assembleBuild({ chassisId, parts: [{ partId, count }] }).build;

/** A RankResult with a hand-set ceiling — these functions read archives, they run no search. */
const fake = (chassisId: string, rank: number, ceiling: number, build = buildOf('CH-5', 'W-AC', 2)): RankResult => {
  const archive = new BuildArchive();
  archive.insert({ build, descriptors: describeBuild(build), fitness: ceiling, genome: null });
  return { rank, chassisId, archive, ceiling, best: archive.best()!, evaluations: 0, legalFound: 1 };
};

describe('I1 — a higher rank should beat a lower one', () => {
  it('measures best vs best across every spawn distance, both sides', () => {
    const rate = bestVsBest(buildOf('CH-9', 'W-AC', 2), buildOf('CH-2', 'W-MG', 1), 1);
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
    expect(bestVsBest(buildOf('CH-9', 'W-AC', 2), buildOf('CH-2', 'W-MG', 1), 1)).toBe(rate);
  });

  it('holds a +2 pair to the higher threshold than a +1 pair', () => {
    expect(I1_THRESHOLD_PLUS2).toBeGreaterThan(I1_THRESHOLD_PLUS1);
    const findings = checkRankMonotonicity([fake('CH-5', 8, 0.4), fake('CH-5', 9, 0.5), fake('CH-5', 10, 0.6)], 1);
    const plus2 = findings.find((f) => f.gap === 2);
    const plus1 = findings.find((f) => f.gap === 1);
    expect(plus2?.threshold).toBe(I1_THRESHOLD_PLUS2);
    expect(plus1?.threshold).toBe(I1_THRESHOLD_PLUS1);
    expect(plus2?.pass).toBe(plus2!.winRate >= I1_THRESHOLD_PLUS2);
  });
});

describe('saturation is where a chassis stops being able to spend', () => {
  it('names the rank after which the ceiling stops climbing for two ranks', () => {
    const results = [
      fake('CH-2', 6, 0.30), fake('CH-2', 8, 0.45), fake('CH-2', 10, 0.60),
      fake('CH-2', 12, 0.60), fake('CH-2', 14, 0.59),
    ];
    expect(saturationRank(results)).toBe(10);
  });

  it('returns null when the ceiling is still climbing at the top', () => {
    expect(saturationRank([fake('CH-9', 6, 0.2), fake('CH-9', 8, 0.4), fake('CH-9', 10, 0.6)])).toBeNull();
  });
});

describe('I2 — chassis parity, below saturation', () => {
  it('flags a spread wider than 8 points and names both ends', () => {
    const byChassis = new Map([
      ['CH-2', [fake('CH-2', 10, 0.40)]],
      ['CH-5', [fake('CH-5', 10, 0.62)]],
    ]);
    const [finding] = checkChassisParity(byChassis);
    expect(finding!.spread).toBeCloseTo(0.22, 5);
    expect(finding!.pass).toBe(false);
    expect(finding!.worst).toBe('CH-2');
    expect(finding!.best).toBe('CH-5');
    expect(I2_MAX_SPREAD).toBe(0.08);
  });

  it('passes a spread inside the band', () => {
    const byChassis = new Map([
      ['CH-2', [fake('CH-2', 10, 0.55)]],
      ['CH-5', [fake('CH-5', 10, 0.60)]],
    ]);
    expect(checkChassisParity(byChassis)[0]!.pass).toBe(true);
  });
});

describe('I3 — no dead gear', () => {
  it('names gear that appears in no elite, and excludes U-AMMO by declaration', () => {
    const archive = new BuildArchive();
    const b = buildOf('CH-5', 'W-AC', 2);
    archive.insert({ build: b, descriptors: describeBuild(b), fitness: 0.5, genome: null });
    const coverage = checkCoverage([archive]);
    expect(coverage.deadParts).not.toContain('W-AC');
    expect(coverage.deadParts).not.toContain('U-AMMO');
    expect(coverage.deadParts).toContain('W-RG');
    expect(coverage.usage.get('W-AC')).toBeGreaterThan(0);
  });
});

describe('the headline: how many ranks of enemy correct building is worth', () => {
  it('reports the first k at which the win rate falls to a coin flip or below', () => {
    const results = [fake('CH-5', 10, 0.5), fake('CH-5', 11, 0.5), fake('CH-5', 12, 0.5)];
    const measured = ranksOfCorrectBuilding(results, 10, 1);
    expect(measured.ladder.length).toBeGreaterThan(0);
    expect(measured.k === null || measured.k >= 1).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:test -- invariants`
Expected: FAIL — `Cannot find module '../src/invariants.js'`.

- [ ] **Step 3: Write the implementation**

Create `packages/sim/src/invariants.ts`:

```ts
/**
 * The three invariants, and the one headline number (spec §2).
 *
 * These read archives. They run no search — which matters, because it means the
 * thresholds can be re-argued and re-checked without re-breeding anything.
 *
 * EVERY RESULT IS A LOWER BOUND. A search finds *a* ceiling, not *the* ceiling
 * (spec §7): failing to find a strong rank-3 build is not proof that none
 * exists. So **I1 failing is stronger evidence than I1 passing**, and anything
 * that prints these numbers must say "best found".
 */
import type { Build } from './types.js';
import type { RankResult } from './breeding.js';
import type { BuildArchive } from './archive.js';
import { PARTS } from './catalog.js';
import { MODIFIERS } from './modifiers.js';
import { LADDER_SPAWN_DISTANCES_M } from './ladder.js';
import { runBattle } from './combat.js';

/** Provisional (spec §2). The first sweep is expected to argue with all four. */
export const I1_THRESHOLD_PLUS2 = 0.75;
export const I1_THRESHOLD_PLUS1 = 0.6;
export const I2_MAX_SPREAD = 0.08;
export const K_COIN_FLIP = 0.5;

/** Excluded from I3 by declaration: a deliberate placeholder (docs/19). */
export const COVERAGE_EXEMPT_PARTS = new Set(['U-AMMO']);

/**
 * Best-versus-best across every spawn distance in `LADDER_SPAWN_DISTANCES_M`
 * and both spawn sides. Not every pairing: an individual high-rank sniper
 * losing to a low-rank brawler that starts inside its minimum range is the
 * range game working correctly, and I1 is not about that.
 */
export function bestVsBest(a: Build, b: Build, seeds = 4): number {
  let wins = 0;
  let fights = 0;
  for (const spawnDistanceM of LADDER_SPAWN_DISTANCES_M) {
    for (let s = 0; s < seeds; s++) {
      for (const flip of [false, true]) {
        const report = runBattle({
          builds: flip ? [b, a] : [a, b],
          seed: 5_000_000 + spawnDistanceM * 1000 + s,
          spawnDistanceM,
          recordFrames: false,
        });
        fights++;
        if (report.winner !== 'draw' && (report.winner === 0) === !flip) wins++;
      }
    }
  }
  return fights === 0 ? 0 : wins / fights;
}

export interface I1Finding {
  chassisId: string;
  lowRank: number;
  highRank: number;
  gap: 1 | 2;
  winRate: number;
  threshold: number;
  pass: boolean;
}

export function checkRankMonotonicity(results: RankResult[], seeds = 4): I1Finding[] {
  const sorted = [...results].sort((x, y) => x.rank - y.rank);
  const findings: I1Finding[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (const gap of [1, 2] as const) {
      const low = sorted[i];
      const high = sorted[i + gap];
      if (!low?.best || !high?.best) continue;
      const threshold = gap === 2 ? I1_THRESHOLD_PLUS2 : I1_THRESHOLD_PLUS1;
      const winRate = bestVsBest(high.best.build, low.best.build, seeds);
      findings.push({
        chassisId: high.chassisId, lowRank: low.rank, highRank: high.rank,
        gap, winRate, threshold, pass: winRate >= threshold,
      });
    }
  }
  return findings;
}

/**
 * The rank at which a chassis stops being able to spend more: the lowest rank
 * whose ceiling is not improved on by either of the next two, or where no legal
 * build exists at all. Null means the ceiling was still climbing at the top of
 * the range searched, so saturation is beyond it.
 *
 * A first-class output in its own right (spec §2b). Asserting parity above
 * saturation would be asserting something impossible: the Vulture has 16 cells
 * against the Bastion's 56.
 */
export function saturationRank(results: RankResult[]): number | null {
  const sorted = [...results].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i++) {
    const here = sorted[i]!;
    if (here.legalFound === 0) return here.rank;
    const next = sorted.slice(i + 1, i + 3);
    if (next.length < 2) break;
    if (next.every((r) => r.ceiling <= here.ceiling)) return here.rank;
  }
  return null;
}

export interface I2Finding {
  rank: number;
  spread: number;
  best: string;
  worst: string;
  pass: boolean;
  /** Chassis excluded from this rank's comparison because they had saturated. */
  aboveSaturation: string[];
}

export function checkChassisParity(byChassis: Map<string, RankResult[]>): I2Finding[] {
  const saturation = new Map([...byChassis].map(([id, rs]) => [id, saturationRank(rs)]));
  const ranks = [...new Set([...byChassis.values()].flat().map((r) => r.rank))].sort((a, b) => a - b);
  const findings: I2Finding[] = [];
  for (const rank of ranks) {
    const included: { id: string; ceiling: number }[] = [];
    const aboveSaturation: string[] = [];
    for (const [id, results] of byChassis) {
      const at = results.find((r) => r.rank === rank);
      if (!at) continue;
      const sat = saturation.get(id);
      if (sat !== null && sat !== undefined && rank > sat) { aboveSaturation.push(id); continue; }
      included.push({ id, ceiling: at.ceiling });
    }
    if (included.length < 2) continue;
    const best = included.reduce((top, c) => (c.ceiling > top.ceiling ? c : top));
    const worst = included.reduce((low, c) => (c.ceiling < low.ceiling ? c : low));
    const spread = best.ceiling - worst.ceiling;
    findings.push({ rank, spread, best: best.id, worst: worst.id, pass: spread <= I2_MAX_SPREAD, aboveSaturation });
  }
  return findings;
}

export function checkCoverage(archives: BuildArchive[]): {
  deadParts: string[];
  deadMods: string[];
  usage: Map<string, number>;
} {
  const usage = new Map<string, number>();
  for (const archive of archives) {
    for (const entry of archive.entries()) {
      for (const part of entry.build.parts) {
        usage.set(part.partId, (usage.get(part.partId) ?? 0) + 1);
        for (const modId of part.modifiers ?? []) usage.set(modId, (usage.get(modId) ?? 0) + 1);
      }
    }
  }
  const deadParts = Object.keys(PARTS)
    .filter((id) => !COVERAGE_EXEMPT_PARTS.has(id) && !usage.has(id));
  const deadMods = Object.values(MODIFIERS)
    .filter((def) => def.kind === 'mod' && !usage.has(def.id))
    .map((def) => def.id);
  return { deadParts, deadMods, usage };
}

/**
 * The headline (spec §2d): take the best build at `fromRank`, fight it against
 * the best builds above it, and report the smallest k at which its win rate
 * falls to a coin flip or below. That k is how many ranks of enemy a well-built
 * mech is worth, and it is exactly what `ladderBudgetPerNode` should be set
 * from — a dial docs/16 has argued over four times with no way to settle it.
 *
 * CAVEAT THAT MUST APPEAR IN THE REPORT: both sides are flown by the same
 * autopilot, so this measures correct BUILDING, not correct PILOTING. A human
 * who kites better than the autopilot is worth more than k; one who does not is
 * worth less.
 */
export function ranksOfCorrectBuilding(
  results: RankResult[], fromRank: number, seeds = 4,
): { k: number | null; ladder: { rank: number; winRate: number }[] } {
  const sorted = [...results].sort((a, b) => a.rank - b.rank);
  const base = sorted.find((r) => r.rank === fromRank);
  if (!base?.best) return { k: null, ladder: [] };
  const ladder: { rank: number; winRate: number }[] = [];
  let k: number | null = null;
  for (const above of sorted.filter((r) => r.rank > fromRank)) {
    if (!above.best) continue;
    const winRate = bestVsBest(base.best.build, above.best.build, seeds);
    ladder.push({ rank: above.rank, winRate });
    if (k === null && winRate <= K_COIN_FLIP) k = above.rank - fromRank;
  }
  return { k, ladder };
}
```

Add `export * from './invariants.js';` to `packages/sim/src/index.ts`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run sim:test -- invariants`
Expected: PASS. This file does run real battles (`bestVsBest` at `seeds: 1`), so expect it to take 10–30 s — that is the reason every test here passes `1`.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/invariants.ts packages/sim/src/index.ts packages/sim/test/invariants.test.ts
git commit -m "State the three invariants as numbers that can fail"
```

---

### Task 9: `sim:breed` — the sweep and its five reports

Spec §5. One sweep, five outputs.

**Files:**
- Create: `packages/sim/scripts/breed.ts`
- Modify: `packages/sim/package.json` (add `"breed"`), root `package.json` (add `"sim:breed"`)

**Interfaces:**
- Consumes: everything from Tasks 2, 4, 5, 6, 7, 8.
- Produces: `npm run sim:breed`, and a `SweepReport` JSON shape (see Step 3) written by `--json`.

- [ ] **Step 1: Write the failing test**

This is a script, so its test is a smoke run rather than a vitest file — the same shape `sim:try` uses. Add the script entries first so the command exists:

`packages/sim/package.json` scripts: `"breed": "node --import tsx scripts/breed.ts"`
Root `package.json` scripts: `"sim:breed": "npm run breed --workspace=@mechbattler/sim --"`

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:breed -- --help`
Expected: FAIL — `Cannot find module .../scripts/breed.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/sim/scripts/breed.ts`:

```ts
/**
 * `npm run sim:breed` — breed the best mech at each rank on each chassis, then
 * check the three invariants against what it found (spec §5).
 *
 *   npm run sim:breed -- --locks 1 --budget 40 --ranks 8,12        # smoke, seconds
 *   npm run sim:breed -- --locks 20 --json artifacts/breed.json    # the real sweep
 *
 * This is a "kick it off and come back" tool. One screen is ~0.45 s and the
 * default budget is 600 screens per (chassis, rank), so a full sweep is
 * minutes-to-an-hour depending on rationing and worker count. Start with
 * --budget 40 to prove the wiring, then spend.
 */
import {
  ALL_CELL_KEYS, CHASSIS, confirmFitness,
  checkChassisParity, checkCoverage, checkRankMonotonicity, drawLock,
  panelStamp, ranksOfCorrectBuilding, saturationRank, searchLadder,
  type RankResult,
} from '../src/index.js';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(name);
const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const num = (name: string, fallback: number) => { const v = value(name); return v ? Number(v) : fallback; };

if (flag('--help')) {
  console.log(`Usage: npm run sim:breed -- [options]

Options:
  --locks <n>        how many random gear locks to sweep (default 4)
  --seed <n>         base seed (default 1)
  --ranks <a,b,c>    ranks to breed at (default 6,8,10,12,14,16,18,20)
  --chassis <ids>    comma-separated (default every enabled chassis)
  --budget <n>       screens per chassis/rank (default 600 — see spec §7 sizing)
  --confirm-seeds <n> seeds when re-fighting an elite on the full panel (default 6)
  --json <path>      write the machine-readable report
`);
  process.exit(0);
}

const locks = num('--locks', 4);
const baseSeed = num('--seed', 1);
const ranks = (value('--ranks') ?? '6,8,10,12,14,16,18,20').split(',').map(Number);
const chassisIds = (value('--chassis') ?? Object.keys(CHASSIS).join(',')).split(',');
const budget = num('--budget', 600);
const confirmSeeds = num('--confirm-seeds', 6);

const stamp = panelStamp();
const started = Date.now();
const perLock: {
  lock: ReturnType<typeof drawLock>;
  byChassis: Map<string, RankResult[]>;
}[] = [];

for (let l = 0; l < locks; l++) {
  const lock = drawLock(baseSeed * 7919 + l);
  const byChassis = new Map<string, RankResult[]>();
  for (const chassisId of chassisIds) {
    process.stderr.write(`lock ${l + 1}/${locks} ${chassisId} `);
    const results = searchLadder({
      lock, chassisId, ranks, seed: baseSeed + l, budget,
      onRank: (r) => process.stderr.write(r.legalFound === 0 ? '-' : '.'),
    });
    process.stderr.write('\n');
    byChassis.set(chassisId, results);
  }
  perLock.push({ lock, byChassis });
}

// Confirm: anything that claimed a cell is re-fought on the full panel, at
// higher seeds, for the report. The screen was 3 opponents x 1 seed and is not
// a number worth publishing.
for (const { byChassis } of perLock) {
  for (const results of byChassis.values()) {
    for (const result of results) {
      if (!result.best) continue;
      result.ceiling = confirmFitness(result.best.build, result.rank, confirmSeeds).overall;
      result.best.fitness = result.ceiling;
    }
  }
}

const allResults = perLock.flatMap((p) => [...p.byChassis.values()].flat());
const allArchives = allResults.map((r) => r.archive);

// 1. Invariants.
const i1 = perLock.flatMap((p) => [...p.byChassis.values()].flatMap((rs) => checkRankMonotonicity(rs)));
const i2 = perLock.flatMap((p) => checkChassisParity(p.byChassis));
const i3 = checkCoverage(allArchives);

// 2. Saturation, per chassis, per lock.
const saturation = perLock.flatMap((p, l) => [...p.byChassis]
  .map(([chassisId, rs]) => ({ lock: l, chassisId, rank: saturationRank(rs) })));

// 3. The ceiling curve.
const ceilings = allResults.map((r) => ({ chassisId: r.chassisId, rank: r.rank, ceiling: r.ceiling, legalFound: r.legalFound }));

// 5. The headline.
const headline = perLock.flatMap((p) => [...p.byChassis].map(([chassisId, rs]) => ({
  chassisId, ...ranksOfCorrectBuilding(rs, ranks[0]!),
})));

const report = {
  stamp,
  parameters: { locks, baseSeed, ranks, chassisIds, budget, confirmSeeds },
  elapsedS: (Date.now() - started) / 1000,
  invariants: { i1, i2, i3: { deadParts: i3.deadParts, deadMods: i3.deadMods } },
  saturation,
  ceilings,
  gallery: perLock.flatMap((p, l) => [...p.byChassis].flatMap(([chassisId, rs]) => rs.flatMap((r) =>
    [...r.archive.cells()].map(([cell, entry]) => ({
      lock: l, chassisId, rank: r.rank, cell,
      fitness: entry.fitness,
      descriptors: entry.descriptors,
      parts: entry.build.parts.map((part) => ({ partId: part.partId, modifiers: part.modifiers })),
    }))))),
  emptyCells: ALL_CELL_KEYS.filter((key) => !allArchives.some((a) => a.cells().has(key))),
  coverage: [...i3.usage].sort((a, b) => b[1] - a[1]),
};

if (value('--json')) writeFileSync(value('--json')!, JSON.stringify(report, null, 2));

// ---- Human-readable, in the order spec §5 lists them ----
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`\nsim:breed — ${locks} lock(s), ${chassisIds.join('/')}, ranks ${ranks.join(',')}`);
console.log(`content hash ${stamp.contentHash} — results are comparable only while the catalog holds still.`);
console.log(`Every ceiling below is the BEST FOUND, not the best that exists: a failing invariant is`);
console.log(`stronger evidence than a passing one (spec §7).\n`);

console.log('1. INVARIANTS');
const i1Fail = i1.filter((f) => !f.pass);
console.log(`  I1 rank monotonicity   ${i1.length - i1Fail.length}/${i1.length} pass`);
for (const f of i1Fail.slice(0, 10)) {
  console.log(`     FAIL ${f.chassisId} rank ${f.highRank} beats rank ${f.lowRank} only ${pct(f.winRate)} (wanted ${pct(f.threshold)})`);
}
const i2Fail = i2.filter((f) => !f.pass);
console.log(`  I2 chassis parity      ${i2.length - i2Fail.length}/${i2.length} pass`);
for (const f of i2Fail.slice(0, 10)) {
  console.log(`     FAIL rank ${f.rank}: ${f.best} ${pct(f.spread)} ahead of ${f.worst}`);
}
console.log(`  I3 no dead gear        ${i3.deadParts.length + i3.deadMods.length === 0 ? 'pass' : 'FAIL'}`);
if (i3.deadParts.length) console.log(`     parts nobody wanted: ${i3.deadParts.join(', ')}`);
if (i3.deadMods.length) console.log(`     mods nobody wanted:  ${i3.deadMods.join(', ')}`);

console.log('\n2. SATURATION — where a chassis stops being able to spend');
for (const s of saturation) console.log(`  ${s.chassisId.padEnd(6)} ${s.rank ?? 'still climbing at the top of the range searched'}`);

console.log('\n3. CEILING CURVE — does rank mean anything?');
for (const chassisId of chassisIds) {
  const row = ranks.map((rank) => {
    const at = ceilings.filter((c) => c.chassisId === chassisId && c.rank === rank);
    if (at.length === 0 || at.every((c) => c.legalFound === 0)) return '  -- ';
    return ` ${pct(Math.max(...at.map((c) => c.ceiling))).padStart(4)}`;
  }).join('');
  console.log(`  ${chassisId.padEnd(6)} ${ranks.map((r) => String(r).padStart(5)).join('')}`);
  console.log(`  ${' '.repeat(6)} ${row}`);
}

console.log('\n4. GALLERY — what each lock supported');
for (const entry of report.gallery.slice(0, 24)) {
  const guns = entry.parts.filter((p) => p.partId.startsWith('W-'))
    .map((p) => p.partId + (p.modifiers?.length ? `[${p.modifiers.join('+')}]` : '')).join(' ');
  console.log(`  ${entry.chassisId} r${String(entry.rank).padStart(2)} ${entry.cell.padEnd(22)} ${pct(entry.fitness).padStart(4)}  ${entry.descriptors.kill.padEnd(6)} ${guns}`);
}
if (report.emptyCells.length) console.log(`  never filled anywhere: ${report.emptyCells.join(', ')}`);

console.log('\n5. WHAT IS CORRECT BUILDING WORTH?');
for (const h of headline) {
  console.log(`  ${h.chassisId}: a best-built rank-${ranks[0]} mech falls to a coin flip against rank +${h.k ?? '(never, within the range searched)'}`);
}
console.log('  Both sides are flown by the same autopilot, so this measures correct BUILDING,');
console.log('  not correct PILOTING. A human who kites better than the autopilot is worth more.');
```

- [ ] **Step 4: Run the smoke sweep**

Run: `npm run sim:breed -- --locks 1 --budget 30 --ranks 8,10,12 --chassis CH-5`
Expected: completes in well under two minutes, prints all five sections, and the content hash matches `simContentHash()`. Then confirm the machine-readable path: `npm run sim:breed -- --locks 1 --budget 30 --ranks 8,10 --chassis CH-5 --json /tmp/breed.json && node -e "const r=require('/tmp/breed.json');console.log(r.stamp.contentHash, r.ceilings.length)"`.

**Then read the output.** A gallery whose every entry is the same three guns, or a ceiling row that is flat, is a finding to report — not a bug to fix by widening the budget.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/scripts/breed.ts packages/sim/package.json package.json
git commit -m "Breed a ladder of mechs and check the invariants against it"
```

---

### Task 10: `sim:compare` — two builds side by side

Spec §5. For answering "is this new gun actually different from that one".

**Files:**
- Create: `packages/sim/scripts/compare.ts`
- Modify: `packages/sim/src/archive.ts` (add `descriptorDistance`)
- Modify: `packages/sim/package.json`, root `package.json`
- Test: `packages/sim/test/archive.test.ts` (append)

**Interfaces:**
- Consumes: `describeBuild` (Task 4), `assembleBuild` (Task 3), `computeRank` (Task 2), `bestVsBest` (Task 8).
- Produces: `descriptorDistance(a: BuildDescriptors, b: BuildDescriptors): number` — 0 identical, 1 maximally different; and `npm run sim:compare`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/test/archive.test.ts`:

```ts
import { descriptorDistance } from '../src/archive.js';

describe('two builds can be told apart by a number', () => {
  it('scores a build against itself as zero', () => {
    const d = describeBuild(build('CH-5', 'W-AC', 2));
    expect(descriptorDistance(d, d)).toBe(0);
  });

  it('scores a light close brawler far from a heavy long sniper', () => {
    const close = describeBuild(build('CH-2', 'W-MG', 2));
    const long = describeBuild(build('CH-9', 'W-RG', 1));
    expect(descriptorDistance(close, long)).toBeGreaterThan(0.3);
    expect(descriptorDistance(close, long)).toBeLessThanOrEqual(1);
  });

  it('is symmetric', () => {
    const a = describeBuild(build('CH-2', 'W-MG', 2));
    const b = describeBuild(build('CH-9', 'W-AC', 2));
    expect(descriptorDistance(a, b)).toBeCloseTo(descriptorDistance(b, a), 10);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:test -- archive`
Expected: FAIL — `descriptorDistance is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `packages/sim/src/archive.ts`:

```ts
/**
 * How different two builds are, on the descriptors alone: 0 identical, 1
 * maximally different. Range is normalised against the long bucket's edge and
 * clamped, because "300 m vs 400 m" is not twice as different as "50 m vs
 * 150 m" — past the long threshold both are simply snipers.
 */
export function descriptorDistance(a: BuildDescriptors, b: BuildDescriptors): number {
  const range = Math.min(1, Math.abs(a.rangeM - b.rangeM) / RANGE_LONG_M);
  const weight = Math.min(1, Math.abs(a.loadFactor - b.loadFactor));
  const heat = a.heat === b.heat ? 0 : 1;
  const kill = a.kill === b.kill ? 0 : 1;
  return (range + weight + heat + kill) / 4;
}
```

Create `packages/sim/scripts/compare.ts`:

```ts
/**
 * `npm run sim:compare` — two builds side by side on all four descriptors,
 * their part and mod overlap, and one distance number (spec §5).
 *
 *   npm run sim:compare -- CH-5 W-AC:2 -- CH-9 W-BR:2
 *   npm run sim:compare -- CH-2 W-CB:2 -- CH-2 W-CB:2 --mod W-CB:cold-bore --fight
 *
 * Each side takes the same wish syntax as `sim:try`. `--` separates them.
 */
import {
  assembleBuild, bestVsBest, computeRank, describeBuild, descriptorDistance,
  PARTS, type WishPart,
} from '../src/index.js';

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
if (split < 0 || argv.includes('--help')) {
  console.log('Usage: npm run sim:compare -- <CHASSIS> <PART[:count]>... -- <CHASSIS> <PART[:count]>... [--fight]');
  process.exit(argv.includes('--help') ? 0 : 1);
}

const parseSide = (tokens: string[]) => {
  const mods = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '--mod') {
      const [partId, modId] = (tokens[++i] ?? '').split(':');
      if (partId && modId) mods.set(partId, [...(mods.get(partId) ?? []), modId]);
    } else if (!tokens[i]!.startsWith('--')) positional.push(tokens[i]!);
  }
  const chassisId = positional[0]!;
  const parts: WishPart[] = positional.slice(1).map((token) => {
    const [partId, count] = token.split(':');
    if (!partId || !PARTS[partId]) { console.error(`Unknown part ${partId}`); process.exit(1); }
    return { partId, count: count ? Number(count) : 1, modifiers: mods.get(partId) };
  });
  return assembleBuild({ chassisId, parts });
};

const left = parseSide(argv.slice(0, split));
const right = parseSide(argv.slice(split + 1));
const dl = describeBuild(left.build);
const dr = describeBuild(right.build);

const partIds = (report: typeof left) => new Set(report.build.parts.map((p) => p.partId));
const modIds = (report: typeof left) => new Set(report.build.parts.flatMap((p) => p.modifiers ?? []));
const overlap = (a: Set<string>, b: Set<string>) =>
  [...a].filter((id) => b.has(id));

const row = (label: string, l: string, r: string) =>
  console.log(`  ${label.padEnd(12)} ${l.padEnd(24)} ${r}`);

console.log(`\n  ${''.padEnd(12)} ${left.build.chassisId.padEnd(24)} ${right.build.chassisId}`);
row('rank', String(computeRank(left.build)), String(computeRank(right.build)));
row('range', `${dl.rangeM.toFixed(0)} m (${dl.range})`, `${dr.rangeM.toFixed(0)} m (${dr.range})`);
row('weight', `${dl.loadFactor.toFixed(2)} (${dl.weight})`, `${dr.loadFactor.toFixed(2)} (${dr.weight})`);
row('heat', `${dl.heatMarginKw.toFixed(1)} kW (${dl.heat})`, `${dr.heatMarginKw.toFixed(1)} kW (${dr.heat})`);
row('kills by', dl.kill, dr.kill);

const sharedParts = overlap(partIds(left), partIds(right));
const sharedMods = overlap(modIds(left), modIds(right));
console.log(`\n  shared parts: ${sharedParts.length ? sharedParts.join(', ') : 'none'}`);
console.log(`  shared mods:  ${sharedMods.length ? sharedMods.join(', ') : 'none'}`);
console.log(`\n  distance ${descriptorDistance(dl, dr).toFixed(2)}  (0 = the same mech, 1 = nothing in common)`);

if (argv.includes('--fight') && left.legal && right.legal) {
  const rate = bestVsBest(left.build, right.build, 2);
  console.log(`  head to head: left wins ${(rate * 100).toFixed(0)}% across every spawn distance, both sides`);
}
```

Add `"compare": "node --import tsx scripts/compare.ts"` to `packages/sim/package.json` and `"sim:compare": "npm run compare --workspace=@mechbattler/sim --"` to the root.

- [ ] **Step 4: Run the tests and the script**

Run: `npm run sim:test -- archive` — expected PASS.
Then: `npm run sim:compare -- CH-5 W-AC:2 -- CH-9 W-BR:2` — expected: a two-column table with a distance number, and no crash. **Read it**: if two obviously different mechs score under 0.2, the distance function is wrong and that is worth reporting before Task 12.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/scripts/compare.ts packages/sim/src/archive.ts packages/sim/test/archive.test.ts packages/sim/package.json package.json
git commit -m "Put two mechs side by side and give the difference a number"
```

---

### Task 11: Parallelism across worker threads

Spec §3e, §7. Without this a real sweep is hours. The sim is pure and holds no global state, and every battle seed already derives from the candidate rather than from evaluation order — so this is a scheduling change, not a semantic one.

**Files:**
- Create: `packages/sim/src/breedWorker.ts`
- Modify: `packages/sim/src/breeding.ts` (accept a `screen` injection point)
- Modify: `packages/sim/scripts/breed.ts` (add `--workers`)
- Test: `packages/sim/test/breeding.test.ts` (append)

**Interfaces:**
- Consumes: `searchLadder`, `Lock`, `Genome` (Tasks 6, 7).
- Produces: `screenBatch(genomes: Genome[], lock: Lock, rank: number): (number | null)[]` (the pure batch function the worker runs), and `searchLadderParallel(opts: Parameters<typeof searchLadder>[0] & { workers?: number }): Promise<RankResult[]>`.

- [ ] **Step 1: Write the failing test**

Append to `packages/sim/test/breeding.test.ts`:

```ts
import { screenBatch } from '../src/breeding.js';

describe('a batch of candidates can be screened off the main thread', () => {
  it('scores a batch identically to scoring one at a time', () => {
    const lock = drawLock(5);
    const genomes: Genome[] = lock.parts.slice(0, 3).map((partId) => ({
      chassisId: 'CH-5', parts: [{ partId, count: 1 }], armourPlates: 0,
    }));
    const batched = screenBatch(genomes, lock, 14);
    const again = screenBatch(genomes, lock, 14);
    expect(batched).toEqual(again);
    // Order in the batch must not change any score — that is what makes the
    // work distributable at all (spec §3e).
    const reversed = screenBatch([...genomes].reverse(), lock, 14);
    expect(reversed).toEqual([...batched].reverse());
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run sim:test -- breeding`
Expected: FAIL — `screenBatch is not a function`.

- [ ] **Step 3: Write the implementation**

Add to `packages/sim/src/breeding.ts`:

```ts
/**
 * Screen a batch of genomes. Pure: no shared state, no dependence on the order
 * of the batch — which is exactly what makes it safe to hand a slice of the
 * work to a worker thread (spec §3e, docs/11 §3). Returns null for a genome
 * that did not develop into a legal mech at or below the rank cap.
 */
export function screenBatch(genomes: Genome[], lock: Lock, rank: number): (number | null)[] {
  return genomes.map((genome) => {
    const report = develop(genome, lock, rank);
    if (!report.legal || computeRank(report.build) > rank) return null;
    return screenFitness(report.build, hashKey(genomeKey(genome)));
  });
}
```

Create `packages/sim/src/breedWorker.ts`:

```ts
/**
 * Worker-thread entry: screen one batch and post the scores back.
 *
 * Nothing here decides anything. The main thread owns the archive and the
 * search; a worker only converts genomes into win rates, which is where all the
 * time goes (~212 ms a battle, and a screen is three of them).
 */
import { parentPort, workerData } from 'node:worker_threads';
import { screenBatch, type Genome, type Lock } from './breeding.js';

const { genomes, lock, rank } = workerData as { genomes: Genome[]; lock: Lock; rank: number };
parentPort?.postMessage(screenBatch(genomes, lock, rank));
```

Then add `searchLadderParallel` to `breeding.ts`. It keeps the same tier-ladder structure and the same warm starts; the only difference is that each generation's candidates are proposed in a batch and screened across `workers` threads instead of one at a time:

```ts
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const WORKER_URL = new URL('./breedWorker.js', import.meta.url);

async function screenAcross(genomes: Genome[], lock: Lock, rank: number, workers: number): Promise<(number | null)[]> {
  if (workers <= 1 || genomes.length < workers * 2) return screenBatch(genomes, lock, rank);
  const size = Math.ceil(genomes.length / workers);
  const slices: Genome[][] = [];
  for (let i = 0; i < genomes.length; i += size) slices.push(genomes.slice(i, i + size));
  const results = await Promise.all(slices.map((slice) => new Promise<(number | null)[]>((resolve, reject) => {
    const worker = new Worker(fileURLToPath(WORKER_URL), {
      workerData: { genomes: slice, lock, rank },
      execArgv: ['--import', 'tsx'],
    });
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  return results.flat();
}
```

and a `searchLadderParallel` that mirrors `searchLadder` but proposes `workers * 4` candidates per generation, screens them with `screenAcross`, and inserts the legal ones into the archive exactly as `searchRank` does. **`searchRank`'s serial path stays**: it is what the tests drive and what `--workers 1` uses, and the parallel path must produce the same archive for the same seed and budget.

In `scripts/breed.ts`, add `--workers <n>` (default `Math.max(1, os.cpus().length - 1)`), make the sweep loop `await searchLadderParallel(...)`, and print the worker count in the header line.

- [ ] **Step 4: Verify determinism and speed**

Run: `npm run sim:test -- breeding` — expected PASS.
Then prove the parallel path agrees with the serial one:

```bash
npm run sim:breed -- --locks 1 --budget 60 --ranks 10 --chassis CH-5 --workers 1 --json /tmp/serial.json
npm run sim:breed -- --locks 1 --budget 60 --ranks 10 --chassis CH-5 --workers 4 --json /tmp/par.json
node -e "const a=require('/tmp/serial.json'),b=require('/tmp/par.json');
const k=r=>JSON.stringify(r.ceilings);
if(k(a)!==k(b)){console.error('PARALLEL DIVERGED FROM SERIAL');process.exit(1)}
console.log('agree; serial',a.elapsedS.toFixed(1),'s vs parallel',b.elapsedS.toFixed(1),'s')"
```

Expected: agreement, and the parallel run measurably faster. **A divergence here is a real bug** — it means a seed is being derived from evaluation order somewhere, which breaks the determinism contract. Do not paper over it by dropping the comparison.

- [ ] **Step 5: Commit**

```bash
git add packages/sim/src/breedWorker.ts packages/sim/src/breeding.ts packages/sim/scripts/breed.ts packages/sim/test/breeding.test.ts
git commit -m "Spread the battles across workers without moving a single seed"
```

---

### Task 12: Re-measure the ladder, and write down what the sweep found

Spec §6, §1b, §7. Changing `computeRank` to include mod tiers **changes generated opponents**, because the ladder generates by budget. Saved runs are unaffected — opponents are generated once and stored verbatim (`docs/13`) — but the difficulty curve moves and nobody has looked at where it landed.

**Files:**
- Modify: `docs/07-status-and-handoff.md`, `docs/17-balance-findings.md`, `docs/19-watchlist.md`, `CLAUDE.md`
- Create: `artifacts/breed-report.json`

- [ ] **Step 1: Run the full verify, then re-measure the ladder**

```bash
npm run verify
npm run game:balance -- 4
```

The per-depth target bands (round 1 `0.75–0.92`, round 4 `0.50–0.70`, round 7 `0.35–0.55`, rounds 10/12 `0.25–0.45`) were set on 25 Aug against a ladder where mods cost nothing. Record where each checkpoint lands now. **Do not re-tune `ladderBudgetPerNode` here** — that is a balance pass, it is a separate track (docs/07), and Task 12's job is to measure and record, not to move dials.

- [ ] **Step 2: Run a real sweep**

```bash
npm run sim:breed -- --locks 8 --json artifacts/breed-report.json
```

Then **read all five sections**. The three things most likely to be true and most worth writing down:

- The ceiling curve is flat or dips — Σ-tiers is the wrong rank function (spec §1b), which is worth more than any content fix.
- I2 fails badly on CH-2 — `docs/16` already suspects the Vulture's 13-tier carrying cap against the other frames' 30 is unpaid for, and the saturation rank is the number that says so.
- I3 names dead gear — the content pass's actual worklist.

- [ ] **Step 3: Write the findings down where they belong**

`docs/07-status-and-handoff.md` is the map of what is authoritative on what: add rank and the breeding tool, and point at `docs/17` for the numbers.

`docs/17-balance-findings.md` gets a new hand-written finding beside F1 and F2, naming what the sweep measured and — for F2 specifically — whether counting mods changed the −0.637 budget-to-win-rate correlation at all.

`docs/19-watchlist.md` gets three entries, because each is a knowing decision that wants revisiting with more evidence:

- **The provisional thresholds.** I1 at 0.75/0.60, I2 at 8 points, the bucket edges at 45/100 m and 0.5/0.8 load. Written down so the first sweep had something to disagree with; record what it actually said.
- **Tier does three jobs.** Scarcity, price and rank are now one number, so "rare but weak" is not expressible (spec §1a). Accepted knowingly; watch for a mod that wants it.
- **A unique's variant and quirks are free rank.** `computeRank` prices a unique at its mod's tier, because that is what spec §1 says. But a unique is also an extreme variant roll plus quirks, and none of that costs anything. If uniques start dominating archives at their nominal rank, this is why.

`CLAUDE.md` gains a short section beside "Trying a build without authoring one", in the same voice:

```markdown
## Asking what the gear can do

`npm run sim:breed` breeds the best mech at each rank on each chassis, from a
random slice of the catalog, and checks three things: a higher-rank mech should
beat a lower-rank one, chassis should be about equal at the same rank, and no
gear should be dead. `npm run sim:compare` puts two builds side by side.

Every ceiling it prints is the **best found**, not the best that exists. So a
failing invariant is real evidence and a passing one is only an absence of
counter-evidence — read the failures first.

The reference panel is built from the catalog you are editing, which is
circular and cannot be fixed, only stamped: every report records
`simContentHash()`. Comparing two reports with different hashes is indicative,
not a measurement.

Both mechs are flown by the same autopilot. It measures correct *building*,
never correct *piloting*.

Start with `--budget 40` to prove the wiring; the default budget is 600 screens
per chassis and rank, and a screen is about half a second.
```

- [ ] **Step 4: Verify the docs are honest**

Run: `npm run verify && npm run game:audit`
Expected: exits 0; `game:audit` reports `ok: true` with an empty `warnings` array. Confirm the two known report-only findings (`mule-fever-cycle` dominant, `gyrostabilized` dead) are still the only two — and note that if `gyrostabilized` now appears in an archive elite, I3 and the diversity harness disagree, which is itself a finding.

**Do not re-baseline `artifacts/balance-baseline.json`.** It was cut deliberately on 26 Aug before this work, and the whole point is that the swing from counting mods shows up as a changed file in review. Re-baselining to make a swing go away is the one thing the working agreement forbids.

- [ ] **Step 5: Commit**

```bash
git add docs CLAUDE.md artifacts/breed-report.json
git commit -m "Measure what rank is worth, and write down what the sweep found"
```

---

## Verification

The whole thing is done when all of these hold:

- `npm run verify` exits 0.
- `npm run game:audit` reports `ok: true` with an **empty** `warnings` array. A warning means an existing mod is outside the tier contract.
- `npm run sim:test` passes, including the five new test files (`rank`, `archive`, `panel`, `breeding`, `invariants`).
- `npm run sim:breed -- --locks 1 --budget 30 --ranks 8,10,12 --chassis CH-5` prints all five report sections and the content hash.
- The parallel/serial agreement check in Task 11 Step 4 reports `agree`.
- `npm run sim:compare -- CH-5 W-AC:2 -- CH-9 W-BR:2` prints a two-column table and a distance number.
- `npm run sim:try -- CH-5 W-AC:2` behaves exactly as it did before Task 3 — no `pool`, no `armourPlates`, same output.
- `npm run game:balance -- 4` has been run and its numbers recorded in `docs/17`, whatever they are.
- `npm run web:campaign` still advances a run end to end. Task 2 changed opponent generation; this is what proves the game still plays.
- `artifacts/balance-baseline.json` is **unchanged**.

## Out of scope

Deliberately not in this plan, per spec §8 and the working agreement:

- **Shipping bred archives as the ladder's opponent pool.** Sampling a cell by target difficulty rather than by maximum strength is a later phase; an optimiser pointed at win rate produces twelve min-maxed monsters in a row.
- **Loot-realistic locks** drawn from what nodes 6–12 actually carry.
- **Re-weighting rank**, if §1b says Σ-tiers is wrong. Measure first; the whole tool exists to expose that.
- **Fixing anything the sweep finds.** Task 12 records; balance is its own pass and does not gate feature work.
- **Generating content.** This plan builds the instrument. The gear comes after.
