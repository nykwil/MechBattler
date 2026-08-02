# MechBattler Spatial Construction Mechanics

**Design capture: regional grids, ports, routing, stacking, location modifiers, armour, and directional damage**

> **Implemented vertical slice (sim 2.0, July 2026).** This document began as
> exploratory design. The contract below records the decisions now implemented
> and supersedes the open alternatives later in the capture.
>
> - Mule has three visibly separate workshop grids: upper-left shoulder,
>   central body, and upper-right shoulder. Empty rows and columns separate the
>   regions; they never render as overlapping cells,
>   joined by two immutable shoulder ports.
> - Bus and heat pipe are free routing layers. They may share a cell, weigh
>   15 kg and 20 kg per cell respectively, and cannot remain beneath equipment.
>   Placing equipment stamps out both routes under its footprint. Bus paths
>   carry 60 kW.
> - Every fitted component conducts up to 60 kW between its own cells,
>   edge-adjacent equipment, its stack, and a port beneath it unless authored
>   with a different capacity. Bus is the way to cross empty cells.
> - The damageable `Power coupler` and `Thermal manifold` parts are equipment,
>   not duplicate routes. They consume equipment space and provide a damageable
>   alternative to routing across a port.
> - Bus and heat-pipe routes may occupy port endpoints. Electrical ports are
>   sockets: equipment fitted over one endpoint, including a gun, draws power
>   when the linked endpoint is energized. Heat transfer still requires a heat
>   pipe or compatible thermal equipment. Destroying transfer equipment can
>   break downstream connectivity; routes and ports themselves are not targets.
> - Clicking an existing Bus or Heat pipe while using the same routing tool
>   removes that layer. Each route is drawn from its cell centre only toward
>   connected neighbours; the two centres are offset so both remain readable.
> - Equipment layers are support, payload, and armour. The first shipped stack
>   is `Carapace -> Stitcher -> Gimbal`: a 1x2 60 HP/180 kg sealed shell over a
>   1x2 weapon over a 1x2, 2 kW turret that carries 60 kW and grants +25 degrees
>   of weapon arc.
> - Sealed armour multiplies covered equipment heat by 1.25 and blocks its
>   exterior passive cooling. Uncovered exterior cells passively cool at
>   0.01 kW per degree above ambient. Coolant uses the high-conductance thermal
>   layer. A destroyed shell stops protecting, sealing, and heat-penalizing the
>   payload beneath it; destroyed thermal bridge equipment also severs its path.
> - Location effects are authored as reusable chassis-cell zones. A part earns a
>   zone effect only when its whole footprint fits in that zone. Mule shoulder
>   cells are `Articulated shoulder` locations and grant weapons +25 degrees of
>   targeting arc; the same resolver supports authored range and heat modifiers.
>   Exterior cooling and directional exposure are derived location effects.
> - Accuracy decides hit or miss. A hit then samples uniformly from one ticket
>   per directionally exposed equipment cell plus authored chassis tickets
>   (Vulture 6, Mule 10, Bastion 18). Thus a Mule with six exposed
>   equipment cells has 16 tickets and a 62.5% chassis-hit chance even at
>   perfect accuracy.
> - A selected cell resolves armour, payload, then support. Surplus damage goes
>   to the global chassis-integrity pool and never continues into another
>   equipment cell. Multi-cell parts share HP; later shots can expose deeper
>   cells as parts fail.
> - Chassis damage persists after victories and costs 0.2 scrap per percentage
>   point to repair. Disabled owned equipment remains fitted at 0% condition as
>   a repairable wreck. Every battle defeat ends the run.
> - Placement preview names the region and consequential bonuses before commit.
>   Cell marks identify exterior cooling and authored location zones. Selecting
>   a fitted part reports its port occupancy, power, active cooling, effective
>   arc/range/heat, stack damage order, and direct/protected exposure from all
>   four directions. Power and thermal overlays distinguish energized/stranded
>   Bus, live/idle ports, bottlenecks, and radiator-linked/isolated heat pipe.
> - Save schema v4 is an intentional reset. Pre-v4 profiles, runs, history, and
>   blueprints are not migrated. Piercing, melee/final attacks, damaged ports,
>   route damage, and per-region chassis HP remain future work.

