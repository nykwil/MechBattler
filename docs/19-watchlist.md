# 19 — Watchlist

Things we are deliberately keeping an eye on. Not a backlog and not a bug list:
each entry is something that is *fine right now* but could bite, or a decision we
took knowingly and want to revisit with more evidence.

An entry leaves this file when it is fixed, or when we decide it is permanent and
write it down somewhere that isn't a watchlist. Keep the reason, not just the
symptom — the point of the file is that the next reader inherits the judgement,
not only the fact.

## Balance

**The baseline predates component height.** `artifacts/balance-baseline.json` is
the 19 Aug 2026 cut. The height rule moved five builds by 5+ points —
`mule-laser-boat` +29, `vulture-skirmisher` +24, `bastion-tank` −7,
`vulture-sniper` −17, `mule-gunline` −27 — and correlation went −0.586 → −0.637.
It was **not** re-cut, per the working agreement. Re-cut it in a deliberate
balance pass, never to make the swing go away. Causes are written up as F5 in
`docs/17-balance-findings.md`.

**The swing is geometry, not budget.** `railgun-mule` is the build that actually
lost a part and it moved −4. `mule-gunline` kept every part and moved −27. Watch
whether height systematically pushes guns to outer lanes on narrow hulls, and
whether the flank exposure that buys is what is moving the numbers.

**Two report-only findings stand** from `npm run verify`: a dominant combination
on `mule-fever-cycle`, and `gyrostabilized` reading as a dead perk. Both predate
the height work.

**The ladder's difficulty curve is a cliff, not a ramp** (measured 25 Aug 2026,
`game:balance -- 4`, post component height). Round 1 wins **0.897**, round 4
**0.238**, round 7 **0.000**, and no run reached round 10 or 12. That is a
different shape from the flat curve `docs/16` recorded — the opening is easier than
the 0.65 ceiling and the middle is below the 0.35 floor, so the run now falls off
rather than levelling. Nothing was tuned to cause it; component height is the
obvious suspect and is unproven as one. Re-measure at the start of the next balance
pass before reading `16`'s "flat rather than declining" as current.

## Component height (shipped 25 Aug 2026, `502cb0f`)

**`railgun-mule` is a three-capacitor railgun now.** `W-RG` is `rect(2,5)` and
has no riser, so once the core cell, the cargo bay and the gun's own footprint
are accounted for, the Mule has room for exactly three two-level parts. The
fourth capacitor has no legal cell. Forced, not chosen — but if the railgun build
reads as weak, this is where to look first.

**"Clear ahead 0 levels" reads backwards.** In the part inspector, a small gun's
clearance of 0 is the *strictest* possible demand — nothing may stand in its lane
— but the phrasing sounds like "needs no clearance". Left alone deliberately: it
is a copy decision, not a bug. "Nothing may stand ahead" is the likely fix.

**Destroying a riser breaks the heat path of the gun on it.** A riser carries
`transfersHeat`, so losing 20 HP of support severs its cells' thermal edges. That
may be a good mechanic or an accident; nothing tests it either way.

**`grid.ts` and `spatial.ts` each declare the placement-reason union.** They
duplicate each other, and the duplication is why `web:build` broke silently when
the two height reasons were added to only one of them. Left as-is on purpose —
deduplicating it is a refactor, not a fix — but the next reason added must go in
both.

**Four test gaps, all judged non-blocking**, each correct by construction or by
inspection and none pinned against a future reshuffle: the forward scan's region
seam; that a stacking error outranks a ceiling error; that one riser is *not*
enough to clear a gun; and that a `clearsForward: 0` part renders "0 levels"
rather than hiding the inspector row.

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
