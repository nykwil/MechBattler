/**
 * Seeded PCG32 random number generator (docs/02 §1: the only randomness in
 * the whole sim is combat dispersion, and it must be seeded so battles are
 * deterministic and replayable).
 */

import { dcos, dlog, dsin } from './dmath.js';

const MULT = 6364136223846793005n;
const MASK64 = (1n << 64n) - 1n;

export class Pcg32 {
  private state: bigint;
  private readonly inc: bigint;
  private gaussianSpare: number | null = null;

  constructor(seed: number, streamId = 54) {
    this.inc = ((BigInt(streamId) << 1n) | 1n) & MASK64;
    this.state = 0n;
    this.nextUint32();
    this.state = (this.state + BigInt(Math.floor(seed))) & MASK64;
    this.nextUint32();
  }

  nextUint32(): number {
    const old = this.state;
    this.state = (old * MULT + this.inc) & MASK64;
    const xorshifted = Number(((old >> 18n) ^ old) >> 27n & 0xffffffffn) >>> 0;
    const rot = Number(old >> 59n);
    return ((xorshifted >>> rot) | (xorshifted << ((-rot) & 31))) >>> 0;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Internal state as two u32 words (hi, lo) — for lockstep state hashing (docs/11 M1). */
  stateBits(): [number, number] {
    return [Number((this.state >> 32n) & 0xffffffffn), Number(this.state & 0xffffffffn)];
  }

  /** The Box-Muller spare, as hashable state: [present flag, value]. */
  spareState(): [number, number] {
    return this.gaussianSpare === null ? [0, 0] : [1, this.gaussianSpare];
  }

  /** Standard normal via Box-Muller (cached spare for determinism-friendly pairing). */
  gaussian(): number {
    if (this.gaussianSpare !== null) {
      const v = this.gaussianSpare;
      this.gaussianSpare = null;
      return v;
    }
    let u1 = 0;
    do { u1 = this.nextFloat(); } while (u1 <= 1e-12);
    const u2 = this.nextFloat();
    const mag = Math.sqrt(-2 * dlog(u1));
    this.gaussianSpare = mag * dsin(2 * Math.PI * u2);
    return mag * dcos(2 * Math.PI * u2);
  }
}

/**
 * Draw one item with probability proportional to its weight, consuming exactly
 * one `nextFloat()` — the same cost as the uniform draw it replaces, so a roll
 * site can adopt it without reseeding everything downstream of it.
 *
 * Zero or negative weights are treated as zero; if every weight is zero the
 * draw falls back to uniform rather than returning nothing, because a content
 * mistake should not silently empty a loot table.
 */
export function pickWeighted<T>(items: readonly T[], weightOf: (item: T) => number, rng: Pcg32): T | undefined {
  if (items.length === 0) return undefined;
  const weights = items.map((item) => Math.max(0, weightOf(item)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const roll = rng.nextFloat();
  if (total <= 0) return items[Math.min(items.length - 1, Math.floor(roll * items.length))];
  let cursor = roll * total;
  for (let index = 0; index < items.length; index++) {
    cursor -= weights[index]!;
    if (cursor < 0) return items[index];
  }
  return items[items.length - 1];
}
