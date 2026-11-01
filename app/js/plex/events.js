// Live library updates. The server pushes events over a server-sent-events
// stream; a finished library scan (activity type library.update.section,
// event "ended") means new or changed media, so Home and the library grids
// refresh within seconds instead of waiting for their timer. The stream also
// carries thousands of per-item scan-progress messages, which are ignored.
// The timers in Home and Library stay as the fallback if the stream is down.
import { session } from '../session.js';
import { pref } from '../util/prefs.js';
import { log, warn } from '../util/log.js';

const listeners = new Set();
let source = null;
let sourceFor = '';
let retryTimer = 0;
let settleTimer = 0;
let retryMs = 5000;
let sections = new Set();

function close() {
  clearTimeout(retryTimer);
  if (source) { source.close(); source = null; }
}

function connect() {
  close();
  const server = session.server;
  if (!server || !listeners.size || document.hidden || typeof EventSource === 'undefined') return;
  sourceFor = server.id;
  try {
    source = new EventSource(server.url('/:/eventsource/notifications', { filters: 'activity' }));
  } catch (e) {
    warn('live updates unavailable', e.message);
    return;
  }
  source.onopen = () => { retryMs = 5000; log('live updates connected'); };
  source.addEventListener('activity', e => {
    try {
      const a = JSON.parse(e.data).ActivityNotification;
      if (a && a.event === 'ended' && a.Activity && a.Activity.type === 'library.update.section') {
        log('scan finished, section', a.Activity.Context && a.Activity.Context.librarySectionID);
        changed(a.Activity.Context && a.Activity.Context.librarySectionID);
      }
    } catch (err) { /* not a message we understand */ }
  });
  // The browser retries by itself while the connection is merely lost; if it
  // gave up (server restarted, bad reply), start over after a pause.
  source.onerror = () => {
    if (!source || source.readyState !== 2) return;
    close();
    retryTimer = setTimeout(connect, retryMs);
    retryMs = Math.min(retryMs * 2, 120000);
  };
}

// A scan can end for several sections in a row: tell the screens once.
function changed(sectionId) {
  if (!pref('homeRefresh')) return; // Settings → Home → Auto-refresh: "Only when opened"
  if (sectionId != null) sections.add(String(sectionId));
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    const ids = sections; sections = new Set();
    listeners.forEach(fn => { try { fn(ids); } catch (e) { warn('live update handler failed', e.message); } });
  }, 1500);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) close();
  else if (listeners.size) connect();
});

// fn(Set of section ids that changed; may be empty). Returns an unsubscribe.
export function onLibraryChange(fn) {
  listeners.add(fn);
  if (!source || (session.server && session.server.id !== sourceFor)) connect();
  return () => {
    listeners.delete(fn);
    if (!listeners.size) close();
  };
}
