# MechBattler

A roguelike where the game is the workshop: engineer a jury-rigged mech on a physical chassis
grid — balancing power, heat, mass, and routing — then watch it fight under its own doctrine,
salvage the wreck, and bolt the loot onto your frankenstein machine.

**Status: design phase.** No code yet. The current deliverable is the design document set
below; the next phase is a web prototype (React + TypeScript workshop, PixiJS arena, pure-TS
deterministic sim core) of the grid editor + test bench.

## Design documents

| Doc | Contents |
|---|---|
| [docs/00-core-design.md](docs/00-core-design.md) | Pitch, player fantasy, core loop, design rules, prior art, tech stack, backlog |
| [docs/01-chassis-grid-spec.md](docs/01-chassis-grid-spec.md) | The chassis grid, power routing, locational damage, canonical part catalog |
| [docs/02-power-heat-spec.md](docs/02-power-heat-spec.md) | Deterministic power/heat sim, brownout priority, worked examples |
| [docs/03-combat-spec.md](docs/03-combat-spec.md) | Arena, the four command verbs, ballistics/dead reckoning, autopilot, readability |
| [docs/04-salvage-economy-spec.md](docs/04-salvage-economy-spec.md) | Salvage, integrity/quirks, repair economy, 12-node run ladder |
| [docs/05-risk-review.md](docs/05-risk-review.md) | Fun-killer risks, mitigations, and prototype kill criteria |

## The two mechanics with no precedent — protect these

1. **Physical power/coolant routing on the chassis grid** — parts need real conduit paths;
   severing one mid-fight kills everything downstream.
2. **Player-set brownout priority** — when demand exceeds supply, *you* decided in the
   workshop whether the legs or the gun go dark.
