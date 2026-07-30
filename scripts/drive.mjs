#!/usr/bin/env node
/**
 * Minimal Chrome DevTools Protocol driver for looking at and driving the app.
 *
 * Two things plain `--screenshot` cannot do, both of which hid real bugs:
 *
 *  - Chrome enforces a 500px minimum window width, so `--window-size=390` lays
 *    out at 500 and writes a 390px PNG. That is a crop, not a phone.
 *    Emulation.setDeviceMetricsOverride gives a true 390px viewport.
 *  - Nothing can be tapped. Every sheet in this app was translated off-screen for
 *    a day because no screenshot ever opened one.
 *
 * Usage:
 *   node scripts/drive.mjs <url> <out.png> [--w 390] [--h 844] [--tap <selector>]...
 *                                          [--eval <js expression>]
 *
 * --waitFor <selector> blocks until the selector appears. It is ordered with the
 * taps, so a wait can sit between an action and the tap that depends on it.
 *
 * --slow throttles the network, so lazy-loading fallbacks can be seen rather than
 * assumed.
 *
 * --media reduce turns on prefers-reduced-motion.
 *
 * --key presses a key on the document, for the keyboard paths that touch
 * accelerates rather than replaces.
 *
 * --tap, --tapText and --key may be repeated and interleave in order; each clicks the
 * element's centre and settles before the next, so React commits between steps.
 * Measuring in the same expression that clicks will read stale DOM.
 * The screenshot is taken after all taps.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

// Node's built-in WebSocket, so this script has no dependencies. It previously
// imported `ws`, which is only in the tree transitively via jsdom — an undeclared
// dependency in the one script the README tells people to run.

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
if (!url || !out) {
  console.error('usage: drive.mjs <url> <out.png> [--w N] [--h N] [--tap sel]...');
  process.exit(2);
}
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? dflt : args[i + 1];
};
const width = Number(flag('w', 390));
const height = Number(flag('h', 844));
// Ordered list of taps. --tap takes a selector; --tapText takes visible text,
// for controls CSS cannot address (a part row by name, a button by label).
const taps = args.reduce((acc, a, i) => {
  if (a === '--tap') return [...acc, { kind: 'selector', value: args[i + 1] }];
  if (a === '--tapText') return [...acc, { kind: 'text', value: args[i + 1] }];
  if (a === '--key') return [...acc, { kind: 'key', value: args[i + 1] }];
  if (a === '--waitFor') return [...acc, { kind: 'wait', value: args[i + 1] }];
  return acc;
}, []);

/** Key names the app actually binds, mapped to what CDP needs. */
const KEYS = {
  ArrowLeft: { code: 37, key: 'ArrowLeft' },
  ArrowRight: { code: 39, key: 'ArrowRight' },
  ArrowUp: { code: 38, key: 'ArrowUp' },
  ArrowDown: { code: 40, key: 'ArrowDown' },
  Enter: { code: 13, key: 'Enter' },
  Escape: { code: 27, key: 'Escape' },
  r: { code: 82, key: 'r' },
  Delete: { code: 46, key: 'Delete' },
  Tab: { code: 9, key: 'Tab' },
};

/**
 * Chrome's binary name varies by platform and distro, so try the common ones rather
 * than hardcoding the one that happened to be on this machine.
 */
function chromeBinary() {
  const works = (bin) => !spawnSync(bin, ['--version'], { stdio: 'ignore' }).error;

  // An explicit CHROME_PATH that does not run is a mistake worth reporting, not
  // something to paper over by quietly launching a different browser.
  if (process.env.CHROME_PATH) {
    if (works(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    console.error(`CHROME_PATH is set to ${process.env.CHROME_PATH}, which will not run.`);
    process.exit(3);
  }

  const candidates = [
    'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const bin of candidates) {
    if (works(bin)) return bin;
  }
  console.error(
    'No Chrome found. Tried: ' + candidates.join(', ') + '\n'
    + 'Set CHROME_PATH to a Chrome or Chromium binary.',
  );
  process.exit(3);
}

const port = 9333 + Math.floor(Math.random() * 400);
/**
 * Chrome must die with this script however it ends. Runs that timed out before their
 * own cleanup leaked browsers, and ten of them starve each other badly enough to look
 * like application flakiness — several "flakes" chased today were probably this.
 */
/**
 * A fresh profile per run. A profile keyed only by port is shared by every run on
 * that port -- and by any parallel job that picks it -- so localStorage survives
 * between runs. A stale pending salvage from an earlier drive rendered over the
 * workshop and read as a layout bug; a starter build carried over and made a
 * "placed 4 cells" assertion read 14. State must not outlive the run that made it.
 */
const profileDir = mkdtempSync(join(tmpdir(), 'cdp-profile-'));

function reapOnExit(proc) {
  const kill = () => {
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* best effort */ }
  };
  process.on('exit', kill);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => { kill(); process.exit(130); });
  }
  process.on('uncaughtException', (err) => { kill(); throw err; });
}

const chrome = spawn(chromeBinary(), [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' });
reapOnExit(chrome);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for a predicate to hold in the page. Fixed sleeps are why a tab-switch
 * assertion read stale DOM about one run in three; waiting on the condition removes
 * that class of flake instead of lengthening the guess.
 */
async function waitFor(expression, { timeoutMs = 8000, label = expression } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(`Boolean(${expression})`)) return true;
    await sleep(80);
  }
  console.error(`waitFor timed out: ${label}`);
  return false;
}

async function targetWs() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not expose a debugging target');
}

const ws = new WebSocket(await targetWs());
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

let seq = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = (seq += 1);
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const { result } = await send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true,
  });
  return result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');

