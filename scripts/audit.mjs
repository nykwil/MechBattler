#!/usr/bin/env node
/**
 * Drives every reachable screen and asserts the invariants that were each, at some
 * point, broken in a way tests and screenshots both missed:
 *
 *   - no text under 11px            (battle console shipped core/evade/mass at 9px)
 *   - no tap target under 44px      (abandon 63x16, scrapyard buy 64x18)
 *   - no horizontal overflow
 *   - no overlapping tap targets    (the first fix for buy/sell caused this)
 *   - no console errors or warnings (a <button> in a <button> lived in salvage)
 *
 * This exists because the manual sweep that found those was not repeatable, and the
 * defects it found were not the kind unit tests can see. `npm run web:audit`.
 *
 * Screens needing a run in progress are covered too, via `steps` -- the run panel
 * and the scrapyard are where two of those defects actually were, and a scrapyard
 * is otherwise two won fights away (docs/15 §7).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.AUDIT_URL ?? 'http://localhost:5160';

/** Walks from the title screen into a launched run, ready to open the readout. */
const INTO_RUN = [
  '--tapText', 'New run', '--waitFor', 'button@20000',
  '--tapText', 'Load', '--waitFor', '.plate@20000',
  '--tap', '.readout', '--waitFor', '.readout-tab@20000',
  '--tap', '.readout-tab:nth-child(5)', '--waitFor', '.run-abandon@20000',
  '--tapText', 'Launch the run', '--waitFor', '.plate@20000',
];

/** Node kinds vary by seed, so the yard is found rather than assumed to be node 3. */
const JUMP_TO_YARD = `(() => {
  const k = 'mechbattler-run-v4';
  const r = JSON.parse(localStorage.getItem(k));
  const yard = r.generatedNodes.find((n) => n.kind === 'scrapyard');
  r.nodeIndex = yard.index;
  localStorage.setItem(k, JSON.stringify(r));
})()`;

/**
 * Each screen names the leaf to wait on -- never a container (docs/15 §8) -- and
 * may carry `steps`, extra driver arguments run in order before the audit.
 */
const SCREENS = [
  { name: 'title', url: '/', waitFor: 'button' },
  { name: 'workshop', url: '/?view=workshop', waitFor: '.plate' },
  { name: 'battle', url: '/?view=battle', waitFor: '.live-title' },
  { name: 'report', url: '/?view=report', waitFor: '.report-banner-title' },
  { name: 'salvage', url: '/?view=salvage', waitFor: '.wreck-panel' },
  {
    name: 'run-panel',
    url: '/',
    waitFor: 'button',
    steps: [
      '--tapText', 'New run', '--waitFor', 'button@20000',
      '--tapText', 'Load', '--waitFor', '.plate@20000',
      '--tap', '.readout', '--waitFor', '.readout-tab@20000',
      '--tap', '.readout-tab:nth-child(5)', '--waitFor', '.run-abandon@20000',
    ],
    marker: '.run-abandon',
  },
  {
    name: 'scrapyard',
    url: '/',
    waitFor: 'button',
    steps: [
      ...INTO_RUN,
      '--exec', JUMP_TO_YARD,
      '--reload',
      '--tapText', 'Continue run', '--waitFor', '.plate@20000',
      '--tap', '.readout', '--waitFor', '.readout-tab@20000',
      '--tap', '.readout-tab:nth-child(5)', '--waitFor', '.run-bench-sell@20000',
    ],
    marker: '.run-bench-sell',
  },
];

/**
 * Runs in the page. Excludes aria-hidden subtrees, which are decorative and were
 * an earlier false positive in the accessible-name scan.
 */
