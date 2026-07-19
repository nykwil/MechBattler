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

### M0 — Hygiene
- Scope `adaptSeq` per call. Export `SIM_VERSION` plus a content hash over catalog +
  chassis + modifier registry + dial constants; stamp it into locks, reports, replays.

### M1 — Deterministic math & state hashing
- `sim/dmath.ts`: fixed software `sin/cos/atan2/exp/log` (minimax/fdlibm-style, exact
  same doubles everywhere), `hypot(x,y)` = `sqrt(x*x + y*y)` (IEEE-exact at our
  magnitudes). Swap all call sites; keep `sqrt/abs/min/max/floor/round` (specified).
- `battleStateHash(battle)`: FNV/xxhash over the exact float bits of positions,
  velocities, facing, HP tables, cell temps, capacitor charge, RNG state.
- Tests: golden replay fixtures with pinned hashes in-repo (any engine or refactor that
  diverges fails loudly); a test that greps the sim for raw `Math.` transcendentals.

### M2 — Lockstep protocol (sim-side, transport-agnostic)
- Tick-stamped orders `{tick, mech, order}` with input delay k ticks (k≈5 = one 4 Hz
  order period at 20 Hz); both sims apply order streams identically.
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
