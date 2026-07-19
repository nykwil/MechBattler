# 11 — Multiplayer Plan: Deterministic Lockstep (Track B)

*Written Jul 19 2026 from the multiplayer-readiness audit. Architecture call (user):
**lockstep on a fully deterministic battle system** — clients exchange builds + orders
and each simulate the identical battle; the server is a matchmaker/relay/recorder, and
determinism itself is the anti-cheat (matching state hashes = honest match; disputes =
server re-simulation). Product concept per 00 backlog: a multiplayer roguelike ladder —
build, queue *while still building*, grace period on match found, explicit build lock.*

## 1. Audit findings (what R6 already bought)

- The sim is pure, headless, dependency-free — runs in Node unmodified.
- Zero wall-clock nondeterminism: no `Math.random`/`Date.now`/timers; all randomness is
  seeded Pcg32. `runBattle(builds, seed, options) → report` is a pure function.
- Every wire object is already plain JSON: `Build`/`PlacedPart` (integrity, modifiers,
  variants), `MechOrder` (the four verbs), `BattleReport`/frames/events. Order changes
  are already logged as `order` events — replay/spectate from the order stream exists
  structurally.
- Server-side build validation is free: `checkPlacement`/`validateBuild` are pure.
- Natural quanta: 20 Hz ticks, 4 Hz orders; a full battle resolves in milliseconds.

**The one determinism hole**: IEEE-754 arithmetic (`+ − × ÷`, `sqrt`) is exactly
specified, but transcendentals (`sin/cos/atan2/hypot/exp/log`) are
implementation-defined — two different JS engines can drift over a 2,400-tick battle.
Inventory: ~35 call sites in combat.ts / rng.ts / grid.ts / derivedStats.ts; `erf` is
already a local polynomial (deterministic once `exp` is). Small, closable surface.

**Misc**: `adaptation.ts` holds the sim's only global mutable state (`adaptSeq`) —
offline-script-only today, must be call-scoped before server processes are shared.
Client economy state (localStorage) is forgeable — fine unranked; ranked needs
server-issued run seeds + transition validation (phase 2, out of scope here).

## 2. Milestones

### M0 — Hygiene ✅ *shipped Jul 19 2026 — `adaptSeq` derives from the build (zero
global mutable state in the sim); `version.ts` exports `SIM_VERSION` + `simContentHash()`
(FNV-1a over catalog, chassis, templates, modifier registry incl. apply-function source,
and the dial constants). Stamping happens where lock/replay formats are born (M2/M3).*

### M1 — Deterministic math & state hashing ✅ *shipped Jul 19 2026 — `dmath.ts`
(dsin/dcos/datan/datan2/dexp/dlog/dhypot, built only from IEEE-exact ops: Cody-Waite
range reduction + fixed Taylor sequences, exponent-bit 2^k; ~1e-13 of native, and the
same doubles on every engine). All ~35 sim call sites swapped; `Battle.stateHash()`
FNV-1a's the exact float bits of positions/velocities/facing/HP/cell temps/capacitor
charge/RNG state (incl. the Box-Muller spare). Golden battle pinned in
`determinism.test.ts` and **cross-verified bit-identical on Node, Chromium (V8) and
Firefox (SpiderMonkey)**; a source-grep test bans engine transcendentals outside
dmath.ts. Debug lesson worth keeping: vitest resolves a named import of a nonexistent
export to `undefined` silently — two test files imported CORE_INSTANCE_ID from
combat.js (not an export) and simulated subtly different battles; real ESM throws.*

### M2 — Lockstep protocol (sim-side, transport-agnostic)
- Tick-stamped orders `{tick, mech, order}` with input delay k ticks. **Player orders
  run at full tick rate (20 Hz)** — the 4 Hz cadence is only the autopilot's decision
  rate, not a protocol limit (user note, Jul 19 2026: 4 Hz is too slow for realtime
  feel). k≈2–3 ticks (100–150 ms) hides typical RTT; tune by measurement.
- Battle grows: apply-orders-at-tick entry point, periodic state-hash emission (every
  ~2 s) for desync detection, resync-by-replay (seed + builds + order log → any tick).
- Replay format = `{SIM_VERSION, seed, builds, orderLog, finalHash}` — tiny, and it is
  also the dispute evidence and the spectate stream.

### M3 — Matchmaking service
- Small Node service (websocket): account stub, queue, pairing, order relay, match
  record storage. Server stores replays + final hashes; on hash mismatch it re-simulates
  (its result is authoritative) and flags the diverging client.
- The 00 lock-flow: queueing while editing; match found → visible grace period →
  explicit **lock** (server snapshots the build, validates it, stamps SIM_VERSION).

### M4 — Client
- Online panel: queue/grace/lock UI around the existing workshop (matchmaking is a
  layer around building, never an interruption — 00).
- Networked battle = the existing BattleLiveScreen with the opponent's ManualOrders fed
  from the relay instead of a local ref (`withManualOrders` is already the seam).
  Spectating and post-match replays ride the same order stream.

## 3. Explicitly out of scope

Ranked economy authority (server-issued run seeds + transition validation), rewards/
ladder design without runaway winners (00 open question), squads, cross-play with
non-JS engines. Balancing remains Track C.
