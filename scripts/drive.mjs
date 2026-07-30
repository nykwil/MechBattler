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
 *
 * --tap may be repeated; each waits for the selector, clicks its centre, and
 * settles before the next. The screenshot is taken after all taps.
 */
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';

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
const taps = args.reduce((acc, a, i) => (a === '--tap' ? [...acc, args[i + 1]] : acc), []);

const port = 9333 + Math.floor(Math.random() * 400);
const chrome = spawn('google-chrome', [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/cdp-${port}`,
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
await new Promise((r) => ws.once('open', r));

let seq = 0;
const pending = new Map();
ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
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
// The whole point: a real 390px viewport, which --window-size cannot give.
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: true,
});
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

await send('Page.navigate', { url });
await send('Page.setLifecycleEventsEnabled', { enabled: true });
await sleep(2500);

for (const selector of taps) {
  const box = await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
  })()`);
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
  await sleep(700);
}

// Report layout facts alongside the image: a screenshot alone cannot tell a crop
// from an overflow, which is exactly the mistake this driver exists to prevent.
const metrics = await evaluate(`JSON.stringify({
  vw: innerWidth, vh: innerHeight,
  docScrollWidth: document.documentElement.scrollWidth,
  overflowX: document.documentElement.scrollWidth > innerWidth,
  sheetOpen: !!document.querySelector('.sheet.on'),
})`);
console.error(`metrics ${metrics}`);

const { data } = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(data, 'base64'));
console.error(`wrote ${out}`);

ws.close();
chrome.kill();
process.exit(0);
