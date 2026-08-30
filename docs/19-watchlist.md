# 19 — Watchlist

Things we are deliberately keeping an eye on. Not a backlog and not a bug list:
each entry is something that is *fine right now* but could bite, or a decision we
took knowingly and want to revisit with more evidence.

An entry leaves this file when it is fixed, or when we decide it is permanent and
write it down somewhere that isn't a watchlist. Keep the reason, not just the
symptom — the point of the file is that the next reader inherits the judgement,
not only the fact.

## Balance

**The baseline now includes component height's swing** (re-cut 26 Aug 2026,
deliberately, before the content-generation pass). The height rule had moved five
builds by 5+ points — `mule-laser-boat` +29, `vulture-skirmisher` +24,
`bastion-tank` −7, `vulture-sniper` −17, `mule-gunline` −27, correlation −0.586 →
−0.637 — and that is now the reference rather than a pending diff. **Nothing was
fixed by re-cutting**; the record of what moved and why is F5 in
`docs/17-balance-findings.md`, and F1 is still the open regression. The reason to
re-cut was that a stale reference would have mixed height's swing into every diff
the content pass produced, and the diff is the whole instrument.

**The swing is geometry, not budget.** `railgun-mule` is the build that actually
lost a part and it moved −4. `mule-gunline` kept every part and moved −27. Watch
whether height systematically pushes guns to outer lanes on narrow hulls, and
whether the flank exposure that buys is what is moving the numbers.

**Two report-only findings stand** from `npm run verify`: a dominant combination
on `mule-fever-cycle`, and `gyrostabilized` reading as a dead perk. Both predate
the height work.

**Rank peaks at 10 and declines after it** — measured 29 Aug 2026 by the first
`sim:breed` sweep, on all three chassis, and recorded as **F6** in
`docs/17-balance-findings.md`. It corroborates F2 by a completely different
method. Do not tune `ladderBudgetPerNode` from the k = 4 figure until the curve
stops declining: the number describes the peak as much as the player.

**The ladder's difficulty curve is a cliff, not a ramp** (measured 25 Aug 2026,
`game:balance -- 4`, post component height). Round 1 wins **0.897**, round 4
**0.238**, round 7 **0.000**, and no run reached round 10 or 12. Nothing was tuned
to cause it; component height is the obvious suspect and is unproven as one.

What changed since: the *target* is now a declining curve per checkpoint
(`balanceTargetWinRateByDepth`, 25 Aug 2026) rather than one flat 0.35–0.65 band
applied everywhere, because the old instrument called a winnable opening and an
unplayable depth the same kind of failure. Under the new target round 1 is in band
and **rounds 4 and 7 still warn**, which is the point — the finding survives, and
is now the only thing warning. No budget or content dial moved to get there.
The cliff itself is still unexplained and belongs to the next balance pass.

