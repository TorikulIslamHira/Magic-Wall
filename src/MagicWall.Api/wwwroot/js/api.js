// Shared fetch + SignalR plumbing for the wall and the admin dashboard.
// Expects the SignalR browser client to be loaded as a classic script (global `signalR`).

/** Fired when a write comes back 401 (session expired or signed out elsewhere). */
export const UNAUTHORIZED_EVENT = 'magicwall:unauthorized';

/** GET JSON. Resolves to null on 404 so callers can show "not found" without try/catch. */
export async function getJson(url, signal) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} (${url})`);
  return res.json();
}

/**
 * Admin write. Authenticated by the login cookie (same-origin, sent automatically); logs
 * every request with its status (open the browser console to trace a save), and turns
 * failures into a readable Error carrying `.status`.
 */
export async function sendJson(method, url, body) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (networkError) {
    console.error(`[admin] ${method} ${url} → network error`, networkError);
    throw Object.assign(new Error('সংরক্ষণ ব্যর্থ: সার্ভারে পৌঁছানো যাচ্ছে না। সার্ভার চালু আছে কি না দেখুন।'), { status: 0 });
  }

  const ms = Math.round(performance.now() - started);
  const text = res.status === 204 ? '' : await res.text();
  const data = text ? safeParse(text) : null;

  if (res.ok) {
    console.log(`[admin] ${method} ${url} → ${res.status} (${ms} ms)`, body ?? '');
    return data;
  }

  console.error(`[admin] ${method} ${url} → ${res.status} FAILED (${ms} ms)`, { request: body, response: data ?? text });
  if (res.status === 401) window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
  throw Object.assign(new Error(failureMessage(res.status, data, text)), { status: res.status });
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function failureMessage(status, data, text) {
  const prefix = `সংরক্ষণ ব্যর্থ (HTTP ${status})`;
  if (status === 401) return `${prefix}: সেশন শেষ হয়েছে — আবার লগইন করুন।`;
  if (status === 403 && !data?.detail) return `${prefix}: এই কাজের অনুমতি আপনার নেই।`;
  if (status === 403) return `${prefix}: ${data.detail}`;
  if (status >= 500 && status !== 503) return `${prefix}: সার্ভার ত্রুটি — সার্ভারের লগ দেখুন (docker compose logs)।`;
  if (data?.errors) return `${prefix}: ${Object.values(data.errors).flat().join(' ')}`;
  if (typeof data === 'string') return `${prefix}: ${data}`;
  return `${prefix}: ${data?.detail ?? data?.title ?? text ?? ''}`.trim();
}

/**
 * Connects to the hub and keeps it connected: the built-in automatic reconnect covers
 * short drops, and a retry loop covers the initial connect and longer outages.
 * onConnected fires after every (re)connect so callers can resync missed updates.
 */
export function connectHub({ on = {}, onStatus = () => {}, onConnected = () => {}, tag = 'hub' }) {
  const connection = new signalR.HubConnectionBuilder()
    .withUrl('/hubs/magicwall')
    .withAutomaticReconnect([0, 1000, 3000, 5000, 10000])
    .configureLogging(signalR.LogLevel.Warning)
    .build();

  for (const [name, handler] of Object.entries(on)) connection.on(name, handler);

  // Every connection change is logged: a wall that stops updating is usually a dropped hub.
  const status = value => {
    console.log(`[${tag}] SignalR: ${value}${connection.connectionId ? ` (id ${connection.connectionId})` : ''}`);
    onStatus(value);
  };

  connection.onreconnecting(error => { console.warn(`[${tag}] SignalR connection lost, reconnecting…`, error ?? ''); status('reconnecting'); });
  connection.onreconnected(() => { status('live'); onConnected(); });
  connection.onclose(error => { console.warn(`[${tag}] SignalR closed`, error ?? ''); status('offline'); start(); });

  async function start() {
    status('connecting');
    for (let delay = 1000; ; delay = Math.min(delay * 2, 15000)) {
      try {
        await connection.start();
        status('live');
        onConnected();
        return;
      } catch (error) {
        console.warn(`[${tag}] SignalR connect failed, retrying in ${delay / 1000}s`, error);
        status('offline');
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  start();
  return connection;
}
