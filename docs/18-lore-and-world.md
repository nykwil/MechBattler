# 18 — Lore and world foundation

Status: directional narrative foundation (Aug 2026). This document records the ideas that
are established enough to guide future design. It does not replace the implemented run,
economy, or progression contracts in `13-full-game-experience.md` and
`16-progression-loop-foundation.md`. Where those documents disagree with this one, they
describe the current game; this document describes a possible narrative structure to
reconcile with it later.

## 1. Tone and premise

MechBattler takes place in a world where people knowingly use enormous, improvised machines
to settle conflicts that would otherwise become wars. The world understands that this is
theatrical, inefficient, and sometimes grotesque, but it never treats the stakes lightly.
A fight may be spectacular; the river, road, mine, or sanctuary at stake still determines
whether a community survives.

The intended tone is self-aware without becoming flippant. A mechanic may recognize the
absurdity of attaching a mining drill to a civic monument, but the people who built it have
real reasons for doing so.

There is no artificial intelligence in the setting. No machine secretly directs history,
chooses opponents, or assigns meaning to victories. The battle culture, its institutions,
and its failures are all human creations.

## 2. The Compact

After old wars nearly destroyed civilization, surviving powers established a body of law
known as **the Compact**. Its central principle is that communities do not settle recognized
disputes through armies. They represent a claim with a single machine in limited, public,
witnessed combat.

The Compact is maintained by people: judges, engineers, archivists, civic officials, arena
cities, and the communities that continue to accept its authority. Centuries of precedent
have created rituals, regional variations, loopholes, and conflicting interpretations.
The system continues not because it is perfect, but because every major power fears the
return of unrestricted war.

Mechs grew out of legal and engineering escalation. Communities concentrated more and more
industrial capacity into the one machine permitted to represent them. Industrial walkers
became strange, specialized combatants built from weapons, tools, infrastructure, and
irreplaceable local craft. Nobody designed the modern mech as a coherent technology; it is
the accumulated result of generations arguing through machines.

A mech is therefore more than a vehicle. It is a community's current argument, made from
its labour, resources, history, and priorities.

## 3. Claims

A **Claim** is an authored, consequential sequence of battles over a defined civic outcome.
It functions like a badge run: a known territory or right, a fixed roster of named
opponents, a recognizable final champion, and a mechanical theme the player can prepare
for. Claims vary in difficulty and can be pursued according to the community's needs.

Possible Claims include:

- **River Claim** — clean water, irrigation, or industrial cooling.
- **Iron Claim** — access to mines and heavier fabrication.
- **Road Claim** — a reopened trade route and contact with new neighbours.
- **Sanctuary Claim** — protection for refugees and access to new skills and cultures.
- **Crown Claim** — formal recognition or independence from a regional power.

The player represents a small community and chooses which problems to address. Each Claim
is a compact story rather than a random bracket. Opponents should have human reasons to
fight, and victory should permanently change the community rather than merely award a
larger number.

The variable roguelike element inside a Claim is how the player builds, repairs, salvages,
and adapts their mech against its known roster. The exact format and length of a Claim must
be reconciled with the current twelve-node run before it becomes an implementation rule.

## 4. The Circuit

The **Circuit** is the always-available form of sanctioned mech combat. It is the everyday
competitive culture surrounding the rarer political Claims: open exhibitions entered by
communities, workshops, pilots, guilds, manufacturers, and other institutions.

Circuit battles may award:

- salvage and trade goods;
- prestige and qualification;
- prototype rights and research data;
- contact with unfamiliar pilots and factions;
- opportunities to prove an experimental design.

No territory changes hands in the Circuit. This makes procedurally generated opponents and
difficulties natural: the player is entering a large competitive ecosystem and is not
expected to recognize every participant.

The Circuit is the repeatable roguelike loop. It lets the player discover parts, field-test
research, earn things to trade, learn faction building styles, and prepare for Claims
without simply grinding permanent combat power.

The broad rhythm is:

`Circuit → town → research and trade → Circuit → town → Claim → permanent town change`

The Circuit is not the narrative itself. It is the ordinary battle culture within which
the larger narrative occurs.

## 5. Witnesses

A mech that wins a Claim becomes a **Witness**. It is installed at the place or institution
its victory secured: above a reservoir, at a mine entrance, beside a reopened road, or in a
public square.

A Witness serves several roles at once:

- physical and legal proof of the Claim;
- a public monument and civic landmark;
- a deterrent to challengers;
- an archive of the community's engineering;
- a quasi-religious icon surrounded by stories, offerings, and ceremony.

This is why a Claim-winning mech does not return to the player's active inventory. It must
remain present as the continuing embodiment of the victory. Its unusual components and
awkward compromises become part of public memory. Over time, people decorate it, argue
about its preservation, and build a district around it.

Circuit mechs are temporary. They may be lost, stripped, retired, or studied. Witnesses are
permanent, which gives Claim victories a different emotional meaning even when both modes
use the same construction and combat systems.

### Trials of Continuance

