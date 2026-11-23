// node rec.mjs <outprefix> <keys> [ms]: records the app's frames while pressing keys, to see
// animations frame by frame. Needs a Chrome that renders (headless, CDP_PORT, default 9333);
// a minimised or background window doesn't animate.
import { writeFileSync } from 'node:fs';
const [out, keys, ms = '900'] = process.argv.slice(2);
const tabs = await (await fetch('http://127.0.0.1:' + (process.env.CDP_PORT || 9333) + '/json/list')).json();
const tab = tabs.find(t => t.type === 'page' && t.url.includes('localhost:8080'));
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let id = 0; const pending = new Map(); const frames = [];
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.onmessage = m => { const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
  if (d.method === 'Page.screencastFrame') { frames.push({ t: performance.now(), data: d.params.data }); send('Page.screencastFrameAck', { sessionId: d.params.sessionId }); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KC = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40 };
await send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 960, maxHeight: 540, everyNthFrame: 1 });
await sleep(300);
const t0 = performance.now();
for (const k of keys.split(',')) {
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: KC[k] });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: KC[k] });
  await sleep(Number(ms));
}
await send('Page.stopScreencast');
frames.forEach((f, i) => writeFileSync(`${out}-${String(i).padStart(3, '0')}-${Math.round(f.t - t0)}.jpg`, Buffer.from(f.data, 'base64')));
console.log(frames.length, 'frames');
ws.close();