## 1. Purpose and Scope

This document captures the current design direction for MechBattler's spatial construction system. It is deliberately implementation-agnostic. The goal is to preserve the rules, player-facing interactions, and design possibilities without prematurely fixing data structures, simulation formulas, UI details, or technical architecture.

The mech is temporary and exists for a roguelike run of roughly one hour or less. Construction therefore needs to create meaningful engineering decisions while remaining fast enough for repeated rebuilding during a run.

### Current design principles

- The large inventory-like grid remains the core building interaction.
- Placement matters: location, adjacency, routing, exposure, and stack order all influence performance.
- Systems should share a small number of consistent rules rather than becoming separate minigames.
- Players should be able to understand why a component works, overheats, loses power, or is damaged.
- The system should support believable mech silhouettes without hiding the fact that the player assembled the machine from visible parts.
- Complexity should emerge from combinations of simple rules, not from many unrelated exceptions.

## 2. High-Level Mech Structure

A mech may be composed of multiple local grid regions rather than one perfectly flat rectangular board. Example regions include:

- Head or sensor section
- Torso or central body
- Left and right arms or weapon sections
- Backpack or support section
- Pelvis and leg sections

The exact number and shape of regions are not yet fixed. The important idea is that regions can have different shapes, spatial identities, and local bonuses while remaining part of one connected mech.

### Region connections and ports

Grid regions connect through designated **ports** associated with joints or structural connections, such as a neck, shoulder, hip, or backpack connection.

- A port is a special cell location that connects one region to another region, or potentially to multiple connected regions.
- Wires and coolant lines may be placed directly on a port cell.
- Any equipment component can occupy an electrical port cell; thermal transfer
  still requires compatible equipment.
- Electricity crosses to any equipment fitted directly over a port when its
  linked endpoint is energized. Heat crosses through matching heat-pipe routes
  or compatible thermal equipment.
- Route-to-route transfer uses the route's standard capacity or conductance.
- Equipment can instead act as a damageable bridge; its transfer properties
  determine capacity or conductance and its destruction can sever the link.

This makes ports real spatial decisions rather than invisible universal connections.

### Example route

A laser mounted in a leg could receive power from a power source in the head through a continuous chain:

`Head power source -> adjacent Bus -> head port Bus -> connected torso port Bus -> torso Bus path -> hip port coupler -> leg port coupler -> leg Bus -> leg laser`

The route may work well, work poorly, or fail depending on the cells and components bridging each section.

## 3. Grid Cell Occupancy

The grid supports two broad categories of occupants: **routing** and **equipment**.

### Routing cells

A routing cell may contain:

- One electrical wire
- One coolant line
- One electrical wire and one coolant line together

The shared wire/coolant occupancy is a deliberate stacking-like interaction. It allows utility routes to cross the same cell without making every connection consume separate board space.

### Equipment cells

An equipment cell contains part of an equipment component, such as a gun, reactor, battery, heat sink, targeting computer, turret, structural piece, or armour shell.

- Equipment does not share a cell with a wire or coolant line.
- Wires and coolant connect to equipment through adjacency.
- A multi-cell component can define different properties for each cell in its footprint.
- Most equipment cannot stack with other equipment unless an explicit stacking relationship allows it.

### Adjacency

Power and coolant reach equipment by touching a valid cell of that equipment from a neighbouring routing cell.

Examples:

- A wire beside a gun can power the gun.
- A coolant line beside a hot component can remove or transfer heat.
- A wire does not sit underneath or inside a gun.
- A coolant line does not occupy the same cell as the component it cools.

The exact adjacency directions and connectivity rules are left to implementation, but adjacency is the player-facing mental model.

## 4. Equipment Cell Properties

Each occupied cell within a piece of equipment may carry properties that determine how systems pass through it.

Possible properties include:

- Electrical input and output behaviour
- Electrical capacity or resistance
- Heat generation
- Thermal conductivity or insulation
- Heat capacity
- Coolant interaction
- Valid connection directions
- Whether the cell can bridge a port
- Damage state or disabled state