**`simContentHash()` differs between source and compiled runs.** Measured
26 Aug 2026: the same content hashes `5e2b472e` under `tsx` and `bd14455b` from
`dist`. The cause is benign — the fingerprint includes `apply.toString()` for
every modifier, and compilation strips the comments inside those functions — but
the hash is the multiplayer lock-in stamp (docs/11 M0), so a replay stamped from
a source run would not match one stamped from a build of the identical content.
Nothing depends on it today, and the fix (hash a normalised form, or the
modifier's declared fields only) is a change to a determinism contract, which is
not something to slip into an unrelated pass.

## Component height (shipped 25 Aug 2026, `502cb0f`)

**`railgun-mule` is a three-capacitor railgun now.** `W-RG` is `rect(2,5)` and
has no riser, so once the core cell, the cargo bay and the gun's own footprint
are accounted for, the Mule has room for exactly three two-level parts. The
fourth capacitor has no legal cell. Forced, not chosen — but if the railgun build
reads as weak, this is where to look first.

~~**`grid.ts` and `spatial.ts` each declare the placement-reason union.**~~ Fixed
25 Aug 2026: `SpatialPlacementReason` is declared once in `types.ts`, which both
can import without a cycle, and `PlacementError` composes it.

~~**Four test gaps.**~~ Closed 25 Aug 2026, and two of them said something. The
region seam and the riser ceiling behaved as designed. The precedence case does
have an answer worth knowing — a stacking failure outranks a ceiling failure,
because "it cannot stand on that" is the thing the player can act on. And the
fourth is gone rather than pinned: the inspector now says "nothing may stand
ahead" instead of "0 levels", so there is no backwards copy left to test.

## Uniques (added 26 Aug 2026)

**A unique sells for exactly what its stock part sells for.** Scrap value is
`tier x multiplier x integrity`, and a unique is an ordinary part underneath, so
the Assize fetches the same 13 scrap as any autocannon. That is arguably right —
the metal is worth what the metal is worth, and the value is the identity, not
the resale — but it does mean a player short of scrap can scrap a named piece
without the price ever telling them it was special. Left alone deliberately:
pricing rarity into salvage is an economy change and belongs in a balance pass,
not beside the content that introduced it.

**Nothing yet stops a unique being fed to the machinist's copy rules.** It cannot
take a second mod (the one-mod-per-part rule already refuses), so this is fine
today. It is listed because the interaction was reasoned about rather than
tested, and because a future mod-removal or reroll service would break it.

## Rank and the breeding tool (added 27 Aug 2026)

**Tier now does three jobs on a mod.** `ModifierDef.tier` replaced `rarity` and
`scrapCost`: it sets draw weight (`2^(1−tier)`), the machinist's price
(`tier × 15`), *and* how much rank the mod costs. The consequence is that "rare
but weak" and "common but strong" stopped being expressible — making a mod
scarcer necessarily makes it dearer in both scrap and rank. Parts already live
with exactly this coupling and it was accepted knowingly. Watch for the first
mod that genuinely wants to be common and strong; that is the signal to split
them again.

**A unique's variant roll and quirks are free rank.** `computeRank` prices a
unique at its underlying mod's tier, because that is what the rank formula says.
But a unique is *also* an extreme variant roll plus quirks, and none of that
costs anything. If uniques start dominating archive elites at their nominal
rank, this is why.

**The elite mod trim cannot always succeed.** An elite's mod is stamped after
the budget is spent, so generated fill is dropped to pay for it. When the
template alone fills the budget there is no fill left, and the alternative would
be deleting the opponent's own identity. Measured over 200 seeds: 95% of modded
cards land inside budget, 5% overspend by at most one mod's tier. Fine for now;
revisit if the ladder ever needs opponents to be exactly on budget.

**Every threshold in `invariants.ts` is provisional.** I1 at 0.75/0.60, I2 at 8
points, the k-measurement at 0.5, and the descriptor bucket edges (range 45/100
m, weight 0.5/0.8 of rated mass). They were written down so the first sweep had
something to disagree with, not because they were measured.

**The bucket edges look mis-set already.** Across the whole canonical roster
nothing is `heavy` (the largest load factor is 0.74 against a 0.8 threshold) and
nothing is `long`-ranged, and six of seven are `redliner`s. So three of the
archive's eighteen cells may be unreachable by construction rather than because
no such build exists. Check this against a wide sweep before moving the edges —
it may equally be a fact about the catalog, which would be the more interesting
answer.

**The screen saturates, and the tie-break is a patch over that.** A rank-6 build
beats all three screen-panel opponents 3/3, and so does a rank-20 one. A
decisiveness term (hull left, time taken, weighted 0.05) gives the search a
gradient, but the underlying fact stands: the canonical roster is not a hard
enough yardstick for a well-built mech at any rank above about 6. Related to
F2's inverted budget/win-rate correlation — `bastion-tank` is rank 25 and loses
to rank-6 builds. A harder panel would be a real improvement and is not one to
make casually, because the panel is also what makes reports comparable.

## Ammo stays a placeholder — on purpose (25 Aug 2026)

**No decision is being taken on ammunition for now.** `U-AMMO` remains in the
catalog and disabled: `ENABLED_PART_IDS` filters it out, `game:audit` fails if it
is ever enabled, `sim:diversity` reports it as a dead placeholder, and the mobile
gun chip shows no ammo count (there is no room for a fake number beside band and
arc at 390px).

The reason it is not urgent: the weapon classes are **already distinct enough**
without it. Declaring what each gun consumes to fire, and letting ballistic,
missile and chemical guns fire without the bus, separated them from energy and
cap-fed guns on power, heat and routing — the axes ammo was going to buy.

What stays live regardless: cook-off at 180°C, the `ammo-cookoff-risk` build
warning, and the `sacrificial-casing` modifier. What to watch: the dead-placeholder
finding will keep appearing in every diversity report, so read it as expected
output rather than a regression, and do not let a harness warning drive the design
call. The specced system is `01 §7`; the backlog entry is `07` Track C §1.
