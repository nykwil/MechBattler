/**
 * Lockstep protocol (docs/11 M2), transport-agnostic. Both clients run this
 * identical driver over the same tick-stamped order stream and, thanks to the
 * deterministic sim (M1), reach bit-identical state every tick. The server is
 * a relay + recorder: it forwards orders and stores the replay; on a hash
 * dispute it re-runs `replayMatch` and its result is authoritative.
 *
 * Cadence: player orders are stamped with absolute ticks (20 Hz). Input delay
 * — stamping an order k ticks ahead of "now" so it arrives before both sims
 * reach that tick — is a client/relay concern; the sim only ever applies an
 * order at the tick it carries, so this module knows nothing about latency.
 */
import { Battle, autopilotController, type ManualOrders } from './combat.js';
import type { Build } from './types.js';
import type { TerrainGrid } from './terrain.js';
import { SIM_VERSION, simContentHash } from './version.js';

/**
 * One player's complete manual intent from a given tick onward (sticky until
 * the next TickOrder for that mech replaces it). `manual: null` reverts the
 * mech to full autopilot. This is the unit that crosses the wire.
 */
export interface TickOrder {
  tick: number;
  mech: 0 | 1;
  manual: ManualOrders | null;
}

/** The deterministic inputs that fully define a match — the arena setup. */
export interface MatchConfig {
  seed: number;
  builds: [Build, Build];
  spawnDistanceM?: number;
  arenaLengthM?: number;
  arenaWidthM?: number;
  timeoutS?: number;
  terrain?: TerrainGrid;
}

/**
 * A complete, replayable match record (docs/11 M2): tiny, and it triples as
 * the wire order-log, the dispute evidence, and the spectate stream. Stamped
 * with SIM_VERSION + content hash so a replay is only ever run against the
 * exact sim behavior that produced it.
 */
export interface MatchReplay extends MatchConfig {
  simVersion: string;
  contentHash: string;
  /** All orders, ascending by tick (ties broken by mech). */
  orders: TickOrder[];
  /** Ticks simulated to completion, and the state hash there. */
  finalTick: number;
  finalHash: number;
}

export interface HashCheckpoint {
  tick: number;
  hash: number;
}

/**
 * Drives a `Battle` from a tick-stamped order queue. Orders may be enqueued
 * incrementally as they arrive over the wire (live play) or all up-front
 * (replay); `step()` applies whatever is due for the tick it is about to run.
 */
export class LockstepBattle {
  readonly battle: Battle;
  /** Pending orders, kept sorted by (tick, mech). */
  private queue: TickOrder[] = [];
  private cursor = 0;

  constructor(config: MatchConfig) {
    this.battle = new Battle({
      builds: config.builds,
      seed: config.seed,
      spawnDistanceM: config.spawnDistanceM,
      arenaLengthM: config.arenaLengthM,
      arenaWidthM: config.arenaWidthM,
      timeoutS: config.timeoutS,
      terrain: config.terrain,
      controllers: [autopilotController, autopilotController],
      lockstep: true,
      recordFrames: true,
    });
  }

  get finished(): boolean { return this.battle.finished; }
  get currentTick(): number { return this.battle.currentTick; }
  hash(): number { return this.battle.stateHash(); }

  /**
   * Queue an order. Ordered insert keeps the stream sorted even when packets
   * arrive out of order; an order for a tick already run is rejected (returns
   * false) — the caller under-delayed and must not silently desync.
   */
  enqueue(order: TickOrder): boolean {
    if (order.tick < this.battle.currentTick) return false;
    // Insert keeping (tick, mech) ascending; scan from the cursor since the
    // common case is near-append.
    let i = this.queue.length;
    while (i > this.cursor && isafter(this.queue[i - 1]!, order)) i--;
    this.queue.splice(i, 0, order);
    return true;
  }

  /** Apply all orders due for the upcoming tick, then advance one tick. */
  step(): boolean {
    const t = this.battle.currentTick;
    while (this.cursor < this.queue.length && this.queue[this.cursor]!.tick <= t) {
      const o = this.queue[this.cursor]!;
      this.battle.setManualOrders(o.mech, o.manual);
      this.cursor++;
    }
    return this.battle.step();
  }

  /** Run to completion or a tick cap, sampling the state hash on a schedule. */
  runToEnd(hashEveryTicks = 40, maxTicks = 100_000): HashCheckpoint[] {
    const checkpoints: HashCheckpoint[] = [];
    let n = 0;
    while (!this.battle.finished && n < maxTicks) {
      if (this.battle.currentTick % hashEveryTicks === 0) {
        checkpoints.push({ tick: this.battle.currentTick, hash: this.battle.stateHash() });
      }
      this.step();
      n++;
    }
    checkpoints.push({ tick: this.battle.currentTick, hash: this.battle.stateHash() });
    return checkpoints;
  }
}

function isafter(a: TickOrder, b: TickOrder): boolean {
  return a.tick > b.tick || (a.tick === b.tick && a.mech > b.mech);
}

/** Stable sort of an order stream into canonical (tick, mech) order. */
export function sortOrders(orders: TickOrder[]): TickOrder[] {
  return [...orders].sort((a, b) => a.tick - b.tick || a.mech - b.mech);
}

/**
 * Seal a finished (or force-ended) lockstep match into a MatchReplay — the
 * record the server stores and clients can re-verify.
 */
export function sealReplay(config: MatchConfig, orders: TickOrder[], ls: LockstepBattle): MatchReplay {
  return {
    ...config,
    simVersion: SIM_VERSION,
    contentHash: simContentHash(),
    orders: sortOrders(orders),
    finalTick: ls.currentTick,
    finalHash: ls.hash(),
  };
}

export interface ReplayResult {
  finalHash: number;
  finalTick: number;
  checkpoints: HashCheckpoint[];
  /** True when the sim's final hash matches the one recorded in the replay. */
  matches: boolean;
  /** Version/content mismatch: this replay was made against a different sim. */
  versionMismatch: boolean;
}

/**
 * Re-simulate a MatchReplay from scratch (docs/11 M2 dispute resolver). Pure:
 * same replay in, same result out, on any conforming engine. `matches===false`
 * on a version-compatible replay means a client diverged — the server's hash
 * is authoritative.
 */
export function replayMatch(replay: MatchReplay, hashEveryTicks = 40): ReplayResult {
  const versionMismatch = replay.simVersion !== SIM_VERSION || replay.contentHash !== simContentHash();
  const ls = new LockstepBattle(replay);
  for (const o of sortOrders(replay.orders)) ls.enqueue(o);
  const checkpoints = ls.runToEnd(hashEveryTicks);
  return {
    finalHash: ls.hash(),
    finalTick: ls.currentTick,
    checkpoints,
    matches: ls.hash() === replay.finalHash && ls.currentTick === replay.finalTick,
    versionMismatch,
  };
}
