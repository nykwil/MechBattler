# MechBattler — working agreement

## Don't stop to report progress

Work until the goal is met, then report once. Do not end a turn to announce a
commit, a passing test run, or a finished sub-step — those are not decisions and
they don't need an answer.

Only stop early for:
- a decision that is genuinely mine to make and that changes what you build next
- something destructive or outward-facing that needs authorisation
- a blocker you cannot work around

If a task has ten steps, do ten steps. A status update is not a deliverable.

## Look at the app before claiming it works

`npm run web:test` and `npm run web:build` passing means the units and types are
fine. It does not mean the page renders. Screenshot it:

```bash
google-chrome --headless --disable-gpu --hide-scrollbars \
  --window-size=390,844 --screenshot=/tmp/shot.png \
  'http://localhost:5160/?view=workshop'
```

Then open the PNG and actually look. This was learned expensively: a leftover
56px header above a `height:100dvh` shell pushed the readout and action bar off
screen for an entire day of work while every test passed.

`?view=workshop` skips the title screen, `?view=balance` opens the Balance Lab, and
`?view=battle` starts a seeded free-play fight so the battle interface can be seen
without clicking through the workshop.

Chrome enforces a 500px minimum window width, so `--window-size=390` lays out at
500 and writes a 390px PNG — a crop, not a clip. Do not diagnose overflow from a
screenshot alone; measure `document.documentElement.scrollWidth` in the page. A
whole hour went into "fixing" clipping that did not exist.

## The design source is the prototypes, not the prose

`docs/prototypes/mobile-builder.html` and `mobile-battle.html` are the recovered
sources of the mobile UX. `docs/14-mobile-design-system.md` describes them, but
where the two disagree the prototype wins — it is the artefact that was reviewed
and agreed.

`apps/web/src/styles/shell.css` and `styles/battle.css` are those prototypes'
own stylesheets, kept verbatim so they stay diffable against the source. Do not
reformat them or sweep their values. `battle.css` is scoped under `.battle-app`
because both prototypes define `.app`, `.topbar` and `.btn` differently.

Screens with no prototype — front door, run panel, salvage, scrapyard — share the
tokens but were never designed on mobile (docs/14 §15). Harmonising them is fine;
inventing new interactions for them is a design decision, so ask.

## Never copy sim constants into UI code

Every figure shown to the player must come from `packages/sim`. The battle
prototype hand-ported `catalog.ts` and `combat.ts` and immediately drifted —
that is why the port had to be rewired rather than pasted.

## Infrastructure

- The dev server runs under pm2 as `mechbattler-dev` on port 5160. Never kill
  vite or start an ad-hoc dev server; `pm2 restart mechbattler-dev` if needed.
- Fully-shipped plan docs get `git mv`'d to `docs/archive/`; numbering is never
  reused.
