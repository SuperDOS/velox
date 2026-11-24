// localStorage wrapper. Tizen keeps it across app restarts; it can throw when full.
const PREFIX = 'ss.';

export function get(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

// Every key starting with prefix (without the store's own "ss."), e.g. 'pref:'.
export function keys(prefix) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(PREFIX + prefix) === 0) out.push(k.slice(PREFIX.length));
    }
  } catch (e) { /* storage unavailable */ }
  return out;
}

export function set(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch (e) { /* quota */ }
}
