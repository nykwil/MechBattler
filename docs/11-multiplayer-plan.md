# 11 — Multiplayer Foundation: Deterministic Lockstep (Track B)

*Written Jul 19 2026 from the multiplayer-readiness audit; **foundation (M0–M2) shipped
Jul 19–20 2026, then paused (user call)**. The rest lives in `12-multiplayer-backlog.md`.
Architecture call (user): **lockstep on a fully deterministic battle system** — clients
exchange builds + orders and each simulate the identical battle; the server is a
matchmaker/relay/recorder, and determinism itself is the anti-cheat (matching state
hashes = honest match; disputes = server re-simulation). Product concept per 00 backlog:
a multiplayer roguelike ladder — build, queue while still building, grace period on match
found, explicit build lock.*

**What this doc is now:** the record of the shipped deterministic core, and — more
importantly for day-to-day work — the **determinism contract (§3)** every future feature
must hold for multiplayer to remain possible. Read §3 before adding sim behavior.

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

**Misc (all resolved in M0–M2)**: `adaptation.ts`'s global `adaptSeq` counter is now
call-scoped (derives ids from the build), so the sim has zero global mutable state bar a
pure memoization cache. Client economy state (localStorage) is still forgeable — fine
for unranked; ranked needs server-issued run seeds + transition validation, deferred to
the backlog doc.

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

### M2 — Lockstep protocol (sim-side, transport-agnostic) ✅ *shipped Jul 20 2026 —
`lockstep.ts`: `TickOrder {tick, mech, manual: ManualOrders|null}` (sticky per-mech
snapshot, null = revert to autopilot), `MatchReplay` (config + SIM_VERSION + content
hash + sorted order log + finalTick/finalHash — the wire log, dispute evidence and
spectate stream in one). `LockstepBattle` drives a `Battle` from an ordered queue
(out-of-order enqueue tolerated; an order for an already-run tick is rejected, not
silently dropped). `replayMatch()` is the pure dispute resolver; `sealReplay()` seals a
finished match. **Player orders apply every tick (20 Hz)**: opt-in `Battle` lockstep
mode refreshes the autopilot base at 4 Hz but re-merges manual overrides every tick via
the extracted `mergeManualOrders` (shared with the live `withManualOrders`). Default
Battle path byte-identical (golden unchanged). Cross-verified: a full order-driven match
replays to the same hash on Node, Chromium (V8) and Firefox (SpiderMonkey). Input delay
k stays a client/relay concern — the sim only applies an order at the tick it carries.*

- Tick-stamped orders `{tick, mech, manual}` with input delay k ticks. **Player orders
  run at full tick rate (20 Hz)** — the 4 Hz cadence is only the autopilot's decision
  rate, not a protocol limit (user note, Jul 19 2026: 4 Hz is too slow for realtime
  feel). k≈2–3 ticks (100–150 ms) hides typical RTT; tune by measurement.
- Battle grows: apply-orders-at-tick entry point, periodic state-hash emission (every
  ~2 s) for desync detection, resync-by-replay (seed + builds + order log → any tick).
- Replay format = `{SIM_VERSION, seed, builds, orderLog, finalHash}` — tiny, and it is
  also the dispute evidence and the spectate stream.

### Remaining milestones — paused Jul 20 2026 (user call)

The foundation above (M0–M2) is the load-bearing part and it is **done and in the
codebase**. The rest — the actual server, the online client, ranked integrity — is
deferred to the backlog: **`12-multiplayer-backlog.md`** (M3 matchmaking relay, M4
online client, ranked economy authority, and the open product questions). Nothing there
requires changing the sim; it builds *around* the deterministic core this doc shipped.

## 3. Keeping it deterministic (the contract for all future features)

This is the part that matters going forward. The multiplayer foundation stays valid as
the game grows **only if the sim stays deterministic**. The invariants below are the
contract; the first two are enforced by a test so a violation fails CI, not production.

1. **No engine transcendentals in the sim.** Use `dmath` (`dsin/dcos/datan/datan2/dexp/
   dlog/dhypot`), never `Math.sin/cos/tan/atan/atan2/asin/acos/exp/log/hypot/pow/cbrt`.
   `Math.sqrt/abs/min/max/floor/ceil/round/trunc/sign/imul` and `+ − × ÷` are
   IEEE-exact and fine. *Enforced by the grep test in `determinism.test.ts`.*
2. **No wall-clock or entropy in the sim.** No `Date.now`, `performance.now`,
   `new Date`, `crypto.*`, `process.hrtime`, `Math.random`. All randomness is a
   `Pcg32` seeded from battle inputs (the battle/terrain/ladder seed). *Enforced by the
   same grep test.*
3. **Iterate deterministically.** State-affecting loops iterate arrays (e.g.
   `build.parts`) or Maps whose insertion order is fixed at construction — never a
   `Set`, nor `Object.keys` order, in a way that feeds sim state.
4. **New tuning constants go into `simContentHash()`** (`version.ts`). A balance dial the
   hash doesn't see means a locked build could meet a differently-tuned sim without a
   forced version bump. Add the constant to the hash and **bump `SIM_VERSION`** on any
   behavior change.
5. **New mutable battle state should join `Battle.stateHash()`.** Desync is still
   *detected* without it (divergence flows downstream into hashed positions/HP), but
   hashing it directly makes detection immediate and disputes precise.
6. **Keep the sim pure and headless** (rule R6): no DOM, no I/O, no imports outside
   `packages/sim`. Builds and orders stay plain JSON so they serialize across the wire
   unchanged.

Follow these and any new part, quirk, mod, chassis, or mechanic is automatically
lockstep-safe — the golden battle test and the grep guard catch regressions the moment
they land. The audit on Jul 20 2026 confirmed the whole sim currently satisfies all six.