An old Claim can occasionally be challenged through a **Trial of Continuance**. The original
Witness must be brought back into service to defend what it won. This creates rare battles
where the player rediscovers an old build rather than bringing the newest optimized mech.

The machine may be weathered, maintained with replacement materials, or facing a modern
opponent designed to exploit its weaknesses. Repairs can be permitted, but altering it too
far raises the question of whether it is still legally and culturally the same Witness.
Awakening one should feel like a major event for the district that grew around it.

## 6. The town

The town is the emotional half of the game: a compact, tactile hub built around repeated
visits and familiar people, not a detailed municipal-management simulation. The battles
ask what the player can win; the town asks what the community does with it.

After a successful Claim, the player makes one meaningful choice about how the new asset is
used. Water might support irrigation, public baths, or industrial cooling. A mine might
support fabrication, civic construction, or trade. The choice unlocks different options
and visibly changes the town.

Between expeditions, the player can:

- send goods and fulfil requests for neighbouring communities;
- submit rare finds and field-tested prototypes for research;
- collect completed blueprints and incoming trade packages;
- visit and care for past Witnesses;
- have brief, evolving conversations with familiar residents;
- prepare the next Circuit entry or choose an available Claim.

Town growth should happen around the player. Workshops expand, stalls open, decorations
accumulate, and Witness districts take on distinct identities. The player contributes to
this growth without placing every building, assigning every worker, or maintaining a
production spreadsheet.

Hub progression should broaden choices rather than inflate combat statistics. The fantasy
is not efficient municipal management; it is returning from dangerous battles and watching
a home take shape around the things the player fought for.

## 7. Research, trade, and resources

New components discovered during a run can begin as **undocumented prototypes**. They may
be used immediately, but permanent access requires field evidence and time in the workshop.
Completing battles with a prototype installed should be especially valuable because the
winning build supplies credible operating data.

Research is better expressed in **town days** than as an abstract point total. A prototype
occupies a limited research slot, each completed match advances the town, and related
manuals or additional field evidence can accelerate the work. When research completes, the
blueprint permanently broadens the player's starting possibilities.

The resource model should remain small and legible:

- **Goods** — common surplus used for civic work and neighbour deliveries. The fiction can
  vary by source without requiring a separate currency for every material.
- **Technical Finds** — manuals, fragments, unusual materials, and old tools used to begin
  or accelerate blueprint research.
- **Favour** — relationship capital earned by helping neighbours and used to request rare
  opportunities, prototypes, or specialist access.

A Claim itself is never a currency. Water rights, a mine, a road, or a sanctuary are
permanent civic assets with visible consequences.

Combat consumables are not part of this foundation. If single-use preparations are added,
they should change information or opportunity—such as revealing rewards, requesting a
component family, or preserving research data—not provide direct battle power.

## 8. Visual and cultural direction

The visual language draws from Constructivism and other pre-digital industrial and civic
art without depicting a specific real-world ideology. A useful internal label is
**Civic Machine Modernism**.

Its influences can include:

- Constructivist geometry, movement, and public scale;
- Bauhaus functionalism;
- early railway and aviation posters;
- public murals and monumental civic architecture;
- industrial diagrams, catalogues, stencils, and engineering manuals;
- local folk patterns and ceremonial traditions.

The material world should favour painted steel, concrete, canvas, enamel, rivets, cables,
gauges, physical switches, hand-painted numbers, and exposed structure. Interfaces should
feel closer to a printed engineering manual crossed with a civic poster than to a hologram
or computer terminal.

This is a world where public art, engineering, religion, and law never fully separated.
Different communities use the shared visual grammar differently: one treats a Witness as a
saint, another as a legal monument, another as a public machine covered in harvest murals.
Avoid direct copies of Soviet symbols, uniforms, slogans, or imitation Cyrillic; those would
collapse a broader fictional culture into a single historical reference.

## 9. Narrative direction still under exploration

The player's clearest established motivation is fighting for a growing community. Early
victories answer immediate needs; later success creates new dependencies, borders,
expectations, and pressures. The emerging thematic question is whether protecting a
community can be separated from endlessly expanding its Claims.

One possible antagonist is a former Claimant whose small settlement grew into a regional
power. They still justify every battle as protection and have found a legal way to keep a
legendary Witness in near-continuous service. This would contrast the player's stationary
monuments with a national monument that never stops marching.

That antagonist, the exact origin and wording of the Compact, and the final central conflict
are not canon yet. They should remain exploratory until the Claim/Circuit structure, town
scope, and implemented progression loop are reconciled.

## 10. Design guardrails

- No AI exists in the setting.
- Mech combat is a human institution with real social and legal authority.
- Claims are authored, fixed-opponent ladders with permanent civic consequences.
- The Circuit is the repeatable procedural battle culture.
- Claim winners become permanent Witnesses; Circuit machines do not.
- The town is compact and relational, not a second full management game.
- Permanent progression expands knowledge, relationships, and build options rather than
  raw numerical power.
- The world may recognize its own absurdity, but characters do not trivialize the stakes.
- Visual inspiration comes from broad pre-digital civic and industrial art, not a direct
  fictionalization of one real political system.