Every component transfers standard electrical power. Thermal transfer and any
authored electrical capacity overrides remain component properties.

Examples:

- A structural frame transfers electricity and heat well.
- A battery accepts and provides electricity, potentially with an authored
  capacity limit.
- A heat sink may transfer and absorb heat well.
- An insulated component may deliberately prevent heat spread.
- Armour still conducts standard power but may be thermally restrictive.

This supports clever layouts without requiring separate bespoke logic for every part type.

## 5. Electricity

Electricity is routed through wires and every fitted equipment cell.

### Core rules

- Wires occupy routing cells.
- Equipment receives power from adjacent wires or powered equipment.
- Power passes through touching equipment, across a multi-cell part, and through
  functional stacks at the standard 60 kW capacity unless explicitly overridden.
- Power crosses between grid regions through Bus or equipment on the linked port
  endpoints.
- A component can become an electrical bottleneck because of an authored lower
  capacity or damage.

### Centralized and distributed power

The system naturally supports different build identities:

- A centralized reactor with long power routes is space-efficient but creates critical connection points.
- Local batteries or capacitors reduce dependency on distant ports but consume valuable component space.
- Redundant routes can improve resilience but consume routing space.
- High-power weapons may work in unusual locations only when the route and port bridge can support them.

## 6. Heat and Cooling

Heat is generated by equipment and transferred through compatible equipment cells and cooling systems.

### Core rules

- Components generate heat according to their behaviour.
- Heat can transfer between adjacent cells and through components according to their thermal properties.
- Heat can cross between grid regions through equipment occupying port cells.
- Coolant lines occupy routing cells and interact with equipment through adjacency.
- Exterior and enclosed locations may modify cooling or heat generation.

### Location-based cooling

Cells can have inherent environmental properties. A likely example is improved passive cooling on exposed exterior cells.

Possible location effects include:

- Increased passive cooling on outside cells
- Reduced passive cooling in enclosed or central cells
- Heat-generation multipliers in cramped or poorly ventilated areas
- Special cooling benefits on backpack or radiator-facing locations

### Armour and heat

Armour should make covered equipment harder to cool, but the exact simulation is not fixed. A simple player-facing rule may be preferable to a complex thermal enclosure model.

Possible expressions include:

- Armour adds a flat amount of heat while the protected component operates.
- Armour applies a heat-generation multiplier.
- Armour reduces the cooling bonus of the covered cell.

The current preferred direction is that armour can simply add heat or a heat multiplier. This creates the intended protection-versus-cooling trade-off without requiring armour to participate in the full heat-transfer network.

## 7. Location Modifiers

Bonuses and penalties can belong to **cell locations** rather than being authored directly onto the equipment placed there. Equipment placed in or stacked over those cells receives the resulting spatial behaviour.

This lets chassis shape and body region matter while keeping components reusable.

### Candidate location modifiers

- Exterior cells: bonus passive cooling, but greater exposure to damage
- Articulated or turret-supported cells: increased targeting arc
- Leg cells: reduced range, restricted targeting, improved stability, or another leg-specific trade-off
- Protected central cells: reduced exposure, but worse cooling
- Forward cells: better weapon access or greater incoming-damage priority
- Rear cells: cooling or support bonuses, but vulnerability to flanking
- Port cells: connection between body regions, requiring a component bridge
- Enclosed cells: heat multiplier

Numbers discussed during exploration included examples such as:

- `+25 degrees effective targeting arc`
- `-5% weapon range on leg locations`
- Bonus cooling on outside cells

These values are examples, not commitments.

### Design intent

Location effects should create behaviour players can understand spatially. The game should avoid filling every cell with unrelated small percentage modifiers. A small vocabulary of recognizable location types is preferable.

## 8. General Stacking System

Stacking should be treated as one reusable interaction with explicit compatibility rules, not as unrelated special cases.

A stack represents multiple equipment elements occupying the same footprint in a defined order. The interface may use the same drag-onto interaction for all compatible stacks.

### Currently supported or proposed stack relationships

