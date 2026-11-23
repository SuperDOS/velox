// Minimal Chrome DevTools driver for testing the app in a desktop Chrome (see docs/CONTINUING.md).
// Under WSL run it with Windows node.exe: Chrome's debugging port is only reachable from Windows.
// CDP_PORT picks the port (default 9222).
// Usage: node cdp.mjs <cmd> [arg]
//   open <url>        navigate the Velox tab (creates it if missing), 1920x1080
//   shot <outfile>    PNG screenshot of the Velox tab
//   eval <js>         evaluate JS, print result
//   keys <k1,k2,...>  press keys (ArrowUp/Down/Left/Right, Enter, Escape, Space, PageUp, PageDown) with 250ms gaps
import { writeFileSync } from 'node:fs';
const [cmd, arg] = process.argv.slice(2);
const base = 'http://127.0.0.1:' + (process.env.CDP_PORT || 9222);
const MARK = 'localhost:8080';

let tabs = await (await fetch(`${base}/json/list`)).json();
let tab = tabs.find(t => t.type === 'page' && t.url.includes(MARK));
if (!tab) tab = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
const logs = [];
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === 'Runtime.consoleAPICalled' && (d.params.type === 'error' || d.params.type === 'warning')) logs.push(d.params.type + ' ' + d.params.args.map(a => a.value ?? a.description).join(' '));
};
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });

if (cmd === 'keys') await send('Runtime.enable');
const KC = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Escape: 27, Space: 32, PageUp: 33, PageDown: 34, Backspace: 8 };
if (cmd === 'open') {
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Runtime.enable');
  await send('Page.bringToFront');
  await send('Page.navigate', { url: arg });
  await sleep(4000);
  console.log('opened', arg);
  console.log(logs.length ? logs.join('\n') : 'no errors');
} else if (cmd === 'shot') {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(arg, Buffer.from(r.result.data, 'base64'));
  console.log('saved', arg);
} else if (cmd === 'eval') {
  const r = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result.result.value ?? r.result, null, 2));
} else if (cmd === 'keys') {
  // Synthetic key events inside the page: CDP's Input events don't reach a
  // hidden (minimized) Chrome window reliably.
  for (const k of arg.split(',')) {
    const code = KC[k];
    await send('Runtime.evaluate', { expression: `for (const t of ['keydown','keyup']) { const e = new KeyboardEvent(t, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'keyCode', { get: () => ${code} }); (document.activeElement || document).dispatchEvent(e); }` });
    await sleep(1100); // hidden tabs throttle the app's key timer to ~1s
  }
  await sleep(1500);
  console.log('sent', arg, logs.length ? '\n' + logs.join('\n') : '');
}
ws.close();
