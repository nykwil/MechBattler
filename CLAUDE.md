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
# True 390px viewport, and it can tap things:
npm run web:shot -- 'http://localhost:5160/?view=workshop' /tmp/shot.png \
  --w 390 --h 844 --tap '.actionbar .btn-primary' --tap '.part-row'
```

`scripts/drive.mjs` drives Chrome over CDP. It has no dependencies and finds Chrome
itself; set `CHROME_PATH` if yours is somewhere unusual. It prints viewport and overflow
metrics beside the image. `--tap <selector>`, `--tapText <visible text>` and
`--key <ArrowRight|Enter|Escape|r|Delete>` are repeatable and interleave in order;
each scrolls the target into view, clicks or presses, and settles. `--eval <expr>`
reports any measurement. Use this rather than `--screenshot`.

An `--eval` immediately after a tap can sample before React commits. A report
overlay read as still mounted after its close button was tapped, twice looked like a
screen you could not leave, and was the measurement racing the unmount -- the same
class of mistake as reading a container instead of a leaf. Wait on the thing whose
absence you are asserting, or re-run before believing it.

Measure before believing a screenshot. Twice now an image has produced a false
diagnosis — a 500px crop read as clipping, and a scrim read as failing to cover —
and both times `--eval` showed nothing was wrong.

`npm run web:campaign` drives one whole campaign node -- launch, fight, win, close
the report, take salvage, strip -- and asserts the run actually moved. The audit
checks screens; the campaign is a flow, and the bug that made the mobile interface
unable to advance the run at all left every screen rendering perfectly.

The win is made deterministic by stripping the opponent's weapons in localStorage
before the fight, which is the only liberty it takes. A fair win is about one in
eight (docs/15 §7), which is why that path went unverified for the whole port.

**Edits are not live until vite has rebuilt.** Twice a change looked like it had
failed when the browser was still being served the old module -- once for minutes.
If a driven result contradicts the source, check what is actually served
(`curl -s http://localhost:5160/src/App.tsx`) before believing it, and remember vite
emits double quotes, so grep for `=== "active"` and not `=== 'active'`.
`pm2 restart mechbattler-dev` clears it.

`npm run web:audit` drives seven screens -- title, workshop, battle, report,
salvage, run panel, scrapyard -- and fails on the invariants that have each been
broken at least once: text under 11px, tap targets under 44px, overlapping targets,
horizontal overflow, console errors. `node scripts/audit.mjs scrapyard` re-runs one;
the deep ones walk a whole run and take a while.

The run panel and scrapyard are reached with `--exec`/`--reload`, which set the run's
node in localStorage and reload — a scrapyard is otherwise two won fights away. Each
screen asserts a marker element, so a navigation that quietly fails reports "never
reached the screen" instead of auditing whatever was on screen and passing.

It is not a substitute for looking. It found the report's 40px transport buttons only
because size is measured whether or not the control is on screen, and it will say
nothing about a screen that renders the wrong thing at the right size.

Then open the PNG and actually look. This was learned expensively: a leftover
56px header above a `height:100dvh` shell pushed the readout and action bar off
screen for an entire day of work while every test passed.

`?view=workshop` skips the title screen, `?view=balance` opens the Balance Lab, and
`?view=battle` starts a seeded free-play fight so the battle interface can be seen
without clicking through the workshop.

Chrome enforces a 500px minimum window width, so bare `--window-size=390` lays
out at 500 and writes a 390px PNG — a crop, not a clip. An hour went into "fixing"
clipping that did not exist. `drive.mjs` uses
`Emulation.setDeviceMetricsOverride`, which has no such floor, and reports
`overflowX` so a crop can never be mistaken for an overflow again.

Wait on the specific thing you are about to assert, not its ancestor. A container
exists before its children commit: gating on `.report-overlay` reported the battle
report as having no buttons at all, which looked like a screen with no way out.
Gating on `.report-banner-title` read it correctly — eight buttons, Replay, Report and
Rematch among them.

`--waitFor <selector>` accepts `selector@ms` to raise its 8s ceiling. A fight has
to actually play out before its report exists, so driving the whole campaign loop
needs `--waitFor '.report-banner-title@300000'`; the default is sized for a paint.

Put `--waitFor <selector>` between an action and the tap that depends on it. Without
it, `--tapText` can fall back to a shortest-containing match and do the opposite of
what you asked — tapping `Faults` before the sheet renders hits the readout bar,
which closes the sheet the tab lives in. That looked like a one-in-three flake and
was not a timing problem.

`--pointer fine` drops the `mobile` metrics flag and touch emulation. It cannot make
`(hover: hover)` true: headless Chrome has no pointing device, and neither
setEmulatedMedia nor `mobile: false` overrides that. So a hover-only element can
never be *seen* here. Verify it another way — disable its media rule through CSSOM
and check the element then has a box, which proves it is present and only the query
suppresses it.

`--key Tab` gives real keyboard focus, which is the only way to verify a
`:focus-visible` ring actually renders — a rule in the stylesheet is not the same as
an outline on the screen.

`--media reduce` emulates prefers-reduced-motion, which is how §9's blanket rule
was actually checked rather than merely asserted: transitions drop to 1e-06s, the
sheet still appears (its reveal is a class-set transform, not an animation), and
the pulsing live-dot settles at opacity 1 — visible and solid, which is the whole
point of collapsing duration instead of setting `animation: none`.

The driver reports console errors and warnings beside the image. React's
validateDOMNesting caught a `<button>` inside a `<button>` in salvage that no
screenshot or test had noticed — invalid HTML that browsers may respond to by
swallowing the click. Read that line.

Being able to *tap* matters as much as seeing: every bottom sheet in this app was
translated 101% off-screen for a day because no screenshot ever opened one.

There is no desktop design. The prototypes are phone designs; the builder's
`.device` rule is a bezel mock for its review page, not part of the app. Above
768px the shell holds a 560px column and centres it. docs/14 §11's docking rails
described the prose design, not the prototype, and the prototype wins.

A bounding box cannot see overlap. The arena SVG once painted over the console's
first two bars while every rect reported them laid out, inside their container and
visible — the screenshot was right and the measurement was inadequate, which is the
reverse of the trap above. `document.elementFromPoint` at an element's centre is the
check that settles it, and the audit uses it. Accept only the element itself or a
descendant: an *ancestor* at that point is usually the thing painting over it.

An instrument must not hardcode what the sim computes. The battle diagnostics and
the shot spread substituted constants for fire-control lag, weapon modifiers,
terrain cover, target profile and target speed in turn, and each was found only when
reviewing the fix for the previous one. If you are drawing a number the sim also
derives, read it from the sim or derive it from frames and events — never type it.

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
