# 12 — Multiplayer Backlog (Track B, paused)

*Split out of `11-multiplayer-plan.md` on Jul 20 2026 (user call): the deterministic
lockstep **foundation (M0–M2) shipped** and is in the codebase; everything that builds a
real service and online client around it is parked here to pick up later. Nothing below
requires changing the sim — the determinism contract (11 §3) is the stable base these
sit on. Order is roughly dependency order.*

## Status of the foundation (done — see doc 11)

- Deterministic transcendental math (`dmath.ts`), cross-engine bit-identical.
- `Battle.stateHash()` desync detector; `version.ts` (`SIM_VERSION` + `simContentHash()`).
- Lockstep protocol (`lockstep.ts`): `TickOrder`, `MatchReplay`, `LockstepBattle`,
  `replayMatch()` (dispute resolver), `sealReplay()`; 20 Hz player orders.

A match is already fully playable *in a single process* today: build two mechs, drive a
`LockstepBattle` with tick-stamped orders, seal a verifiable replay. What's missing is
the network and the UI around it.

## M3 — Matchmaking service

A small Node service (its own workspace, e.g. `packages/server`, importing
`@mechbattler/sim` directly). Websocket transport.

- **Queue / pair**: account stub, a queue endpoint, pairing, and a match channel.
- **Relay**: forward each client's `TickOrder`s to the other, stamped with absolute
  ticks; the server needn't simulate live, only relay + record.
- **Input delay**: clients stamp orders k ticks ahead of the shared clock (k≈2–3 ticks /
  100–150 ms, tuned by measurement) so an order arrives before both sims reach its tick.
  Purely a client/relay concern — the sim already applies orders at the tick they carry.
- **Record + verify**: store the `MatchReplay` (SIM_VERSION-stamped) and both clients'
  periodic state-hash checkpoints. On a checkpoint mismatch the server runs
  `replayMatch()`; its hash is authoritative and the diverging client is flagged.
- **The 00 lock-flow**: queue *while still editing*; match found → visible grace period
  to finish the edit and review warnings → explicit **build lock** (server snapshots the
  build, runs `validateBuild`/`checkPlacement` server-side to reject illegal builds, and
  stamps `SIM_VERSION` + content hash). Matchmaking is a layer around building, never an
  interruption of it (00).

## M4 — Online client

- **Online panel** in the workshop: queue / grace-timer / lock UI, wrapping the existing
  editor. No new battle renderer needed.
- **Networked battle** = the existing `BattleLiveScreen` in lockstep mode: local player
  orders go up to the relay and also into the local `LockstepBattle`; the opponent's
  `TickOrder`s come down from the relay. The `withManualOrders`/`setManualOrders` seam is
  already the injection point.
- **Spectate + replay** ride the same order stream: a `MatchReplay` plays back through
  `LockstepBattle` with no live input. Post-match "view replay" is nearly free.

## M5 — Ranked economy authority

The run economy (scrap, bench, integrity, mods, unlocks) currently lives in localStorage
and is forgeable — fine for unranked ladder play, not for ranked.

- Make the run **server-authoritative**: the server issues run seeds and validates the
  run as a transition log. Because every economic event (wreck rolls, salvage, scrapyard
  offers, ladder generation) is already seeded and deterministic (`Pcg32`, `ladder.ts`,
  `wreck.ts`), the server can recompute exactly what a client could legitimately have
  reached and reject anything else — the same "determinism is the anti-cheat" property
  the battle layer uses.

## Open product questions (design, not engineering)

- **Reward structure without runaway winners** (00): how ranked/ladder rewards feed back
  into the roguelike run without the leader snowballing.
- **Combat presentation**: live command vs. spectated-only vs. cockpit-intervention for
  the networked match (00 parked question).
- **Pre-lock opponent intel**: how much the intel card shows before the build lock.
- **What persists across a run** in a multiplayer ladder context.
- **Cross-play beyond JS engines**: dmath makes JS-to-JS exact; a future native/Wasm
  client would need the same reduced-math routines (or Wasm-shared math). Out of scope
  unless a non-JS client is ever built.
