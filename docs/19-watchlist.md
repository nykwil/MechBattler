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
