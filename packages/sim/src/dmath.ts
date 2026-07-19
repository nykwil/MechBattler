/**
 * Deterministic transcendental math (docs/11 M1). IEEE-754 requires exact
 * results for + − × ÷ and sqrt, but leaves sin/cos/atan2/exp/log
 * implementation-defined — so two JS engines can disagree in the last bits,
 * which is fatal to lockstep. Every function here is built ONLY from exact
 * ops in a fixed sequence, so any conforming engine produces bit-identical
 * doubles. Accuracy is ~1 ulp-ish (1e-15 relative) — more than the sim
 * needs; determinism is the requirement, accuracy the bonus.
 *
 * The sim must never call Math.sin/cos/tan/atan/atan2/asin/acos/exp/log/
 * hypot/pow/cbrt directly — a test greps for violations. Math.sqrt/abs/
 * min/max/floor/ceil/round/trunc/imul are exactly specified and stay.
 */

// Split high-precision constants (Cody-Waite): value = HI + LO, where HI has
// trailing zero bits so N*HI is exact for the small integer N we multiply by.
const PI = 3.141592653589793;
const TWO_PI_HI = 6.283185482025146484375;   // fround(2π): exact when × small ints
const TWO_PI_LO = -1.74845560252379073063e-7; // 2π − TWO_PI_HI
const LN2_HI = 0.693147182464599609375;       // fround(ln2)
const LN2_LO = -1.904654323148236017e-9;      // ln2 − LN2_HI
const INV_LN2 = 1.4426950408889634;
const SQRT1_2 = 0.7071067811865476;

/** 2^k exactly, via exponent-bit construction (|k| ≤ 1023). */
function pow2(k: number): number {
  if (k >= 1024) return Infinity;
  if (k < -1074) return 0;
  if (k >= -1022) {
    F64[0] = 0;
    U32[HI] = (k + 1023) << 20;
    return F64[0];
  }
  // Subnormal range: build 2^-1022 then scale down exactly.
  F64[0] = 0;
  U32[HI] = 1 << 20;
  let v = F64[0];
  for (let i = -1022; i > k; i--) v *= 0.5; // halving is exact
  return v;
}

const buf = new ArrayBuffer(8);
const F64 = new Float64Array(buf);
const U32 = new Uint32Array(buf);
// Endianness-agnostic high-word index (all target platforms are little-endian,
// but detect anyway so the math never silently breaks on an odd host).
F64[0] = 1;
const HI = U32[1] === 0x3ff00000 ? 1 : 0;

/** sin for |x| ≤ π/2 via Taylor through x¹⁹/19! (omitted term < 3e-16 at π/2). */
function sinPoly(x: number): number {
  const z = x * x;
  return x * (1 + z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880
    + z * (-1 / 39916800 + z * (1 / 6227020800 + z * (-1 / 1307674368000
    + z * (1 / 355687428096000 + z * (-1 / 121645100408832000))))))))));
}

/** cos for |x| ≤ π/2 via Taylor through x¹⁸/18! (omitted term < 4e-15 at π/2). */
function cosPoly(x: number): number {
  const z = x * x;
  return 1 + z * (-1 / 2 + z * (1 / 24 + z * (-1 / 720 + z * (1 / 40320
    + z * (-1 / 3628800 + z * (1 / 479001600 + z * (-1 / 87178291200
    + z * (1 / 20922789888000 + z * (-1 / 6402373705728000)))))))));
}

/** Range-reduce to [−π, π] using split 2π. Exact for the sim's magnitudes. */
function reduceAngle(x: number): number {
  if (x >= -PI && x <= PI) return x;
  const k = Math.round(x * (1 / (2 * PI)));
  return x - k * TWO_PI_HI - k * TWO_PI_LO;
}

export function dsin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  let r = reduceAngle(x);
  // Fold [−π, π] into [−π/2, π/2]: sin(x) = sin(π − x).
  if (r > PI / 2) r = PI - r;
  else if (r < -PI / 2) r = -PI - r;
  return sinPoly(r);
}

export function dcos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  const r = reduceAngle(x);
  // cos on [−π, π]: fold via cos(x) = −cos(π − |x|) for |x| > π/2.
  const a = Math.abs(r);
  return a > PI / 2 ? -cosPoly(PI - a) : cosPoly(a);
}

/** atan for x ∈ [0, 1] via 4 half-angle reductions + Taylor (8 odd terms). */
function atan01(x: number): number {
  let t = x;
  // atan(x) = 2·atan(x / (1 + √(1 + x²))) — after 4 rounds t ≤ tan(π/64) ≈ 0.049.
  for (let i = 0; i < 4; i++) t = t / (1 + Math.sqrt(1 + t * t));
  const z = t * t;
  const p = t * (1 + z * (-1 / 3 + z * (1 / 5 + z * (-1 / 7 + z * (1 / 9
    + z * (-1 / 11 + z * (1 / 13 + z * (-1 / 15))))))));
  return 16 * p;
}

export function datan(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const a = Math.abs(x);
  const r = a <= 1 ? atan01(a) : PI / 2 - atan01(1 / a);
  return x < 0 ? -r : r;
}

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  // x === ±0: sign of y decides; zero/zero follows Math.atan2's zero rules.
  if (y > 0) return PI / 2;
  if (y < 0) return -PI / 2;
  if (Object.is(x, -0)) return Object.is(y, -0) ? -PI : PI;
  return Object.is(y, -0) ? -0 : 0;
}

export function dexp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.78) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x * INV_LN2);
  const r = x - k * LN2_HI - k * LN2_LO; // |r| ≤ ln2/2 ≈ 0.347
  // e^r via Taylor, fixed 13 terms (error < 1e-17 on the reduced interval).
  let term = 1;
  let sum = 1;
  for (let i = 1; i <= 13; i++) {
    term = term * r / i;
    sum += term;
  }
  return sum * pow2(k);
}

export function dlog(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  // Decompose x = m·2^e with m ∈ [√½, √2) via exponent bits.
  F64[0] = x;
  let e = ((U32[HI]! >> 20) & 0x7ff) - 1023;
  let m: number;
  if (e === -1023) {
    // Subnormal: normalize by scaling up exactly first.
    F64[0] = x * pow2(100);
    e = ((U32[HI]! >> 20) & 0x7ff) - 1023 - 100;
  }
  U32[HI] = (U32[HI]! & 0x000fffff) | 0x3ff00000; // force exponent to 0 → m ∈ [1, 2)
  m = F64[0]!;
  if (m > 1 / SQRT1_2) { m *= 0.5; e += 1; } // m ∈ [√½, √2)
  // ln(m) = 2·atanh(s), s = (m−1)/(m+1), |s| ≤ 0.1716; fixed 11 odd terms.
  const s = (m - 1) / (m + 1);
  const z = s * s;
  let term = s;
  let sum = s;
  for (let i = 1; i <= 10; i++) {
    term = term * z;
    sum += term / (2 * i + 1);
  }
  return e * LN2_HI + (2 * sum + e * LN2_LO);
}

/** Deterministic hypot: plain sqrt of squares (no overflow at sim magnitudes). */
export function dhypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