// Console capture. React warnings, key collisions and thrown errors are invisible
// in a screenshot and were never being looked at.
const consoleMessages = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(msg.params.type)) {
    consoleMessages.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`);
  }
  if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
    consoleMessages.push(`${msg.params.entry.level}: ${msg.params.entry.text}`);
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleMessages.push(`exception: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
  }
});
// The whole point: a real 390px viewport, which --window-size cannot give.
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

// --media reduce emulates prefers-reduced-motion, so §9's blanket rule can be
// checked in a browser rather than only asserted against the stylesheet.
if (flag('media', null) === 'reduce') {
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  });
}

// --slow throttles the network, which is the only way to actually see a lazy
// fallback: these chunks are small enough to arrive before a frame otherwise.
if (args.includes('--slow')) {
  await send('Network.enable');
  await send('Network.emulateNetworkConditions', {
    offline: false, latency: 400, downloadThroughput: 40000, uploadThroughput: 40000,
  });
}

await send('Page.navigate', { url });
await send('Page.setLifecycleEventsEnabled', { enabled: true });

// Wait for React to mount rather than guessing at a load time.
await waitFor('document.getElementById("root") && document.getElementById("root").children.length',
  { timeoutMs: 20000, label: 'app mount' });



for (const tap of taps) {
  const selector = tap.value;
  if (tap.kind === 'wait') {
    // Ordered waits matter more than longer sleeps. Tapping text before its element
    // exists does not merely miss: --tapText falls back to the shortest containing
    // match, which for 'Faults' is the readout bar, whose click closes the sheet the
    // tab lives in. The tap succeeds and does the opposite of what was asked.
    // `sel@ms` raises the ceiling for waits that are not about rendering: a fight
    // has to actually play out before its report exists, which is minutes, not the
    // 8s a paint needs.
    const at = selector.lastIndexOf('@');
    const ms = at > 0 ? Number(selector.slice(at + 1)) : NaN;
    const sel = Number.isFinite(ms) ? selector.slice(0, at) : selector;
    await waitFor(`document.querySelector(${JSON.stringify(sel)})`, {
      label: sel,
      ...(Number.isFinite(ms) ? { timeoutMs: ms } : {}),
    });
    continue;
  }
  if (tap.kind === 'key') {
    const k = KEYS[selector];
    if (!k) { console.error(`key: unknown ${selector}`); continue; }
    for (const type of ['keyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', {
        type, key: k.key, code: k.key, windowsVirtualKeyCode: k.code, nativeVirtualKeyCode: k.code,
      });
    }
    console.error(`pressed ${selector}`);
    await sleep(400);
    continue;
  }
  // Choosing among text matches is subtler than it looks. A container always
  // contains its child's text, so first-match-wins is wrong: tapping 'Faults' hit
  // the readout bar rather than the sheet tab. Shortest-match is also wrong on its
  // own: tapping 'Widow' hit the intel strip's 'Junkyard Widow' (22 chars) instead
  // of the 'Widow' chassis row (29). So prefer an element whose own text *starts*
  // with the query, and only then fall back to the shortest containing match.
  const finder = tap.kind === 'text'
    ? `(() => {
         const q = ${JSON.stringify(selector)};
         const all = [...document.querySelectorAll('button, [role=tab], a')]
           .filter((e) => e.textContent.includes(q));
         const byLength = (a, b) => a.textContent.length - b.textContent.length;
         const starts = all.filter((e) => e.textContent.trim().startsWith(q)).sort(byLength);
         return (starts[0] ?? all.sort(byLength)[0]);
       })()`
    : `document.querySelector(${JSON.stringify(selector)})`;
  // Wait for the target to exist before measuring it, so a tap issued while React
  // is still committing does not silently miss.
  await waitFor(`${finder}`, { label: `element for ${selector}` });

  // Scroll into view first: sheet bodies scroll, and a part row 1900px down
  // reports a rect far outside the viewport, so the click lands on nothing.
  // Measure only after the scroll has settled -- reading the rect in the same
  // expression that scrolls gives a stale position, which shows up as a tap that
  // silently does nothing.
  await evaluate(`(() => {
    const el = ${finder};
    if (el) el.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  })()`);
  await sleep(300);
  const box = await evaluate(`(() => {
    const el = ${finder};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  })()`);
  if (box && (box.y < 0 || box.y > height)) {
    console.error(`tap: ${selector} still off-viewport at y=${Math.round(box.y)}`);
  }
  if (!box) {
    console.error(`tap: no element for ${selector}`);
    continue;
  }
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
    });
  }
  console.error(`tapped ${selector} at ${Math.round(box.x)},${Math.round(box.y)}`);
  // Generous on purpose: at 700ms a tab-switch assertion read stale DOM about one
  // run in three, which looks exactly like a broken control.
  await sleep(1000);
}

// Arbitrary measurement, for when a screenshot cannot settle a question.
const evalExpr = flag('eval', null);
if (evalExpr) console.error(`eval ${JSON.stringify(await evaluate(evalExpr))}`);

// Report layout facts alongside the image: a screenshot alone cannot tell a crop
// from an overflow, which is exactly the mistake this driver exists to prevent.
const metrics = await evaluate(`JSON.stringify({
  vw: innerWidth, vh: innerHeight,
  docScrollWidth: document.documentElement.scrollWidth,
  overflowX: document.documentElement.scrollWidth > innerWidth,
  sheetOpen: !!document.querySelector('.sheet.on'),
})`);
console.error(`metrics ${metrics}`);

if (consoleMessages.length) {
  console.error(`console (${consoleMessages.length}):`);
  for (const m of [...new Set(consoleMessages)]) console.error(`  ${m.slice(0, 220)}`);
} else {
  console.error('console clean');
}

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(data, 'base64'));
console.error(`wrote ${out}`);

ws.close();
chrome.kill();
process.exit(0);
