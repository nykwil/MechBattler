# 09 — UX & Diagnostics Plan

*Written Jul 18 2026, after the playable mode (docs/08) shipped. Scope declared in docs/07:
make what exists more user-friendly before adding systems (Track A follows this thread).
Sources: the Jul 2026 design-notes intake (captured in 00/01/02/03) and the playable-mode
playability review findings.*

## 1. Goal and stance

Every milestone here makes an *existing* mechanic more legible or less frictious — no new
combat mechanics, no economy. The bar for each item (rule R4/R5): after it ships, a player
who fails can name the cause without asking, and a player who wants to try something is
never blocked by busywork the game could do for them without taking the decision away.

Already shipped from this scope (Jul 18 2026): firing-arc wedges on placed weapons in the
grid editor; the range sandbox (windowed live-fire DPS at selectable target ranges); the
auto-face-on-manual-waypoint fix (dead-gun travel now uses forward speed).

## 2. Milestones

### M1 — Playable friction fixes (small, ship first) ✅ *shipped Jul 18 2026*

The command-mode paper cuts from the playability review, all one-to-two-line-diff sized:

- **Abort → stale report bug**: aborting a live battle launched from the report screen
  redisplays the *previous* battle's report. Clear `battle` state in `App.tsx` when a
  fight starts.
- **Live 4× speed**: live mode caps at 2×; a judges-timeout battle is 120 s. Add 4×
  (replay already offers 8×).
- **Rematch (same seed)**: rematch currently rerolls the seed. A same-seed option turns a
  loss into a controlled experiment — exactly the engineer fantasy. Ship as a second
  rematch button on the report screen.

### M2 — Not-firing legibility (03 §9) ✅ *shipped Jul 18 2026 — `WeaponFrame.gate`
('arc'|'range'|'heat'), slot labels RANGE/ARC/HOT with HOLD reserved for the player's
order (keyed off the override so it reads back instantly while paused); bonus fix:
`useBattle` primes one tick so pausing at 0:00.0 shows the spawn state.*

Whenever a gun is silent, the HUD slot says *why*, distinguishably: **out of arc / out of
range / cooling / power-shed / shutdown / player hold**. Today a single HOLD label
conflates player intent with fire-control gating.

- Sim: the autopilot already computes the gates (arc, despawn range, <115 °C) — surface
  the failed gate per weapon in `WeaponFrame` (e.g. `gate: 'arc'|'range'|'heat'|…|null`)
  so replays get it for free.
- Web: slot label/badge renders the specific reason; player hold stays visually distinct
  (it's an order, not a diagnosis).
- Test: pinned sim test per gate; Playwright asserts the slot text at a long spawn
  distance reads range-gated, and flips to player-hold on click.

### M3 — Build audit coverage (01 §9) ✅ *shipped Jul 18 2026 — the load-bearing new
check was `network-starved` (a starved reactor island the pooled margin hides); the
never-satisfiable-weapon cases turned out already covered by cap-starved (error) and the
always-on thermal prediction.*

The live audit surface already exists (`validation.ts` → `BuildWarnings`, with
error/warn/hint = the intake's hard-error/warning/optimization split, and it runs on every
edit — better than the notes' button). This milestone is *coverage*:

- **Never-satisfiable weapons**: a weapon whose power draw exceeds supply+capacitor burst
  (can never complete a shot), or whose heat-per-shot drives its own cell past 130 °C from
  ambient (fires once then cooks — warn, since that can be a legal alpha strike).
- **Starved paths**: conduit trunk carrying more demand than the reactor can deliver when
  everything fires (names the choke conduit).
- **Envelope mismatch**: disjoint weapon envelopes already warn in the stats bar — fold
  into the same surface with the same severity language.
- Each check lands with a fixture-build test proving it fires and a clean-build test
  proving it doesn't.

### M4 — Auto-wire baseline (01 §9) ✅ *shipped Jul 18 2026 — `autoWire()` +
⚡ Auto-wire button, laid conduits flash green; pinned tests re-wire every template
stripped of its conduits.*

One button: generate a *functional* (not optimal) conduit graph connecting every placed
part to a reactor. Player keeps all placement decisions; the game does the busywork of a
first wiring pass, and hand-routing remains the optimization game (05 R1 mitigation).

- Sim: `autoWire(build): PlacedPart[]` — BFS from reactors over free mask cells, laying
  U-CON to reach each disconnected part; returns the conduits to add (or reports
  unreachable parts as a normal audit error). Deterministic.
- Web: button beside the overlay toggles; added conduits flash once so the player sees
  what was done.
- Test: every template build minus its conduits re-wires to full connectivity; a build
  with no reactor reports cleanly instead of looping.

### M5 — Bench attribution (02 §6) ✅ *shipped Jul 18 2026 — per-weapon uptime bars in
the sandbox with silence attributed via the M2 gate reasons; the per-support-part
contribution stretch (virtual part removal) remains open.*

The range sandbox measures *what*; this adds *why*:

- Per-weapon **uptime** over the window: % of the window firing vs gated, with the gated
  share attributed via the M2 gate reasons (cooling / power / range / arc).
- Rendered as a small stacked bar per weapon row in the sandbox results.
- Stretch: per-support-part contribution (uptime bought per radiator — measured by
  re-running the window with the part virtually absent; the sim is cheap enough).

## 3. Order and effort

M1 (hours) → M2 (the load-bearing one; sim + both HUDs) → M3/M4 (independent, either
order) → M5 (builds on M2's gate reasons). Each milestone ships and commits on its own.

## 4. Explicitly out of scope

Track A (run structure & economy — next thread), docs/08 M5 stretch (enemy-intel limits,
waypoint queues, region triggers), the autopilot-loses showcase test, multiplayer
(00 backlog), turret mounts, ammo (Track C).