1. **Wire + coolant line**
   - Both can occupy the same routing cell.
   - Neither shares a cell with equipment.

2. **Turret mount + gun**
   - The turret occupies the lower equipment layer.
   - A compatible gun stacks on top of the turret.
   - The turret receives power through normal adjacency and supplies power to the gun.
   - The turret applies targeting-arc or articulation effects to the supported cells/weapon.

3. **Armour + component**
   - Armour stacks over a compatible component.
   - Armour is not a free global exterior layer; it is a real acquired component or shell associated with the protected footprint.
   - Armour may stack with any normal component, subject to footprint and compatibility rules.
   - Armour protects the component beneath it and affects heat, but does not need electrical power.

No other equipment stacking relationships are currently assumed.

### Stack order

A representative stack is:

`Armour -> Gun -> Turret -> Grid location`

Visually and for damage, armour is the top layer. Functionally, the turret is the supporting lower layer and the gun is mounted on it.

### Transfer direction through a stack

The simple conceptual rule is **bottom-up functional transfer**:

- A wire adjacent to the turret powers the turret.
- The turret passes power to the gun.
- Armour does not need to be powered and is not part of that electrical chain.

Each stackable item may still define its own heat and electricity behaviour. The exact calculation order is an implementation detail.

## 9. Turret Mounts

Turret mounts are a strong example of the stacking and location-modifier systems working together.

- A turret stacks beneath a compatible gun.
- The turret can apply targeting-arc bonuses to the cells it occupies or supports.
- A turret may alter how the gun aims, rotates, or tracks targets.
- The turret is powered through ordinary adjacency.
- The turret then powers or enables the gun above it.
- The turret may have its own heat and electricity transfer behaviour.

A maximum supported weapon weight was discussed but is **not part of the current design**. Heat, electricity, footprint, and location already provide several constraints, so a weight rule should only be added if it creates a distinct useful decision.

## 10. Armour Shells

Mechs are expected to display most components visibly by default. Armour shells are optional parts acquired during the run that cover and protect selected components, gradually making the machine look more complete and purpose-built.

### Armour rules

- Armour is a stackable component placed over another component.
- Armour uses the same general stacking interface as turret/gun relationships.
- Armour protects the component or stack beneath it.
- Armour does not require power.
- Armour can increase heat or reduce cooling for the covered equipment.
- Armour may have its own footprint, health, visual shell, and compatibility.
- When armour is destroyed, the equipment beneath becomes exposed.

### Why armour is not free

Although armour shares a footprint with the protected component, it remains a real part in the run economy and stack. Choosing armour means choosing protection and visual integration instead of another available upgrade or stackable option.

### Visual effect

Early builds may look skeletal and improvised, with visible batteries, guns, reactors, and routing. As players acquire shells, selected systems become enclosed in authored armour forms such as torso casings, shoulder pods, shin armour, weapon housings, or backpack shells.

## 11. Directional Damage Priority

Damage should respect the spatial construction of the mech.

### Forward-cell priority

When an attack arrives from a direction, cells closest to that direction are damaged before cells behind them.

Examples:

- A frontal attack prioritizes the forwardmost occupied cells.
- A rear attack prioritizes the rearmost occupied cells.
- Side attacks prioritize the nearest cells on that side.

As forward components are destroyed, deeper components become exposed. This creates natural protection through placement without requiring a separate abstract armour rating for the entire mech.

### Damage through stacks

Within a selected cell, damage resolves from the top of the stack downward.

Representative order:

1. Armour
2. Gun or primary component
3. Turret or support component beneath it
4. Underlying structure, if represented

The exact handling of excess damage between layers is not yet fixed.

### Multi-cell components

A multi-cell component can be hit through any occupied cell. Whether it has shared health, per-cell health, or partial degradation is intentionally left open. The important design requirement is that its placement and exposed cells affect how easily it is attacked.

### Piercing

Piercing is considered a compatible future extension, but not a required first-pass feature.

A piercing attack could continue:

- Through multiple layers in a stack
- From a forward component into components behind it
- Through several cells along the attack direction

