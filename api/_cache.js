// Kleiner TTL-Cache im Speicher der Function-Instanz. Mit Fluid Compute
// bedient eine Instanz viele gleichzeitige Anfragen - der Cache spart dadurch
// spürbar Aufrufe bei Stripe, Supabase und der Jobbörse. Er ist nur
// "best effort" (pro Instanz, geht bei Kaltstart verloren) und darf deshalb
// nie als Quelle der Wahrheit dienen.
const store = new Map();
const MAX_ENTRIES = 500;

export function getCached(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.exp < Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function setCached(key, value, ttlMs) {
  if (store.size >= MAX_ENTRIES) store.delete(store.keys().next().value);
  store.set(key, { value, exp: Date.now() + ttlMs });
}

export function deleteCached(key) {
  store.delete(key);
}
