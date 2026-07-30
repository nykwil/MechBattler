#!/usr/bin/env node
/**
 * Drives one full campaign node and asserts the run actually moved.
 *
 * This exists because the audit checks screens and the campaign is a *flow*. The
 * mobile interface once could not advance the run at all -- fighting from the intel
 * sheet settled nothing, so a win gave no purse, no salvage, no node, and
 * fightsWon stayed 0 forever. Every screen involved rendered perfectly. Nothing
 * that looks at one screen at a time could have caught it.
 *
 * The win is made deterministic by stripping the opponent's weapons in
 * localStorage before the fight: a mech with no guns loses by mission-kill. That is
 * the only liberty taken -- everything after it is the real sim, the real
 * settlement and the real UI. It matters because a fair win takes about eight
 * attempts (docs/15 §7), which is why this path went unverified for the whole port.
 *
 * `npm run web:campaign`. Takes a few minutes: it fights a real battle.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const base = process.env.AUDIT_URL ?? 'http://localhost:5160';

/** Disarm this node's opponents so the fight is a decided one. */
const DISARM = `(() => {
  const k = 'mechbattler-run-v2';
  const r = JSON.parse(localStorage.getItem(k));
  const node = r.generatedNodes.find((n) => n.index === r.nodeIndex);
  for (const o of node.opponents) {
    o.build.parts = o.build.parts.filter((p) => !p.partId.startsWith('W-'));
  }
  localStorage.setItem(k, JSON.stringify(r));
})()`;

/**
 * Read the run after letting React commit. Waiting on a selector does not work
 * here: the plate is behind every overlay, so `--waitFor .plate` resolves instantly
 * and reads pre-settlement state -- which briefly looked like salvage failing.
 */
const REPORT = `(() => new Promise((res) => setTimeout(() => {
  const r = JSON.parse(localStorage.getItem('mechbattler-run-v2'));
  res(JSON.stringify({
    fightsWon: r.fightsWon,
    battles: r.battlesCompleted,
    node: r.nodeIndex,
    scrap: r.scrap,
    bench: (r.bench || []).length,
    pendingSalvage: !!r.pendingSalvage,
    status: r.status,
  }));
}, 1200)))()`;

const args = [
  join(here, 'drive.mjs'), `${base}/`, '/tmp/campaign-smoke.png', '--w', '390', '--h', '844',
  // Title -> garage -> load a blueprint -> run tab -> launch.
  '--tapText', 'New run', '--waitFor', 'button@20000',
  '--tapText', 'Load', '--waitFor', '.plate@20000',
  '--tap', '.readout', '--waitFor', '.readout-tab@20000',
  '--tap', '.readout-tab:nth-child(5)', '--waitFor', '.run-abandon@20000',
  '--tapText', 'Launch the run', '--waitFor', '.plate@20000',
  // Decide the fight, then re-enter the run.
  '--exec', DISARM,
  '--reload',
  '--tapText', 'Continue run', '--waitFor', '.plate@20000',
  // The mobile path to a fight: the action bar's NEXT strip, not the run panel.
  '--tap', '.nextfight, .actionbar button', '--waitFor', '.foe@20000',
  '--tap', '.foe', '--waitFor', '.sheet .btn-primary@20000',
  '--tapText', 'Fight', '--waitFor', '.report-banner-title@240000',
  '--tapText', 'Back to workshop', '--waitFor', '.wreck-panel@30000',
  '--tapText', 'Whisper',
  '--tapText', 'Strip the wreck',
  '--eval', REPORT,
];

const out = spawnSync('node', args, { encoding: 'utf8' });
const stdout = `${out.stdout ?? ''}\n${out.stderr ?? ''}`;
const line = stdout.split('\n').find((l) => l.startsWith('eval '));
if (!line) {
  console.error('campaign smoke: the drive did not report');
  console.error(stdout.trim().slice(-600));
  process.exit(1);
}

const r = JSON.parse(JSON.parse(line.slice(5)));
const checks = [
  ['battle was recorded', r.battles >= 1],
  ['the win counted', r.fightsWon >= 1],
  ['the ladder advanced', r.node >= 2],
  ['the purse was paid', r.scrap > 30],
  ['salvage reached the bench', r.bench >= 1],
  ['salvage was settled', r.pendingSalvage === false],
  ['the run is still live', r.status === 'active'],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed += 1;
}
console.log(JSON.stringify(r));

if (failed) {
  console.error(`\ncampaign smoke: ${failed} check${failed === 1 ? '' : 's'} failed — the run did not advance.`);
  process.exit(1);
}
console.log('\nCampaign advances: fight, win, salvage, bench, next node.');