const AUDIT = (marker) => `(() => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const small = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[aria-hidden="true"]')) continue;
    if (el.children.length || !(el.textContent || '').trim()) continue;
    // Text with no box is not rendered, so it cannot be too small to read. The
    // enemy strip's compact gun chips display:none their range slot, and scanning
    // it reported 9px text that is on no screen.
    if (!visible(el)) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 11) small.push(\`\${el.className || el.tagName}:\${fs}px\`);
  }
  const controls = [...document.querySelectorAll('button, a[href], select, input')]
    .filter((el) => !el.closest('[aria-hidden="true"]') && visible(el) && !el.disabled);

  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight;
  };

  // Size is checked on every control, on-screen or not. Hit-testing them first was
  // wrong twice over: elementFromPoint returns null below the fold, so the report's
  // 40px transport buttons -- sitting at y=890 of an 844px viewport -- were dropped
  // and the screen went green. A control does not stop needing a thumb-sized target
  // because you have to scroll to it.
  const targets = controls;
  // Overlap, by contrast, only means anything among things actually on screen and
  // on top: an overlay leaves the workshop's controls laid out full-size underneath
  // it, and counting those reported the topbar tabs as overlapping the battle
  // transport, which is just two screens stacked.
  // The point must resolve to the control itself or something inside it. Also
  // accepting hit.contains(el) was wrong: an *ancestor* containing the element says
  // nothing about whether the element is visible there, and the ancestor is often
  // what is painting over it. That let a damage grid clipped by its scroll container
  // count as on top, and reported it as overlapping the report's buttons.
  const hittable = controls.filter(onScreen).filter((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (el === hit || el.contains(hit));
  });
  const tiny = targets
    .filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height < 44 || r.width < 44;
    })
    .map((el) => \`\${(el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0, 20)}:\${Math.round(el.getBoundingClientRect().width)}x\${Math.round(el.getBoundingClientRect().height)}\`);
  // Overlap is checked among siblings only; a control inside a card legitimately
  // sits within its parent's box.
  const overlaps = [];
  for (let i = 0; i < hittable.length; i += 1) {
    for (let j = i + 1; j < hittable.length; j += 1) {
      const a = hittable[i]; const b = hittable[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect();
      const hit = ra.left < rb.right - 0.5 && rb.left < ra.right - 0.5
        && ra.top < rb.bottom - 0.5 && rb.top < ra.bottom - 0.5;
      if (hit) overlaps.push(\`\${(a.textContent || '?').trim().slice(0, 12)} / \${(b.textContent || '?').trim().slice(0, 12)}\`);
    }
  }
  return JSON.stringify({
    // Proof the run actually landed on the screen being audited. Without it a
    // navigation that quietly failed would audit whatever was on screen instead
    // and report a clean pass for a screen nobody reached.
    marker: !!document.querySelector(${JSON.stringify(marker)}),
    sub11: [...new Set(small)],
    tinyTargets: [...new Set(tiny)],
    overlaps: [...new Set(overlaps)].slice(0, 6),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  });
})()`;

// `node scripts/audit.mjs scrapyard` re-runs one screen; the deep ones take a
// while, and a fix rarely needs the whole set re-driven.
const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const chosen = only.length ? SCREENS.filter((s) => only.includes(s.name)) : SCREENS;
if (only.length && !chosen.length) {
  console.error(`no such screen: ${only.join(', ')}`);
  console.error(`known: ${SCREENS.map((s) => s.name).join(', ')}`);
  process.exit(2);
}

let failures = 0;

for (const screen of chosen) {
  const out = spawnSync('node', [
    join(here, 'drive.mjs'), `${base}${screen.url}`, `/tmp/audit-${screen.name}.png`,
    '--w', '390', '--h', '844',
    '--waitFor', `${screen.waitFor}@20000`,
    ...(screen.steps ?? []),
    '--eval', AUDIT(screen.marker ?? screen.waitFor),
  ], { encoding: 'utf8' });

  // drive.mjs reports on stderr as well as stdout; read both.
  const stdout = `${out.stdout ?? ''}\n${out.stderr ?? ''}`;
  const evalLine = stdout.split('\n').find((l) => l.startsWith('eval '));
  if (!evalLine) {
    console.error(`✗ ${screen.name}: did not report — ${stdout.trim().slice(-200)}`);
    failures += 1;
    continue;
  }

  const report = JSON.parse(JSON.parse(evalLine.slice(5)));
  const problems = [];
  if (!report.marker) problems.push(`never reached the screen (no ${screen.marker ?? screen.waitFor})`);
  if (report.sub11.length) problems.push(`text under 11px: ${report.sub11.join(', ')}`);
  if (report.tinyTargets.length) problems.push(`targets under 44px: ${report.tinyTargets.join(', ')}`);
  if (report.overlaps.length) problems.push(`overlapping targets: ${report.overlaps.join(', ')}`);
  if (report.overflowX) problems.push('horizontal overflow');
  // The driver prints console errors and warnings beside the image: a
  // `console (N):` header, then each message indented two spaces, then its
  // closing `wrote <path>` line (drive.mjs, the `consoleMessages` report block).
  // Matching only the header counted the errors and threw away every one of
  // their messages, so a failure read as a bare `console (2):` -- the audit
  // could say a screen was noisy but never what it said.
  //
  // Stop on the driver's own next line rather than on the first unindented one:
  // a single message may embed newlines whose continuations are NOT indented
  // (React's dev warnings are exactly that shape -- "unique \"key\" prop." then
  // a blank line then "Check the render method of ..."), and breaking there
  // truncated that message and silently dropped every message after it.
  const lines = stdout.split('\n');
  const header = lines.findIndex((l) => l.startsWith('console ('));
  if (header !== -1) {
    const messages = [];
    for (const line of lines.slice(header + 1)) {
      if (line.startsWith('wrote ') || line.startsWith('metrics ')) break;
      if (line.trim()) messages.push(line.trim());
    }
    problems.push(`${lines[header]} ${messages.join(' | ')}`);
  }

  if (problems.length) {
    failures += 1;
    console.error(`✗ ${screen.name}`);
    for (const p of problems) console.error(`    ${p}`);
  } else {
    console.log(`✓ ${screen.name}`);
  }
}

if (failures) {
  console.error(`\n${failures} screen${failures === 1 ? '' : 's'} failed the audit.`);
  process.exit(1);
}
console.log('\nAll screens pass: 11px text floor, 44px targets, no overlap, no overflow.');
