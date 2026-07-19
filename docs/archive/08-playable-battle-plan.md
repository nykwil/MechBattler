# 08 — Playable Battle Plan (live verb control)

*Written Jul 18 2026. Prereqs all shipped: the order channel (MechOrder / Controller /
`Battle.issueOrders`), the cockpit HUD whose readouts are the intended click targets, the
exchange-optimizing autopilot, and terrain.*

## 1. Goal and stance

The player commands one mech in real time by issuing the **four verbs** (docs/03 §2);
everything left on **auto** stays under the autopilot. This is not a new game mode bolted
on — it is the same battle the sim already runs, with a human replacing the autopilot on
some verbs. Two invariants:

- **The sim never knows who is commanding** (rule R6). All player input flows through the
  existing `Battle.issueOrders` channel. No new sim capabilities for the player — if the
  player can do it, the autopilot could too, and vice versa.
- **A played battle is automatically a replay.** Orders are already logged as events and
  frames are already recorded, so a live battle produces the same `BattleReport` as a
  watched one — scrub back through your own fight on the report screen for free.

The autopilot's design constraint pays off here: it prices exactly the trades the player
makes by hand (motion jitter vs closing, orbit vs stand, hill vs cover), so "beat the
autopilot" is a fair skill test, not a fight against scripted stupidity.

## 2. Control surface (per verb)

The replay HUD's readouts become inputs. Every verb has an **auto flag**; a master
"FULL AUTO" button clears all manual state (docs/03 §2).

| Verb | Readout today | Control |
|---|---|---|
| 1 Weapons | gun slots with ready-fill | click slot to cycle **auto → hold-fire → force-fire → auto**. Force-fire skips the autopilot's arc/range/temperature gate (knowingly cooking your gun is allowed; the sim's physical shutdown at 130°C still applies — that's physics, not fire control) |
| 2 Move | waypoint diamond + dashed line | **click the arena** to set a destination (RTS move order); a second click replaces it; a "hold" button (or right-click) clears it. Auto resumes exchange-optimized movement |
| 3 Throttle | verb chip | chips become buttons: creep / cruise / flank / auto |
| 4 Face | face chip | cycle **auto (track target) → face movement → face bearing** (bearing = direction of the last arena click while in bearing mode) |

One trigger, not a scripting language (docs/03 §2): a manual move order can carry
**"on arrival, revert chosen verbs to auto"** — enough to express "hold fire, get to that
hill, then fight."

## 3. Architecture

**PlayerController** (web-side, not sim-side): a `Controller` that runs
`autopilotController` for the auto verbs, then overlays the manual state:

```
manual: {
  weapons: Map<instanceId, 'auto' | 'hold' | 'force'>
  move:    { dest: Vec2 | null, revertOnArrival: Set<verb> } | 'auto'
  throttle: SpeedSetting | 'auto'
  face:    FaceOrder | 'auto'
}
```

The controller merges per verb: auto verbs pass the autopilot's order through; manual
verbs emit the player's standing order instead. The manual state lives in a React ref
(mutated by clicks between ticks, read by the controller at 4 Hz) — no sim types change.

**Live stepping**: a `useBattle` hook owns a `Battle` instance and steps it on a
requestAnimationFrame accumulator at 20 ticks/s of sim time × the chosen speed (pause /
1× / 2×). The sim costs ~ms per battle headless, so real-time stepping is trivially
cheap. **Tactical pause is allowed** — pause and issue orders; this is a thinking game,
and the autopilot gets its 4 Hz regardless, so pausing is not an exploit against it.

**Live HUD data**: the battle already samples a `MechFrame` every tick; expose the latest
frame (`battle.frames.at(-1)` — make `frames` public readonly, or add a `latestFrame()`
accessor) and render the exact same HUD components as the replay. The arena, cockpit,
enemy strip, and ticker components get extracted from `BattlePlayback` into shared
pieces; `BattlePlayback` (scrub a recorded report) and `BattleLive` (drive a running
battle) become two thin shells over them.

**Entry point**: the Arena panel's Fight button gains a mode choice — **Watch** (today's
flow: run headless, open the replay) and **Command** (live). Both end at the same
`BattleReportScreen`.

## 4. Milestones

1. **M1 — Live watch.** ✅ *shipped Jul 18 2026.* `useBattle` hook + `BattleLiveScreen`
   shell: the battle steps in real time with pause/1×/2×, rendering the shared arena +
   HUD from the latest frame. No input yet. Proves the loop; visually identical to the
   replay. Shared components extracted from `BattlePlayback` into `BattleHud.tsx`
   (`BattleScene` / `BattleTicker` / `BattleCaption` over a `BattleView` that both a
   `BattleReport` and a running `Battle` satisfy); the Fight button became
   **Fight · Live** / **Watch**; a finished live battle opens the normal report screen
   with full replay scrubbing (the M4 parity piece came for free).
2. **M2 — Move + throttle.** ✅ *shipped Jul 18 2026.* Arena click → point order (new
   move intent `direct`, logged as "MOVE: TO WAYPOINT"); right-click reverts to auto;
   hold + throttle chips + FULL AUTO in a live orders bar. The merge landed sim-side as
   `withManualOrders(base, () => ManualOrders)` so scripted tests drive the exact same
   path as the UI (rule R6); pinned tests: a held mech never moves, a waypoint order
   marches within 8 m of the point while weapons stay on fire control.
3. **M3 — Weapons + face.** ✅ *shipped Jul 18 2026.* Gun slots cycle auto → hold-fire →
   force-fire (force bypasses the autopilot's arc/range/temperature gate; the 130°C
   physical shutdown still applies); the face chip cycles auto → target → movement →
   bearing (an arena click aims the held bearing); "auto on arrival" on a waypoint
   clears all manual state via `withManualOrders`'s `onArrival` hook. Face-movement's
   continuously tracked bearing forced the order-log signature to bucket bearings at
   0.5 rad so steering noise stays out of the ticker.
4. **M4 — Report parity + polish.** ✅ *shipped Jul 18 2026.* Report parity came free
   with M1 (a finished live battle opens the report screen with the replay tab).
   Keybindings: space = pause, 1–9 = gun fire-control cycle, H = hold position,
   F = face cycle, A = full auto (the workshop's own hotkeys are suppressed while a
   battle overlay is open); click ripple at the waypoint; key hint caption.
5. **M5 — Stretch.** Enemy-intel limits (should the live enemy strip show their heat and
   cooldowns? candidate rule: intel cards' confirmed facts only, full readouts in the
   post-battle replay); waypoint queues; "don't fire until the water" region triggers.

## 5. Testing

- **Sim-side**: a pinned test where a scripted "player" controller (manual overrides via
  the same merge logic) beats the autopilot in a matchup the autopilot loses — proves
  manual orders flow end-to-end and matter. Determinism test: same seed + same recorded
  order stream ⇒ identical report.
- **Web-side**: Playwright — start a Command battle, click the arena, assert the
  waypoint marker and a `MOVE` order in the ticker; toggle a gun to hold-fire and assert
  its slot state.

## 6. Explicitly out of scope (for this thread)

Multi-mech lances, camera scrolling/zoom (240 m fits one screen), minimap, fog of war,
mid-battle retreat negotiation (that's the Track A runaway rule), and any sim mechanics
changes. The run structure (Track A) remains the next milestone after this ships.
