# Spec 05 — Risk Review: Fun-Killers & Mitigations

An adversarial pass over specs 00–04. Each risk gets: why it kills the game, what the specs
already do about it, what to add, and a **kill criterion** — a concrete prototype test that
tells us the mitigation failed and escalation is needed. These tests are the prototype's
acceptance suite; build them, don't vibe them.

## R1 — Routing tedium

*The fear*: power/coolant routing degenerates into busywork — dragging conduits is a chore
you repeat every refit, and the "spatial puzzle" is really just "leave a channel of 1×1s."

- Already mitigated: adjacency-counts-as-connection (01 §3) makes small/dense builds
  routing-free; coolant is optional (passive conduction is the default, pipes are an
  optimization, 01 §4); conduits are cheap tier-1 parts.
- Add: **auto-route suggestion button** in the workshop (proposes a minimal conduit set for
  orphaned parts; player accepts or hand-routes). Keep manual routing for those who love it;
  never require it for those who don't.
- Kill criterion: in playtests, if conduits exceed **20% of occupied cells** on typical
  builds, or testers report re-routing every refit, collapse conduits to edge-drawn lines
  (no cell cost) and keep only capacity limits.

## R2 — Passive combat (watching is boring)

*The fear*: hands-off battles are a screensaver; the player alt-tabs, and the loop's payoff
beat is dead.

- Already mitigated: fights are short (30–120 s); readability effects make the mech's stress
  visible (03 §9); the four-verb layer gives lean-in moments without demanding them; the
  post-battle report makes even a loss useful.
- Add: the framing matters — the battle is **the payoff of a bet placed in the workshop**.
  Pre-fight, show the intel card next to your ideal-range ring so the player forms a
  prediction ("I out-range him; this should be a kite"). Watching is then hypothesis-testing,
  not spectating. Cheap juice priorities: capacitor drain bars, railgun recoil shove,
  cook-off bangs.
- Kill criterion: if testers routinely look away mid-fight or ask for an instant-resolve
  button in the first session, combat pacing has failed — escalate with mid-fight decision
  pressure (e.g. one-use "overdrive" order) before considering shorter fights.

## R3 — Wiggle-war degeneracy

Covered in depth in 03 §8 (resolved for v1 with four systemic costs and no explicit rule).
Kill criterion restated: weave-vs-straight autopilot batch sims; > 65% win rate for weaving
across three matched pairs triggers the escalation levers (lateral-accel accuracy penalty,
base prediction quality 0.4 → 0.5).

## R4 — Degenerate builds and dominant strategies

*The fear*: one archetype (stationary railgun turret; max-armor timeout judge-bait; MG swarm)
invalidates the catalog.

- Already mitigated: envelopes create rock-paper-scissors by geometry (a turret with an
  80–240 m gun is helpless under 80 m; a brawler must cross the sniper's band to get there);
  timeout judging counts % functional mass so turtling still requires winning the damage
  exchange (03 §1); enemy variety across the ladder punishes over-specialization because the
  *player picks opponents* — but bosses are mandatory and hand-authored to audit specific
  degeneracies (node-4 boss punishes pure turrets, node-8 punishes pure kiters).
- Add: prototype includes a **round-robin balance harness** — every starter/template build
  vs. every other, seeded, headless (the engine-agnostic sim makes this nearly free,
  rule R6). Run it on every tuning change.
- Kill criterion: any template with > 70% win rate across the round-robin gets a targeted
  nerf; if a *class* of strategy (e.g. never-move) dominates regardless of numbers, revisit
  arena/objective design (v1.5 obstacles, spawn randomization).

## R5 — Analysis paralysis in the workshop

*The fear*: power + heat + routing + mass + priority list + arcs is too many interlocking
systems; new players freeze at fight 1.

- Already mitigated: derived stats are measurements, not estimates (02 §6) — the test bench
  answers "is this better?" empirically; starter kits are pre-laid-out (04 §6); sane
  defaults everywhere (auto brownout priority, autopilot handles combat entirely).
- Add: **progressive disclosure**: run 1 needs only "place parts, keep numbers green."
  Priority reordering, pipes, and arc tuning are visible but never required early — enemy
  budgets at nodes 1–3 are beatable with naive builds. Tooltips carry the one-line physics
  ("This weapon draws 6 kW while cycling").
- Kill criterion: if first-session testers can't field a working mech inside 10 minutes or
  don't understand *why* their test-bench DPS changed, simplify the v1 surface (e.g. fold
  heat sinks into radiators) rather than adding tutorials.

## R6 — Salvage RNG frustration

*The fear*: runs die to drop luck, not decisions; or loot is all junk and refitting stalls.

- Already mitigated: intel-driven opponent choice makes loot semi-deterministic (you hunt
  what you need, 04 §5); victory type shapes drops (04 §2); scrapyard nodes provide a
  fallback converter; quirks are 70% absent and 1/3 gifts.
- Add: a light **pity rule** — if the bench pool and mech contain no weapon above 40%
  integrity after salvage, the next node set is guaranteed to include an opponent carrying a
  healthy weapon of the player's most-used class.
- Kill criterion: > 10% of losses in playtest logs attributable to "no functional weapon
  available" (measured, not felt) → strengthen pity or raise loot integrity floor.

## R7 — Scope creep toward the wrong game

*The fear*: the RTS layer grows verbs, the sim grows subsystems, and we ship a worse Mech
Engineer instead of the workshop roguelike.

- Guardrails already in the constitution: R2 (four verbs — features must become emergent,
  not new buttons) and R3 (hands-off viable). The backlog (00) is the pressure valve: ideas
  get *captured* there, not implemented.
- Add: any proposal that adds a mid-combat interaction must pass this test: *"Could a player
  who ignores it still win with a better build?"* If no, reject.
- Kill criterion: if playtesting shows manual orders are *required* to beat mid-ladder
  nodes, the autopilot is under-powered — fix the autopilot, never the requirement.

## R8 — Simulation opacity (trust collapse)

*The fear*: the player stops believing the sim ("it just decided to lose"), at which point
engineering feels like superstition.

- Already mitigated: determinism + seeds (02 §1) make every claim checkable; post-battle
  report timestamps every shed/shutdown/part-loss (03 §9); workshop numbers come from the
  real sim.
- Add: every failure toast names its cause chain in plain language: "Laser shut down —
  132°C — radiator destroyed at 0:41." One sentence, three links: symptom, threshold, cause.
- Kill criterion: testers saying "I don't know why I lost" more than once per session.

## R9 — Tech-stack drift

*The fear*: sim logic leaks into React components / Pixi scenes; the engine-agnostic core
(and with it headless balance testing, replays, and the future 3D port) quietly dies.

- Mitigation is structural, from day one: `sim/` package with **zero imports** from UI or
  rendering; UI consumes sim state via a read-only snapshot per tick; orders enter as a
  serializable command list. CI check: `sim/` builds and runs its batch tests headless in
  Node with no DOM.
- Kill criterion: the day a rendering concern needs to live in `sim/` to work, stop and
  refactor before proceeding.

## Priority order for the prototype

R1 and R2 are existential (they attack the two pillars the whole game stands on) — the
pillar-1+2 prototype (grid editor + test bench) targets R1/R5 first, then the arena targets
R2/R3/R4. R6–R8 are addressable in the economy pass. R7/R9 are standing disciplines, not
milestones.