This allows armour, internal placement, and component depth to remain meaningful if piercing is introduced later.

## 12. Combined Examples

### Armoured turret laser on an exterior leg cell

The cell location might provide:

- Exterior cooling bonus
- Leg-specific range, stability, or targeting modifier
- High directional exposure

The stack might contain:

1. Armour shell
2. Laser
3. Turret mount

The surrounding grid provides:

- Adjacent wire powering the turret
- Turret powering the laser
- Adjacent coolant line cooling the stack
- A port-bridging component elsewhere connecting the leg grid to the torso

The resulting behaviour combines location, adjacency, stack order, port connectivity, power, heat, cooling, and directional damage without requiring separate one-off rules.

### Protected reactor behind forward components

A reactor is placed deeper in the torso grid, with less important or armoured components in front of it.

- Frontal attacks damage forward cells first.
- Exterior cells cool better but are more exposed.
- Central placement protects the reactor but may make cooling harder.
- Power routes must still reach other regions through port bridges.

### Port bridge choice

A hip port cell can be occupied by different components:

- Conductive structural component: reliable power and heat transfer
- Heat sink: strong thermal bridge and local heat capacity
- Insulated component: poor heat transfer, possibly useful for isolating a hot region
- Functional component with mediocre passthrough: saves space but creates a bottleneck

The port does not require a special dedicated connector item in every case; ordinary equipment can bridge it if its cell properties allow it.

## 13. User-Facing Readability

The system will only be fun if players can see the consequences of placement before committing.

Useful feedback may include:

- Which adjacent routing cells currently power or cool a component
- Whether a port is successfully bridged
- Electrical and thermal bottlenecks
- The cells affected by a turret's targeting bonus
- Location bonuses and penalties on hover
- The effective stack order
- Which layer will receive damage first
- Which components are currently forwardmost from each attack direction
- How armour changes heat and cooling

The exact interface is not specified here. The requirement is that these systems remain inspectable rather than hidden.

## 14. Current Boundaries and Non-Decisions

The following are intentionally not fixed:

- Exact number and shape of body-region grids
- Whether every mech uses the same regional layout
- Exact electrical, heat, or coolant formulas
- Exact direction and range of adjacency
- Exact port topology and whether a port can connect more than two regions
- Exact stack depth and footprint compatibility
- Whether armour adds flat heat, multiplies heat, or reduces cooling
- How excess damage transfers between stack layers
- Shared versus per-cell health for multi-cell components
- Final list and numerical values of location modifiers
- Whether piercing ships in the first version
- Whether weight or maximum supported weapon mass is ever added

## 15. Current Core Rules Summary

- Mechs are built from one or more connected grid regions.
- Ports connect regions through designated cells.
- Wires and coolant can occupy port cells. Any equipment on an electrical port
  conducts through it; heat still requires compatible equipment.
- An energized electrical port powers equipment fitted directly over its linked
  endpoint; heat transfer requires matching routing or compatible equipment.
- A routing cell can contain a wire, coolant, or both.
- Clicking the active route layer removes it; placing equipment stamps out both
  route layers beneath its footprint.
- Equipment and routing do not remain in the same cell and connect through
  adjacency.
- All edge-adjacent equipment conducts standard power; Bus crosses empty cells.
- Equipment cells can define electricity and heat-transfer properties.
- Stacking is allowed only through explicit compatibility rules.
- Armour stacks over components.
- Guns can stack over turret mounts.
- Turrets receive power through adjacency and can power the gun above.
- Armour does not require power and may add heat or reduce cooling.
- Location modifiers belong to grid cells and shape component behaviour.
- Exterior cells can provide cooling bonuses and increased exposure.
- Damage prioritizes cells nearest the incoming attack direction.
- Damage resolves from the top of a stack downward.
- Piercing can later extend damage through both stacks and depth.

## 16. Design Goal

The desired result is a construction system where the player can make quick, readable decisions during a short roguelike run, while still discovering clever interactions among space, adjacency, power, heat, cooling, protection, firing arcs, body regions, and damage direction.

The system should make a mech's layout matter in combat and make the final machine visibly reflect the player's engineering choices.
