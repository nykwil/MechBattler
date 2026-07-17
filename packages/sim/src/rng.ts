/**
 * Seeded PCG32 random number generator (docs/02 §1: the only randomness in
 * the whole sim is combat dispersion, and it must be seeded so battles are
 * deterministic and replayable).
 */

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
    const mag = Math.sqrt(-2 * Math.log(u1));
    this.gaussianSpare = mag * Math.sin(2 * Math.PI * u2);
    return mag * Math.cos(2 * Math.PI * u2);
  }
}
