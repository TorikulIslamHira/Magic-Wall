// Shared fetch + SignalR plumbing for the wall and the admin dashboard.
// Expects the SignalR browser client to be loaded as a classic script (global `signalR`).

const ADMIN_KEY_STORAGE = 'magicwall.adminKey';

export const adminKey = {
  get() {
    try { return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? ''; } catch { return ''; }
  },
  set(value) {
    try { sessionStorage.setItem(ADMIN_KEY_STORAGE, value); } catch { /* storage blocked: key lives for this page only */ }
  }
};

/** GET JSON. Resolves to null on 404 so callers can show "not found" without try/catch. */
export async function getJson(url, signal) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return res.json();
}

/** Admin write. Sends the admin key and turns ProblemDetails into a readable Error. */
export async function sendJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Admin-Key': adminKey.get() },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  if (res.status === 401) throw new Error('অ্যাডমিন কী সঠিক নয়। ওপরের "অ্যাডমিন কী" ঘরটি দেখুন।');
  if (res.status === 204) return null;

  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) throw new Error(problemMessage(res, data, text));
  return data;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function problemMessage(res, data, text) {
  if (data?.errors) return Object.values(data.errors).flat().join(' ');
  if (typeof data === 'string') return data;
  return data?.detail ?? data?.title ?? (text || `${res.status} ${res.statusText}`);
}

/**
 * Connects to the hub and keeps it connected: the built-in automatic reconnect covers
 * short drops, and a retry loop covers the initial connect and longer outages.
 * onConnected fires after every (re)connect so callers can resync missed updates.
 */
export function connectHub({ on = {}, onStatus = () => {}, onConnected = () => {} }) {
  const connection = new signalR.HubConnectionBuilder()
    .withUrl('/hubs/magicwall')
    .withAutomaticReconnect([0, 1000, 3000, 5000, 10000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  for (const [name, handler] of Object.entries(on)) connection.on(name, handler);

  connection.onreconnecting(() => onStatus('reconnecting'));
  connection.onreconnected(() => { onStatus('live'); onConnected(); });
  connection.onclose(() => { onStatus('offline'); start(); });

  async function start() {
    onStatus('connecting');
    for (let delay = 1000; ; delay = Math.min(delay * 2, 15000)) {
      try {
        await connection.start();
        onStatus('live');
        onConnected();
        return;
      } catch {
        onStatus('offline');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  start();
  return connection;
}
