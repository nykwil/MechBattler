# Spec 02 — Power & Heat Simulation

The deterministic engine underneath everything. The same code runs on the workshop test bench
and in the arena (rule R6). Part IDs reference the canonical catalog in
`01-chassis-grid-spec.md` §7.

## 1. Simulation ground rules

- Fixed tick: **20 Hz (50 ms)**.
- All quantities stored as integers in milli-units (mW, mJ, m°C) — no floating-point drift,
  fully deterministic, replayable from a seed.
- The only randomness in the whole sim is combat dispersion (seeded PCG32, see 03 §5).
  Power and heat are 100% deterministic.
- Units: power kW, energy kJ, temperature °C, ambient **25°C**.

## 2. Power model

### Supply

Each reactor contributes output to its connected network (routing rules in 01 §3).

| ID | Output | Waste heat | Throttle lag (0→full) |
|---|---|---|---|
| R-C40 Lump (combustion) | 40 kW | 3 kW at ≤50% load, 6 kW above | 2.0 s |
| R-C90 Furnace (combustion) | 90 kW | 7 kW / 15 kW | 3.0 s |
| R-E25 Whisper (electric) | 25 kW | 1 kW | instant |
| R-E60 Arc (electric) | 60 kW | 3 kW | instant |

**Archetype intent:** combustion buys raw watts but taxes your thermal budget (a Lump above
half load needs a dedicated radiator's worth of cooling) and responds sluggishly to demand
spikes; electric is clean and instant but watt-poor. Both plug into the same sim — the choice
re-weights which resource is your bottleneck. This replaces any need for fuel.

**Fuel: decided — none in v1.** Scrap/repair is the run's resource pressure; fuel would add
bookkeeping without adding a decision. (Backlog: could return as a run modifier.)

### Demand

| Consumer | Draw |
|---|---|
| Locomotion | P = 1.2 kW × mass(t) × speed(m/s); flank mode ×1.25 (see 03 §4) |
| W-MG Stitcher | 2 kW while firing |
| W-AC Judge | 6 kW while cycling |
| W-LAS Ember | 45 kJ/shot charged at ≤30 kW (min charge 1.5 s) |
| W-RKT Pepperbox | 1 kW |
| W-RG Longshot | 220 kJ/shot, capacitor-fed only, dump ≤220 kW over 1.0 s |
| U-TC1 Abacus | 3 kW while powered |
| U-ACT Stride | 4 kW while powered |

### Capacitors

P-CAP Jolt: stores 60 kJ, charges at ≤20 kW (from reactor headroom only), discharges at
≤80 kW. Capacitors on a network pool their limits. Cap-fed weapons (W-RG) can *only* draw
from capacitors — a railgun with insufficient capacitor bank simply cannot fire (workshop
flags this at build time).

Capacitors are what let **demand legally exceed generation**: a weapon whose firing draw
exceeds network supply still works if the capacitor bank covers the difference — the energy
balance bar goes negative (draining stored kJ) and the workshop shows time-to-empty
(01 §9 balance bars).

### Mount minimums — open question

Should weapons carry a hard build-time supply requirement ("needs ≥10 kW network supply to
mount; draws 12 kW firing, caps cover the gap")? Current stance: **warn-only** — knowingly
underpowered builds stay legal (they brown out per priority), and only physical
impossibilities are hard-blocked (cap-fed weapon with zero capacitors). The warning must be
loud: red part outline + named consequence on the stats bar ("CANNOT SUSTAIN FIRE").
Revisit after playtests; see `06-synergy-design.md` §6c.

### Brownout — the signature rule

Each tick, per network:

1. supply = Σ reactor output (throttle-lagged) ; demand = Σ active draws
2. shortfall = demand − supply, covered by capacitor discharge up to pooled limits
3. If shortfall remains: **shed consumers lowest-priority-first** until demand fits.
4. Hysteresis: a shed part stays off ≥ 1.0 s and re-powers (priority order, highest first)
   only when there is ≥ 10% headroom. No flapping.

**Priority is player-authored in the workshop** — a drag-to-order list of every consumer.
Default order: locomotion top, weapons by DPS, utilities last. The list is locked during
combat: brownout priority is a build decision, not a fifth combat verb (rule R2). This is the
"fire the huge gun, go immobile" moment made systemic: put locomotion *below* the railgun and
firing steals the legs' power; put it above and the gun waits for headroom.

## 3. Heat model

Heat lives **per cell** on the chassis grid.

- Each occupied cell has temperature T and thermal mass C: structure/part cells
  **1.0 kJ/°C**, reactor cells 2.0, U-HS heat sink 6.0. Wreck cells keep 1.0.
- Heat sources deposit kJ into their own cells (spread evenly across the part's cells).
- Conduction per shared edge per tick: q = k × ΔT, with k = **0.03 kW/°C** between ordinary
  cells and **0.12 kW/°C** for any edge touching a U-PIPE cell. Empty masked cells don't
  conduct — a deliberate air gap is a valid insulation strategy.
- U-RAD Gill radiator (perimeter only): dissipates q = **0.06 kW/°C above ambient** from its
  own cells, capped at 6 kW. (Backlog hook: terrain multiplies this — water ×3.)

### Heat sources

| Source | Heat |
|---|---|
| W-MG | 0.4 kJ/shot (4 kW at full rate) |
| W-AC | 3 kJ/shot (4 kW at full rate) |
| W-LAS | 12 kJ/shot into its own cells (avg 4.8 kW at max cadence) |
| W-RKT | 2 kJ/salvo |
| W-RG | 25 kJ/shot |
| Reactors | waste heat per table above, continuous |
| Locomotion | 0.15 kJ/s per tonne at flank speed only, deposited at core cell |

### Thresholds (per cell, checked against its occupant)

| T | Effect |
|---|---|
| 100°C | Warning (UI only) |
| 130°C | Part auto-shutdown until back under 110°C |
| 150°C | Damage: 1 HP/s per 10°C over 150 |
| 180°C | U-AMMO cook-off: part destroyed, 40 damage distributed to edge-adjacent cells |

## 4. Worked example A — the railgun Mule (fantasy check)

CH-5 Mule (30 cells, rated 6 t). Fit: W-RG (10 cells), R-C40 (4), 4× P-CAP (8), 2× U-CON (2),
U-RAD (3), 3× U-ARM (3) — all 30 cells used, the grid is literally full. Mass = 1.8 t
structure + 2.69 t parts ≈ **4.5 t**.

- Firing: 220 kJ dumped from the 240 kJ capacitor bank over 1 s. Legal (pooled discharge
  320 kW ≥ 220 kW).
- Recharge while cruising: under-loaded at 4.5 t vs 6 t rated, m_load caps at 1.15
  (03 §3), so forward max ≈ 6.9 m/s and cruise ≈ 4.5 m/s, costing 1.2 × 4.5 × 4.5 ≈ 24 kW
  of the Lump's 40 → ~16 kW headroom → **~14 s between shots on the move**. Standing
  still: full 40 kW → **5.5 s**, matching the railgun's 5 s mechanical cycle.
- Emergent doctrine, no scripting: this mech *wants* to stop to shoot — and if the player
  sets locomotion below the capacitors in priority, it visibly freezes mid-stride to feed the
  gun. That behavior was never coded; it fell out of the wattage.

## 5. Worked example B — laser boat thermal timeline

W-LAS fires every 2.5 s (1.5 s charge + 1 s cycle): 4.8 kW average heat into 3 kJ/°C of
part thermal mass = +4°C per shot locally, bleeding into neighbors at 0.03 kW/°C.

- No radiator: laser cells pass 130°C shutdown after ~40 s of continuous fire. A brawler can
  skip cooling if fights end fast — a legal, risky build.
- One radiator + heat-pipe path: equilibrium ≈ 105°C — hovering just above the warning line,
  never shutting down but one quirky "hot-running" part away from trouble.
- Two radiators: equilibrium ≈ 75°C, safe, but 6 cells and 200 kg spent on cooling.

## 6. Derived workshop stats (rule R5 — computed by this sim, shown live)

| Stat | Definition |
|---|---|
| Energy margin | supply − demand with all weapons at max cadence at cruise |
| Brownout point | which consumers shed (by name) under the above, per the priority list |
| Burst DPS | damage/s for the first 5 s from full caps |
| Sustained DPS | damage/s at t→∞ (heat- and power-limited, shutdowns included) |
| Time-to-overheat | seconds of max fire until first part shutdown (∞ if equilibrium < 130°C) |
| Speed profile | fwd/strafe/rev at each speed setting given mass and power (03 §3–4) |
| Ideal range band | from weapon envelopes (03 §7) |

The test bench runs the actual sim to produce these — they are measurements, not estimates,
so they can never lie (deck-building trust).

## 7. Numbers needing prototype validation

- Brownout hysteresis (1.0 s / 10%): enough to prevent flapping without feeling laggy?
- Conduction k = 0.03: do thermal gradients across a large chassis feel meaningful, or does
  everything equalize into one blob temperature?
- Combustion waste heat: is one radiator per reactor the right tax, or too punishing on
  small chassis?
- Laser equilibrium at 105°C with one radiator is deliberately knife-edge — confirm it reads
  as tension, not noise.
