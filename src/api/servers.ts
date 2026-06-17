// Saved-server store for the connection switcher. Persists the list of OneC
// servers the user has connected to, plus the last one used, so the app can
// auto-connect on startup and offer a picker. Backed by AsyncStorage (included
// in Expo Go; no native rebuild needed).
//
// URLs are kept as the API ROOT, no trailing slash — same convention as
// `config.ts` (e.g. the Rentals example is `http://localhost:8899`).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { ONEC_BASE_URL } from './config';

export interface ServerEntry {
  /** Normalized base URL, no trailing slash. Acts as the identity of the entry. */
  url: string;
  /** Display label — the host[:port][/path], i.e. the URL without its scheme. */
  label: string;
}

const SERVERS_KEY = 'onec.servers';
const LAST_KEY = 'onec.lastServer';

/**
 * Coerce free-form input into a base URL we can talk to, or null if it can't
 * be one. Adds a default `http://` scheme, trims whitespace and trailing
 * slashes. Kept regex-based (not `URL`) — RN's URL polyfill is incomplete.
 */
export function normalizeUrl(input: string): string | null {
  let s = (input ?? '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  // require a non-empty host after the scheme
  if (!/^https?:\/\/[^\s/?#]+/i.test(s)) return null;
  return s.replace(/\/+$/, '');
}

/** Human label for a server: the URL minus its scheme (`localhost:8899`). */
export function labelFor(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

function entry(url: string): ServerEntry {
  return { url, label: labelFor(url) };
}

/**
 * The saved servers, most-recent first. On first run (nothing stored) this
 * seeds the list with the configured default so there's always something to
 * connect to.
 */
export async function loadServers(): Promise<ServerEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(SERVERS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      const list = parsed
        .filter((e) => e && typeof e.url === 'string')
        .map((e) => entry(e.url));
      if (list.length) return list;
    }
  } catch {
    /* fall through to the seed */
  }
  const seed = normalizeUrl(ONEC_BASE_URL);
  return seed ? [entry(seed)] : [];
}

async function saveServers(list: ServerEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(SERVERS_KEY, JSON.stringify(list));
  } catch {
    /* storage is best-effort */
  }
}

/**
 * Record a server as used: move it to the front of the list (adding it if
 * new) and mark it as the last-used one. Returns the updated list.
 */
export async function rememberServer(url: string): Promise<ServerEntry[]> {
  const norm = normalizeUrl(url);
  if (!norm) throw new Error('Invalid server URL');
  const rest = (await loadServers()).filter((e) => e.url !== norm);
  const list = [entry(norm), ...rest];
  await saveServers(list);
  await setLastServer(norm);
  return list;
}

/** Forget a saved server. Returns the updated list. */
export async function removeServer(url: string): Promise<ServerEntry[]> {
  const list = (await loadServers()).filter((e) => e.url !== url);
  await saveServers(list);
  const last = await getLastServer();
  if (last === url) await AsyncStorage.removeItem(LAST_KEY).catch(() => {});
  return list;
}

export async function getLastServer(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export async function setLastServer(url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_KEY, url);
  } catch {
    /* best-effort */
  }
}
