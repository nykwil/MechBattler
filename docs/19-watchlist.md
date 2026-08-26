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
